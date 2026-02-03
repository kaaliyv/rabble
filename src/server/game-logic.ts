import type { RoomState, User, GuessItem, VoteTally } from "../types/game";
import * as db from "../db/database";

const MAX_STANDARD_ROUNDS = 10;
const PLAYER_CAP_THRESHOLD = 15;

export const initializeRoomState = async (roomId: number): Promise<RoomState> => {
  const room = await db.getRoomById(roomId);
  if (!room) throw new Error("Room not found");

  const [users, guessItems, currentRound, associations, guesses] = await Promise.all([
    db.getUsersByRoom(roomId),
    db.getGuessItemsByRoom(roomId),
    db.getCurrentRound(roomId),
    db.getAssociationsByRoom(roomId),
    db.getGuessesByRoom(roomId)
  ]);

  return {
    room,
    users,
    guessItems,
    currentRound,
    associations,
    guesses
  };
};

export const getRoomState = async (roomId: number): Promise<RoomState | null> => {
  try {
    return await initializeRoomState(roomId);
  } catch {
    return null;
  }
};

export const refreshRoomState = async (roomId: number): Promise<RoomState> => {
  return initializeRoomState(roomId);
};

// Assign guess items to users
export const assignGuessItems = async (roomId: number): Promise<Map<number, number>> => {
  const [users, guessItems] = await Promise.all([
    db.getUsersByRoom(roomId),
    db.getGuessItemsByRoom(roomId)
  ]);
  const players = users.filter(user => !user.is_host);

  if (guessItems.length === 0) {
    throw new Error("No guess items to assign");
  }

  if (players.length === 0) {
    throw new Error("No players available");
  }

  const assignments = new Map<number, number>(); // userId -> guessItemId

  // Calculate how many users per item
  const usersPerItem = Math.floor(players.length / guessItems.length);
  const remainder = players.length % guessItems.length;

  // Shuffle users
  const shuffledUsers = [...players].sort(() => Math.random() - 0.5);

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
export const startSubmissionPhase = async (roomId: number): Promise<Map<number, number>> => {
  await db.updateRoomStatus(roomId, "submitting");
  const assignments = await assignGuessItems(roomId);
  await refreshRoomState(roomId);
  return assignments;
};

// Check if all users have submitted associations
export const checkAllSubmitted = async (roomId: number, assignments: Map<number, number>): Promise<boolean> => {
  const associations = await db.getAssociationsByRoom(roomId);
  const submittedUsers = new Set(associations.map(a => a.user_id));

  for (const userId of assignments.keys()) {
    if (!submittedUsers.has(userId)) {
      return false;
    }
  }

  return true;
};

// Start guessing phase with first round
export const startGuessingPhase = async (roomId: number): Promise<void> => {
  const [guessItems, associations, users] = await Promise.all([
    db.getGuessItemsByRoom(roomId),
    db.getAssociationsByRoom(roomId),
    db.getUsersByRoom(roomId)
  ]);

  if (guessItems.length === 0) {
    throw new Error("No guess items available");
  }

  const itemsWithAssociations = new Set(associations.map(a => a.guess_item_id));
  const playableItems = guessItems.filter(item => itemsWithAssociations.has(item.id));

  if (playableItems.length === 0) {
    await db.updateRoomStatus(roomId, "finished");
    return;
  }

  const players = users.filter(user => !user.is_host);
  const shouldCap = players.length > PLAYER_CAP_THRESHOLD;

  const shuffled = [...playableItems].sort(() => Math.random() - 0.5);
  const standardCount = shouldCap ? Math.min(MAX_STANDARD_ROUNDS, shuffled.length) : shuffled.length;
  const standardItems = shuffled.slice(0, standardCount);
  const lightningItems = shuffled.slice(standardCount);

  await Promise.all([
    db.setRoundQueue(roomId, "standard", standardItems.map(item => item.id)),
    db.setRoundQueue(roomId, "lightning", lightningItems.map(item => item.id)),
    db.updateRoomStatus(roomId, "guessing")
  ]);

  const started = await startNextQueuedRound(roomId, "standard");
  if (!started && lightningItems.length > 0) {
    await startNextQueuedRound(roomId, "lightning");
  }

  await refreshRoomState(roomId);
};

// Get users who should guess (exclude those who wrote associations for this item)
export const getEligibleGuessers = async (roomId: number, guessItemId: number): Promise<User[]> => {
  const [users, associations] = await Promise.all([
    db.getUsersByRoom(roomId),
    db.getAssociationsByGuessItem(guessItemId)
  ]);
  const players = users.filter(user => !user.is_host);
  const excludedUserIds = new Set(associations.map(a => a.user_id));

  return players.filter(u => !excludedUserIds.has(u.id));
};

// Get random options for multiple choice (current item + 3 others)
export const getGuessOptions = async (roomId: number, correctItemId: number): Promise<GuessItem[]> => {
  const allItems = await db.getGuessItemsByRoom(roomId);
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

export const ensureRoundOptions = async (
  roomId: number,
  roundNumber: number,
  correctItemId: number
): Promise<GuessItem[]> => {
  const existing = await db.getRoundOptions(roomId, roundNumber);
  if (existing.length > 0) return existing;

  const options = await getGuessOptions(roomId, correctItemId);
  await db.setRoundOptions(roomId, roundNumber, options.map(o => o.id));
  return options;
};

// Calculate vote tallies
export const calculateVoteTallies = async (roomId: number, roundNumber: number): Promise<VoteTally[]> => {
  const [guesses, guessItems] = await Promise.all([
    db.getGuessesByRound(roomId, roundNumber),
    db.getGuessItemsByRoom(roomId)
  ]);

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
        guess_item_name: item?.name || "Unknown",
        vote_count: count
      };
    })
    .sort((a, b) => b.vote_count - a.vote_count);
};

