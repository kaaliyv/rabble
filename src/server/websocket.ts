import type { ServerWebSocket } from "bun";
import type { WSMessage } from "../types/game";
import * as db from "../db/database";
import * as game from "./game-logic";

interface WebSocketData {
  roomId: number;
  userId: number;
}

// Store active connections by room
const roomConnections = new Map<number, Set<ServerWebSocket<WebSocketData>>>();


export const handleWebSocket = {
  open(ws: ServerWebSocket<WebSocketData>) {
    const { roomId, userId } = ws.data;
    const room = db.getRoomById(roomId);
    const user = db.getUserById(userId);

    if (!room || !user || user.room_id !== roomId) {
      ws.close(1008, "Invalid room or user");
      return;
    }
    
    if (!roomConnections.has(roomId)) {
      roomConnections.set(roomId, new Set());
    }
    roomConnections.get(roomId)!.add(ws);

    console.log(`User ${userId} connected to room ${roomId}`);

    // Send current room state
    const state = game.getRoomState(roomId) || game.initializeRoomState(roomId);
    ws.send(JSON.stringify({ type: 'room_state', payload: state }));

    // Send assignment if in submission phase
    if (state.room.status === 'submitting') {
      const assignment = db.getAssignmentByUser(roomId, userId);
      if (assignment) {
        const guessItem = db.getGuessItemById(assignment.guess_item_id);
        ws.send(JSON.stringify({
          type: 'assignment',
          payload: {
            guess_item_id: assignment.guess_item_id,
            guess_item_name: guessItem?.name
          }
        }));
      }
    }

    // Send current round data if guessing is in progress
    if (state.room.status === 'guessing' && state.currentRound) {
      const roundPayload = buildRoundPayload(roomId, state.currentRound.round_number, state.currentRound.guess_item_id);
      ws.send(JSON.stringify({ type: 'round_started', payload: roundPayload }));
    }

    // Let everyone refresh their room view when someone connects
    broadcastRoomState(roomId);
  },

  message(ws: ServerWebSocket<WebSocketData>, message: string) {
    try {
      const msg: WSMessage = JSON.parse(message);
      handleMessage(ws, msg);
    } catch (error) {
      console.error('WebSocket message error:', error);
      ws.send(JSON.stringify({
        type: 'error',
        payload: { message: 'Invalid message format' }
      }));
    }
  },

  close(ws: ServerWebSocket<WebSocketData>) {
    const { roomId } = ws.data;
    const connections = roomConnections.get(roomId);
    
    if (connections) {
      connections.delete(ws);
      if (connections.size === 0) {
        roomConnections.delete(roomId);
      }
    }

    console.log(`User ${ws.data.userId} disconnected from room ${roomId}`);
  }
};

function handleMessage(ws: ServerWebSocket<WebSocketData>, msg: WSMessage) {
  const { roomId, userId } = ws.data;

  switch (msg.type) {
    case 'start_game':
      handleStartGame(roomId, userId, msg.payload);
      break;

    case 'submit_association':
      handleSubmitAssociation(roomId, userId, msg.payload);
      break;

    case 'submit_guess':
      handleSubmitGuess(roomId, userId, msg.payload);
      break;

    case 'reveal_votes':
      handleRevealVotes(roomId, userId);
      break;

    case 'reveal_answer':
      handleRevealAnswer(roomId, userId);
      break;

    case 'next_round':
      handleNextRound(roomId, userId);
      break;

    default:
      ws.send(JSON.stringify({
        type: 'error',
        payload: { message: 'Unknown message type' }
      }));
  }
}

