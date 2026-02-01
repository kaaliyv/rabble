import type { RoomState, User, GuessItem, VoteTally } from "../types/game";
import * as db from "../db/database";

export const initializeRoomState = (roomId: number): RoomState => {
  const room = db.getRoomById(roomId);
  if (!room) throw new Error("Room not found");

  const state: RoomState = {
    room,
    users: db.getUsersByRoom(roomId),
    guessItems: db.getGuessItemsByRoom(roomId),
    currentRound: db.getCurrentRound(roomId),
    associations: db.getAssociationsByRoom(roomId),
    guesses: db.getGuessesByRoom(roomId)
  };

  return state;
};

export const getRoomState = (roomId: number): RoomState | null => {
  try {
    return initializeRoomState(roomId);
  } catch {
    return null;
  }
};

export const refreshRoomState = (roomId: number): RoomState => {
  return initializeRoomState(roomId);
};

// Assign guess items to users
export const assignGuessItems = (roomId: number): Map<number, number> => {
  const users = db.getUsersByRoom(roomId);
  const guessItems = db.getGuessItemsByRoom(roomId);

  if (guessItems.length === 0) {
    throw new Error("No guess items to assign");
  }

  const assignments = new Map<number, number>(); // userId -> guessItemId
  
  // Calculate how many users per item
  const usersPerItem = Math.floor(users.length / guessItems.length);
  const remainder = users.length % guessItems.length;

  // Shuffle users
  const shuffledUsers = [...users].sort(() => Math.random() - 0.5);

  let userIndex = 0;
  guessItems.forEach((item, itemIndex) => {
    const count = usersPerItem + (itemIndex < remainder ? 1 : 0);
    for (let i = 0; i < count && userIndex < shuffledUsers.length; i++) {
      assignments.set(shuffledUsers[userIndex].id, item.id);
      userIndex++;
    }
  });

  return assignments;
};

// Start the submission phase
export const startSubmissionPhase = (roomId: number): Map<number, number> => {
  db.updateRoomStatus(roomId, 'submitting');
  const assignments = assignGuessItems(roomId);
  refreshRoomState(roomId);
  return assignments;
};

// Check if all users have submitted associations
export const checkAllSubmitted = (roomId: number, assignments: Map<number, number>): boolean => {
  const associations = db.getAssociationsByRoom(roomId);
  const submittedUsers = new Set(associations.map(a => a.user_id));
  
  for (const userId of assignments.keys()) {
    if (!submittedUsers.has(userId)) {
      return false;
    }
  }
  
  return true;
};

// Start guessing phase with first round
export const startGuessingPhase = (roomId: number): void => {
  const guessItems = db.getGuessItemsByRoom(roomId);
  if (guessItems.length === 0) {
    throw new Error("No guess items available");
  }

  db.updateRoomStatus(roomId, 'guessing');
  
  // Create first round
  const round = db.createRound(roomId, guessItems[0].id, 1);
  refreshRoomState(roomId);
};

// Get users who should guess (exclude those who wrote associations for this item)
export const getEligibleGuessers = (roomId: number, guessItemId: number): User[] => {
  const users = db.getUsersByRoom(roomId);
  const associations = db.getAssociationsByGuessItem(guessItemId);
  const excludedUserIds = new Set(associations.map(a => a.user_id));

  return users.filter(u => !excludedUserIds.has(u.id));
};

// Get random options for multiple choice (current item + 3 others)
export const getGuessOptions = (roomId: number, correctItemId: number): GuessItem[] => {
  const allItems = db.getGuessItemsByRoom(roomId);
  const correctItem = allItems.find(i => i.id === correctItemId);
  
  if (!correctItem) {
    throw new Error("Correct item not found");
  }

  const otherItems = allItems.filter(i => i.id !== correctItemId);
  
  // Shuffle and take first 3
  const shuffled = otherItems.sort(() => Math.random() - 0.5);
  const options = [correctItem, ...shuffled.slice(0, Math.min(3, shuffled.length))];
  
  // Shuffle options
  return options.sort(() => Math.random() - 0.5);
};

export const ensureRoundOptions = (roomId: number, roundNumber: number, correctItemId: number): GuessItem[] => {
  const existing = db.getRoundOptions(roomId, roundNumber);
  if (existing.length > 0) return existing;

  const options = getGuessOptions(roomId, correctItemId);
  db.setRoundOptions(roomId, roundNumber, options.map(o => o.id));
  return options;
};

// Calculate vote tallies
export const calculateVoteTallies = (roomId: number, roundNumber: number): VoteTally[] => {
  const guesses = db.getGuessesByRound(roomId, roundNumber);
  const guessItems = db.getGuessItemsByRoom(roomId);
  
  const tallies = new Map<number, number>();
  
  guesses.forEach(guess => {
    const current = tallies.get(guess.guessed_item_id) || 0;
    tallies.set(guess.guessed_item_id, current + 1);
  });

  return Array.from(tallies.entries())
    .map(([itemId, count]) => {
      const item = guessItems.find(i => i.id === itemId);
      return {
        guess_item_id: itemId,
        guess_item_name: item?.name || 'Unknown',
        vote_count: count
      };
    })
    .sort((a, b) => b.vote_count - a.vote_count);
};

// Award points for correct guesses
export const awardPoints = (roomId: number, roundNumber: number, correctItemId: number): void => {
  const guesses = db.getGuessesByRound(roomId, roundNumber);
  
  guesses.forEach(guess => {
    if (guess.guessed_item_id === correctItemId) {
      db.updateUserScore(guess.user_id, 10); // 10 points for correct guess
    }
  });
};

// Move to next round or finish game
export const advanceToNextRound = (roomId: number): boolean => {
  const currentRound = db.getCurrentRound(roomId);
  if (!currentRound) return false;

  db.updateRoundStatus(currentRound.id, 'completed');

  const guessItems = db.getGuessItemsByRoom(roomId);
  const nextIndex = currentRound.round_number; // 0-indexed after current

  if (nextIndex >= guessItems.length) {
    // Game finished
    db.updateRoomStatus(roomId, 'finished');
    refreshRoomState(roomId);
    return false;
  }

  // Create next round
  const nextItem = guessItems[nextIndex];
  db.createRound(roomId, nextItem.id, currentRound.round_number + 1);
  db.updateRoomStatus(roomId, 'guessing');
  refreshRoomState(roomId);
  
  return true;
};

// Clean up old rooms (optional, for maintenance)
export const cleanupOldRooms = (maxAgeMs: number = 24 * 60 * 60 * 1000): void => {
  // This could be run periodically to clean up old rooms
  // For now, we'll keep it simple
};