// Award points for correct guesses
export const awardPoints = async (roomId: number, roundNumber: number, correctItemId: number): Promise<void> => {
  const guesses = await db.getGuessesByRound(roomId, roundNumber);

  await Promise.all(
    guesses.map(guess =>
      guess.guessed_item_id === correctItemId
        ? db.updateUserScore(guess.user_id, 10)
        : Promise.resolve()
    )
  );
};

// Move to next round or finish game
export const advanceToNextRound = async (roomId: number): Promise<boolean> => {
  const currentRound = await db.getCurrentRound(roomId);
  if (!currentRound) return false;

  await db.updateRoundStatus(currentRound.id, "completed");

  const room = await db.getRoomById(roomId);
  if (!room) return false;

  if (room.status === "guessing") {
    const started = await startNextQueuedRound(roomId, "standard");
    if (started) {
      await refreshRoomState(roomId);
      return true;
    }

    const lightningStarted = await startNextQueuedRound(roomId, "lightning");
    if (lightningStarted) {
      await db.updateRoomStatus(roomId, "lightning");
      await refreshRoomState(roomId);
      return true;
    }

    await db.updateRoomStatus(roomId, "finished");
    await refreshRoomState(roomId);
    return false;
  }

  if (room.status === "lightning") {
    const lightningStarted = await startNextQueuedRound(roomId, "lightning");
    if (lightningStarted) {
      await refreshRoomState(roomId);
      return true;
    }

    await db.updateRoomStatus(roomId, "finished");
    await refreshRoomState(roomId);
    return false;
  }

  return false;
};

// Clean up old rooms (optional, for maintenance)
export const cleanupOldRooms = async (maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<void> => {
  void maxAgeMs;
  // Placeholder for cleanup logic.
};

export const startNextQueuedRound = async (roomId: number, phase: "standard" | "lightning"): Promise<boolean> => {
  const next = await db.getNextQueuedItem(roomId, phase);
  if (!next) return false;

  await db.markQueuedItemPlayed(roomId, phase, next.guess_item_id);
  const currentRound = await db.getCurrentRound(roomId);
  const nextRoundNumber = (currentRound?.round_number ?? 0) + 1;
  await db.createRound(roomId, next.guess_item_id, nextRoundNumber);
  await db.updateRoomStatus(roomId, phase === "lightning" ? "lightning" : "guessing");

  return true;
};