function handleStartGame(roomId: number, userId: number, payload: { items?: string[] } | undefined) {
  const user = db.getUserById(userId);
  const room = db.getRoomById(roomId);

  if (!user?.is_host || !room) return;
  if (room.status !== 'lobby') return;

  // Create guess items
  const rawItems = Array.isArray(payload?.items) ? payload.items : [];
  const items = Array.from(
    new Set(
      rawItems
        .map(item => (item ?? '').toString().trim())
        .filter(item => item.length > 0)
        .map(item => item.slice(0, 50))
    )
  );

  const users = db.getUsersByRoom(roomId);

  if (users.length < 4) {
    sendToUser(roomId, userId, {
      type: 'error',
      payload: { message: 'Need at least 4 players to start' }
    });
    return;
  }

  if (items.length < 4) {
    sendToUser(roomId, userId, {
      type: 'error',
      payload: { message: 'Please enter at least 4 items' }
    });
    return;
  }

  if (items.length > users.length) {
    sendToUser(roomId, userId, {
      type: 'error',
      payload: { message: 'Number of items cannot exceed number of players' }
    });
    return;
  }

  db.createGuessItems(roomId, items);

  // Start submission phase and assign items
  const assignments = game.startSubmissionPhase(roomId);
  db.setAssignments(roomId, assignments);

  // Broadcast to all users in room
  broadcastToRoom(roomId, {
    type: 'game_started',
    payload: {
      state: game.getRoomState(roomId)
    }
  });
  broadcastRoomState(roomId);

  // Send assignments to each user
  assignments.forEach((guessItemId, assignedUserId) => {
    const guessItem = db.getGuessItemById(guessItemId);
    sendToUser(roomId, assignedUserId, {
      type: 'assignment',
      payload: {
        guess_item_id: guessItemId,
        guess_item_name: guessItem?.name
      }
    });
  });
}

function handleSubmitAssociation(roomId: number, userId: number, payload: { value?: string } | undefined) {
  const room = db.getRoomById(roomId);
  if (!room || room.status !== 'submitting') return;
  const assignment = db.getAssignmentByUser(roomId, userId);
  if (!assignment) return;
  const guessItemId = assignment.guess_item_id;

  // Check if already submitted
  const existing = db.getAssociationByUserAndItem(userId, guessItemId);
  if (existing) {
    return;
  }

  const value = (payload?.value ?? "").toString().trim();
  if (!value) return;

  const normalized = value.slice(0, 30);

  // Create association
  db.createAssociation(userId, guessItemId, normalized);
  game.refreshRoomState(roomId);

  // Check if all submitted
  const assignments = new Map(db.getAssignmentsByRoom(roomId).map(a => [a.user_id, a.guess_item_id]));
  const allSubmitted = game.checkAllSubmitted(roomId, assignments);

  broadcastToRoom(roomId, {
    type: 'association_submitted',
    payload: {
      user_id: userId,
      all_submitted: allSubmitted
    }
  });
  broadcastRoomState(roomId);

  if (allSubmitted) {
    // Auto-start guessing phase
    game.startGuessingPhase(roomId);
    startNextGuessingRound(roomId);
  }
}

function handleSubmitGuess(roomId: number, userId: number, payload: { guessed_item_id?: number } | undefined) {
  const round = db.getCurrentRound(roomId);
  if (!round) return;
  if (round.status !== 'active') return;

  // Check if user is eligible to guess
  const eligibleUsers = game.getEligibleGuessers(roomId, round.guess_item_id);
  const isEligible = eligibleUsers.some(u => u.id === userId);
  
  if (!isEligible) return;

  const options = game.ensureRoundOptions(roomId, round.round_number, round.guess_item_id);
  const validOptionIds = new Set(options.map(o => o.id));
  const guessedItemId = payload?.guessed_item_id;
  if (!guessedItemId || !validOptionIds.has(guessedItemId)) return;

  // Check if already guessed
  const existing = db.getGuessByUserAndRound(userId, round.round_number);
  if (existing) return;

  // Create guess
  db.createGuess(userId, round.guess_item_id, guessedItemId, round.round_number);
  game.refreshRoomState(roomId);

  // Check if all eligible users have guessed
  const guesses = db.getGuessesByRound(roomId, round.round_number);
  const allGuessed = guesses.length >= eligibleUsers.length;

  broadcastToRoom(roomId, {
    type: 'guess_submitted',
    payload: {
      user_id: userId,
      all_guessed: allGuessed,
      guess_count: guesses.length,
      total_eligible: eligibleUsers.length
    }
  });
  broadcastRoomState(roomId);
}

