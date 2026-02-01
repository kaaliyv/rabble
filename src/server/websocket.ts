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
  async open(ws: ServerWebSocket<WebSocketData>) {
    const { roomId, userId } = ws.data;
    const room = await db.getRoomById(roomId);
    const user = await db.getUserById(userId);

    if (!room || !user || user.room_id !== roomId) {
      ws.close(1008, "Invalid room or user");
      return;
    }

    if (!roomConnections.has(roomId)) {
      roomConnections.set(roomId, new Set());
    }
    roomConnections.get(roomId)!.add(ws);

    console.log(`User ${userId} connected to room ${roomId}`);

    const state = (await game.getRoomState(roomId)) || (await game.initializeRoomState(roomId));
    ws.send(JSON.stringify({ type: "room_state", payload: state }));

    if (state.room.status === "submitting") {
      const assignment = await db.getAssignmentByUser(roomId, userId);
      if (assignment) {
        const guessItem = await db.getGuessItemById(assignment.guess_item_id);
        ws.send(JSON.stringify({
          type: "assignment",
          payload: {
            guess_item_id: assignment.guess_item_id,
            guess_item_name: guessItem?.name
          }
        }));
      }
    }

    if ((state.room.status === "guessing" || state.room.status === "lightning") && state.currentRound) {
      const roundPayload = await buildRoundPayload(
        roomId,
        state.currentRound.round_number,
        state.currentRound.guess_item_id,
        state.room.status
      );
      ws.send(JSON.stringify({ type: "round_started", payload: roundPayload }));
    }

    await broadcastRoomState(roomId);
  },

  async message(ws: ServerWebSocket<WebSocketData>, message: string) {
    try {
      const msg: WSMessage = JSON.parse(message);
      await handleMessage(ws, msg);
    } catch (error) {
      console.error("WebSocket message error:", error);
      ws.send(JSON.stringify({
        type: "error",
        payload: { message: "Invalid message format" }
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

async function handleMessage(ws: ServerWebSocket<WebSocketData>, msg: WSMessage) {
  const { roomId, userId } = ws.data;

  switch (msg.type) {
    case "start_game":
      await handleStartGame(roomId, userId, msg.payload);
      break;

    case "submit_association":
      await handleSubmitAssociation(roomId, userId, msg.payload);
      break;

    case "submit_guess":
      await handleSubmitGuess(roomId, userId, msg.payload);
      break;

    case "reveal_votes":
      await handleRevealVotes(roomId, userId);
      break;

    case "reveal_answer":
      await handleRevealAnswer(roomId, userId);
      break;

    case "next_round":
      await handleNextRound(roomId, userId);
      break;

    case "skip_stage":
      await handleSkipStage(roomId, userId);
      break;

    case "cancel_game":
      await handleCancelGame(roomId, userId);
      break;

    default:
      ws.send(JSON.stringify({
        type: "error",
        payload: { message: "Unknown message type" }
      }));
  }
}

async function handleStartGame(roomId: number, userId: number, payload: { items?: string[] } | undefined) {
  const user = await db.getUserById(userId);
  const room = await db.getRoomById(roomId);

  if (!user?.is_host || !room) return;
  if (room.status !== "lobby") return;

  const rawItems = Array.isArray(payload?.items) ? payload.items : [];
  const items = Array.from(
    new Set(
      rawItems
        .map(item => (item ?? "").toString().trim())
        .filter(item => item.length > 0)
        .map(item => item.slice(0, 50))
    )
  );

  const users = await db.getUsersByRoom(roomId);
  const players = users.filter(u => !u.is_host);

  if (players.length < 4) {
    sendToUser(roomId, userId, {
      type: "error",
      payload: { message: "Need at least 4 players to start" }
    });
    return;
  }

  if (items.length < 4) {
    sendToUser(roomId, userId, {
      type: "error",
      payload: { message: "Please enter at least 4 items" }
    });
    return;
  }

  if (items.length > players.length) {
    sendToUser(roomId, userId, {
      type: "error",
      payload: { message: "Number of items cannot exceed number of players" }
    });
    return;
  }

  await db.createGuessItems(roomId, items);

  const assignments = await game.startSubmissionPhase(roomId);
  await db.setAssignments(roomId, assignments);

  broadcastToRoom(roomId, {
    type: "game_started",
    payload: {
      state: await game.getRoomState(roomId)
    }
  });
  await broadcastRoomState(roomId);

  for (const [assignedUserId, guessItemId] of assignments.entries()) {
    const guessItem = await db.getGuessItemById(guessItemId);
    sendToUser(roomId, assignedUserId, {
      type: "assignment",
      payload: {
        guess_item_id: guessItemId,
        guess_item_name: guessItem?.name
      }
    });
  }
}

async function handleSubmitAssociation(roomId: number, userId: number, payload: { value?: string } | undefined) {
  const room = await db.getRoomById(roomId);
  if (!room || room.status !== "submitting") return;
  const assignment = await db.getAssignmentByUser(roomId, userId);
  if (!assignment) return;
  const guessItemId = assignment.guess_item_id;

  const existing = await db.getAssociationByUserAndItem(userId, guessItemId);
  if (existing) return;

  const value = (payload?.value ?? "").toString().trim();
  if (!value) return;

  const normalized = value.slice(0, 30);

  await db.createAssociation(userId, guessItemId, normalized);
  await game.refreshRoomState(roomId);

  const assignments = new Map(
    (await db.getAssignmentsByRoom(roomId)).map(a => [a.user_id, a.guess_item_id])
  );
  const allSubmitted = await game.checkAllSubmitted(roomId, assignments);

  broadcastToRoom(roomId, {
    type: "association_submitted",
    payload: {
      user_id: userId,
      all_submitted: allSubmitted
    }
  });
  await broadcastRoomState(roomId);

  if (allSubmitted) {
    await game.startGuessingPhase(roomId);
    await startNextGuessingRound(roomId);
  }
}

async function handleSubmitGuess(
  roomId: number,
  userId: number,
  payload: { guessed_item_id?: number } | undefined
) {
  const round = await db.getCurrentRound(roomId);
  if (!round) return;
  if (round.status !== "active") return;

  const eligibleUsers = await game.getEligibleGuessers(roomId, round.guess_item_id);
  const isEligible = eligibleUsers.some(u => u.id === userId);
  if (!isEligible) return;

  const options = await game.ensureRoundOptions(roomId, round.round_number, round.guess_item_id);
  const validOptionIds = new Set(options.map(o => o.id));
  const guessedItemId = payload?.guessed_item_id;
  if (!guessedItemId || !validOptionIds.has(guessedItemId)) return;

  const existing = await db.getGuessByUserAndRound(userId, round.round_number);
  if (existing) return;

  await db.createGuess(userId, round.guess_item_id, guessedItemId, round.round_number);
  await game.refreshRoomState(roomId);

  const guesses = await db.getGuessesByRound(roomId, round.round_number);
  const allGuessed = guesses.length >= eligibleUsers.length;

  broadcastToRoom(roomId, {
    type: "guess_submitted",
    payload: {
      user_id: userId,
      all_guessed: allGuessed,
      guess_count: guesses.length,
      total_eligible: eligibleUsers.length
    }
  });
  await broadcastRoomState(roomId);
}

async function handleRevealVotes(roomId: number, userId: number) {
  const user = await db.getUserById(userId);
  if (!user?.is_host) return;

  const round = await db.getCurrentRound(roomId);
  if (!round) return;

  await db.updateRoundStatus(round.id, "voting");

  const tallies = await game.calculateVoteTallies(roomId, round.round_number);

  broadcastToRoom(roomId, {
    type: "votes_revealed",
    payload: {
      tallies
    }
  });
  await broadcastRoomState(roomId);
}

async function handleRevealAnswer(roomId: number, userId: number) {
  const user = await db.getUserById(userId);
  if (!user?.is_host) return;

  const round = await db.getCurrentRound(roomId);
  if (!round) return;

  await db.updateRoundStatus(round.id, "revealed");

  await game.awardPoints(roomId, round.round_number, round.guess_item_id);

  const correctItem = await db.getGuessItemById(round.guess_item_id);
  const updatedUsers = await db.getUsersByRoom(roomId);

  broadcastToRoom(roomId, {
    type: "answer_revealed",
    payload: {
      correct_item: correctItem,
      users: updatedUsers
    }
  });
  await broadcastRoomState(roomId);
}

async function handleNextRound(roomId: number, userId: number) {
  const user = await db.getUserById(userId);
  if (!user?.is_host) return;

  const hasNext = await game.advanceToNextRound(roomId);

  if (hasNext) {
    await startNextGuessingRound(roomId);
  } else {
    const finalUsers = (await db.getUsersByRoom(roomId)).sort((a, b) => b.score - a.score);

    broadcastToRoom(roomId, {
      type: "game_finished",
      payload: {
        final_scores: finalUsers
      }
    });
    await broadcastRoomState(roomId);
  }
}

async function handleSkipStage(roomId: number, userId: number) {
  const user = await db.getUserById(userId);
  if (!user?.is_host) return;

  const room = await db.getRoomById(roomId);
  if (!room) return;

  if (room.status === "submitting") {
    await game.startGuessingPhase(roomId);
    await startNextGuessingRound(roomId);
    return;
  }

  if (room.status === "guessing" || room.status === "lightning") {
    const round = await db.getCurrentRound(roomId);
    if (!round) return;

    if (round.status === "active") {
      await db.updateRoundStatus(round.id, "voting");
      const tallies = await game.calculateVoteTallies(roomId, round.round_number);
      broadcastToRoom(roomId, {
        type: "votes_revealed",
        payload: { tallies }
      });
      await broadcastRoomState(roomId);
      return;
    }

    if (round.status === "voting") {
      await db.updateRoundStatus(round.id, "revealed");
      await game.awardPoints(roomId, round.round_number, round.guess_item_id);
      const correctItem = await db.getGuessItemById(round.guess_item_id);
      const updatedUsers = await db.getUsersByRoom(roomId);

      broadcastToRoom(roomId, {
        type: "answer_revealed",
        payload: {
          correct_item: correctItem,
          users: updatedUsers
        }
      });
      await broadcastRoomState(roomId);
      return;
    }

    if (round.status === "revealed") {
      await handleNextRound(roomId, userId);
      return;
    }
  }
}

async function handleCancelGame(roomId: number, userId: number) {
  const user = await db.getUserById(userId);
  if (!user?.is_host) return;

  const room = await db.getRoomById(roomId);
  if (!room) return;

  if (room.status !== "lobby") return;

  await db.updateRoomStatus(roomId, "finished");

  broadcastToRoom(roomId, {
    type: "game_cancelled",
    payload: { message: "The host cancelled the game." }
  });
}

async function startNextGuessingRound(roomId: number) {
  const round = await db.getCurrentRound(roomId);
  if (!round) return;
  const room = await db.getRoomById(roomId);
  const phase = room?.status === "lightning" ? "lightning" : "guessing";
  const payload = await buildRoundPayload(roomId, round.round_number, round.guess_item_id, phase);

  broadcastToRoom(roomId, {
    type: "round_started",
    payload
  });
  await broadcastRoomState(roomId);
}

async function buildRoundPayload(
  roomId: number,
  roundNumber: number,
  guessItemId: number,
  phase: "guessing" | "lightning"
) {
  const associations = await db.getAssociationsByGuessItem(guessItemId);
  const options = await game.ensureRoundOptions(roomId, roundNumber, guessItemId);
  const eligibleUsers = await game.getEligibleGuessers(roomId, guessItemId);

  return {
    round_number: roundNumber,
    associations: associations.map(a => ({ value: a.value })),
    options,
    eligible_user_ids: eligibleUsers.map(u => u.id),
    phase
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
      console.error("Error broadcasting to WebSocket:", error);
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
        console.error("Error sending to user:", error);
      }
    }
  });
}

async function broadcastRoomState(roomId: number) {
  const state = await game.getRoomState(roomId);
  if (!state) return;

  broadcastToRoom(roomId, {
    type: "room_state",
    payload: state
  });
}

export { roomConnections };