function handleRevealVotes(roomId: number, userId: number) {
  const user = db.getUserById(userId);
  if (!user?.is_host) return;

  const round = db.getCurrentRound(roomId);
  if (!round) return;

  db.updateRoundStatus(round.id, 'voting');

  const tallies = game.calculateVoteTallies(roomId, round.round_number);

  broadcastToRoom(roomId, {
    type: 'votes_revealed',
    payload: {
      tallies
    }
  });
  broadcastRoomState(roomId);
}

function handleRevealAnswer(roomId: number, userId: number) {
  const user = db.getUserById(userId);
  if (!user?.is_host) return;

  const round = db.getCurrentRound(roomId);
  if (!round) return;

  db.updateRoundStatus(round.id, 'revealed');

  // Award points
  game.awardPoints(roomId, round.round_number, round.guess_item_id);

  const correctItem = db.getGuessItemById(round.guess_item_id);
  const updatedUsers = db.getUsersByRoom(roomId);

  broadcastToRoom(roomId, {
    type: 'answer_revealed',
    payload: {
      correct_item: correctItem,
      users: updatedUsers
    }
  });
  broadcastRoomState(roomId);
}

function handleNextRound(roomId: number, userId: number) {
  const user = db.getUserById(userId);
  if (!user?.is_host) return;

  const hasNext = game.advanceToNextRound(roomId);

  if (hasNext) {
    startNextGuessingRound(roomId);
  } else {
    // Game finished
    const finalUsers = db.getUsersByRoom(roomId).sort((a, b) => b.score - a.score);
    
    broadcastToRoom(roomId, {
      type: 'game_finished',
      payload: {
        final_scores: finalUsers
      }
    });
    broadcastRoomState(roomId);
  }
}

function startNextGuessingRound(roomId: number) {
  const round = db.getCurrentRound(roomId);
  if (!round) return;
  const payload = buildRoundPayload(roomId, round.round_number, round.guess_item_id);

  // Send round info to all users
  broadcastToRoom(roomId, {
    type: 'round_started',
    payload
  });
  broadcastRoomState(roomId);
}

function buildRoundPayload(roomId: number, roundNumber: number, guessItemId: number) {
  const associations = db.getAssociationsByGuessItem(guessItemId);
  const options = game.ensureRoundOptions(roomId, roundNumber, guessItemId);
  const eligibleUsers = game.getEligibleGuessers(roomId, guessItemId);

  return {
    round_number: roundNumber,
    associations: associations.map(a => ({ value: a.value })),
    options,
    eligible_user_ids: eligibleUsers.map(u => u.id)
  };
}

function broadcastToRoom(roomId: number, message: WSMessage) {
  const connections = roomConnections.get(roomId);
  if (!connections) return;

  const messageStr = JSON.stringify(message);
  connections.forEach(ws => {
    try {
      ws.send(messageStr);
    } catch (error) {
      console.error('Error broadcasting to WebSocket:', error);
    }
  });
}

function sendToUser(roomId: number, userId: number, message: WSMessage) {
  const connections = roomConnections.get(roomId);
  if (!connections) return;

  const messageStr = JSON.stringify(message);
  connections.forEach(ws => {
    if (ws.data.userId === userId) {
      try {
        ws.send(messageStr);
      } catch (error) {
        console.error('Error sending to user:', error);
      }
    }
  });
}

function broadcastRoomState(roomId: number) {
  const state = game.getRoomState(roomId);
  if (!state) return;

  broadcastToRoom(roomId, {
    type: 'room_state',
    payload: state
  });
}

export { roomConnections };
