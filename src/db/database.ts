import { Database } from "bun:sqlite";
import type { Room, User, GuessItem, Association, Guess, Round, RoomStatus, RoundStatus } from "../types/game";

const db = new Database("rabble.sqlite");

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    host_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname TEXT NOT NULL,
    room_id INTEGER NOT NULL,
    score INTEGER DEFAULT 0,
    is_host BOOLEAN DEFAULT 0,
    joined_at INTEGER NOT NULL,
    FOREIGN KEY (room_id) REFERENCES rooms(id)
  );

  CREATE TABLE IF NOT EXISTS guess_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    order_index INTEGER NOT NULL,
    FOREIGN KEY (room_id) REFERENCES rooms(id)
  );

  CREATE TABLE IF NOT EXISTS associations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    guess_item_id INTEGER NOT NULL,
    value TEXT NOT NULL,
    submitted_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (guess_item_id) REFERENCES guess_items(id)
  );

  CREATE TABLE IF NOT EXISTS guesses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    guess_item_id INTEGER NOT NULL,
    guessed_item_id INTEGER NOT NULL,
    round_number INTEGER NOT NULL,
    submitted_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (guess_item_id) REFERENCES guess_items(id),
    FOREIGN KEY (guessed_item_id) REFERENCES guess_items(id)
  );

  CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    guess_item_id INTEGER NOT NULL,
    round_number INTEGER NOT NULL,
    status TEXT NOT NULL,
    revealed_at INTEGER,
    FOREIGN KEY (room_id) REFERENCES rooms(id),
    FOREIGN KEY (guess_item_id) REFERENCES guess_items(id)
  );

  CREATE TABLE IF NOT EXISTS assignments (
    room_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    guess_item_id INTEGER NOT NULL,
    assigned_at INTEGER NOT NULL,
    PRIMARY KEY (room_id, user_id),
    FOREIGN KEY (room_id) REFERENCES rooms(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (guess_item_id) REFERENCES guess_items(id)
  );

  CREATE TABLE IF NOT EXISTS round_options (
    room_id INTEGER NOT NULL,
    round_number INTEGER NOT NULL,
    guess_item_id INTEGER NOT NULL,
    option_order INTEGER NOT NULL,
    PRIMARY KEY (room_id, round_number, option_order),
    FOREIGN KEY (room_id) REFERENCES rooms(id),
    FOREIGN KEY (guess_item_id) REFERENCES guess_items(id)
  );

  CREATE TABLE IF NOT EXISTS round_queue (
    room_id INTEGER NOT NULL,
    phase TEXT NOT NULL,
    position INTEGER NOT NULL,
    guess_item_id INTEGER NOT NULL,
    played INTEGER DEFAULT 0,
    PRIMARY KEY (room_id, phase, position),
    FOREIGN KEY (room_id) REFERENCES rooms(id),
    FOREIGN KEY (guess_item_id) REFERENCES guess_items(id)
  );

  CREATE INDEX IF NOT EXISTS idx_users_room ON users(room_id);
  CREATE INDEX IF NOT EXISTS idx_guess_items_room ON guess_items(room_id);
  CREATE INDEX IF NOT EXISTS idx_associations_user ON associations(user_id);
  CREATE INDEX IF NOT EXISTS idx_associations_item ON associations(guess_item_id);
  CREATE INDEX IF NOT EXISTS idx_guesses_user ON guesses(user_id);
  CREATE INDEX IF NOT EXISTS idx_rounds_room ON rounds(room_id);
  CREATE INDEX IF NOT EXISTS idx_assignments_room ON assignments(room_id);
  CREATE INDEX IF NOT EXISTS idx_assignments_user ON assignments(user_id);
  CREATE INDEX IF NOT EXISTS idx_round_options_room_round ON round_options(room_id, round_number);
  CREATE INDEX IF NOT EXISTS idx_round_queue_room_phase_played ON round_queue(room_id, phase, played);
`);

// Helper to generate 4-letter room code
function generateRoomCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function generateRandomId(): number {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  const high = buf[0]! & 0x1fffff; // 21 bits
  const low = buf[1]!;
  return high * 2 ** 32 + low;
}

function generateUniqueUserId(): number {
  for (let attempts = 0; attempts < 10; attempts++) {
    const id = generateRandomId();
    const existing = db.query("SELECT id FROM users WHERE id = ?").get(id);
    if (!existing) return id;
  }
  // Fallback to time-based id if random collides repeatedly
  return Date.now() + Math.floor(Math.random() * 1000);
}

// Room operations
export const createRoom = (hostNickname: string): { room: Room; host: User } => {
  let code = generateRoomCode();
  let attempts = 0;
  
  // Ensure unique code
  while (attempts < 10) {
    const existing = db.query("SELECT id FROM rooms WHERE code = ?").get(code);
    if (!existing) break;
    code = generateRoomCode();
    attempts++;
  }

  const now = Date.now();
  const roomResult = db.query("INSERT INTO rooms (code, host_id, status, created_at) VALUES (?, ?, ?, ?) RETURNING *")
    .get(code, 0, 'lobby', now) as Room; // host_id will be updated after user creation

  const hostId = generateUniqueUserId();
  const hostResult = db.query("INSERT INTO users (id, nickname, room_id, score, is_host, joined_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *")
    .get(hostId, hostNickname, roomResult.id, 0, 1, now) as User;

  // Update room with actual host_id
  db.query("UPDATE rooms SET host_id = ? WHERE id = ?").run(hostResult.id, roomResult.id);
  roomResult.host_id = hostResult.id;

  return { room: roomResult, host: hostResult };
};

export const getRoomByCode = (code: string): Room | null => {
  return db.query("SELECT * FROM rooms WHERE code = ?").get(code) as Room | null;
};

export const getRoomById = (id: number): Room | null => {
  return db.query("SELECT * FROM rooms WHERE id = ?").get(id) as Room | null;
};

export const updateRoomStatus = (roomId: number, status: RoomStatus): void => {
  db.query("UPDATE rooms SET status = ? WHERE id = ?").run(status, roomId);
};

// User operations
export const createUser = (nickname: string, roomId: number): User => {
  const now = Date.now();
  const userId = generateUniqueUserId();
  return db.query("INSERT INTO users (id, nickname, room_id, score, is_host, joined_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *")
    .get(userId, nickname, roomId, 0, 0, now) as User;
};

export const getUserById = (id: number): User | null => {
  return db.query("SELECT * FROM users WHERE id = ?").get(id) as User | null;
};

export const getUsersByRoom = (roomId: number): User[] => {
  return db.query("SELECT * FROM users WHERE room_id = ? ORDER BY joined_at").all(roomId) as User[];
};

export const updateUserScore = (userId: number, scoreIncrement: number): void => {
  db.query("UPDATE users SET score = score + ? WHERE id = ?").run(scoreIncrement, userId);
};

// GuessItem operations
export const createGuessItems = (roomId: number, items: string[]): GuessItem[] => {
  const results: GuessItem[] = [];
  items.forEach((item, index) => {
    const result = db.query("INSERT INTO guess_items (room_id, name, order_index) VALUES (?, ?, ?) RETURNING *")
      .get(roomId, item.trim(), index) as GuessItem;
    results.push(result);
  });
  return results;
};

export const getGuessItemsByRoom = (roomId: number): GuessItem[] => {
  return db.query("SELECT * FROM guess_items WHERE room_id = ? ORDER BY order_index").all(roomId) as GuessItem[];
};

export const getGuessItemById = (id: number): GuessItem | null => {
  return db.query("SELECT * FROM guess_items WHERE id = ?").get(id) as GuessItem | null;
};

// Association operations
export const createAssociation = (userId: number, guessItemId: number, value: string): Association => {
  const now = Date.now();
  return db.query("INSERT INTO associations (user_id, guess_item_id, value, submitted_at) VALUES (?, ?, ?, ?) RETURNING *")
    .get(userId, guessItemId, value, now) as Association;
};

export const getAssociationsByRoom = (roomId: number): Association[] => {
  return db.query(`
    SELECT a.* FROM associations a
    JOIN users u ON a.user_id = u.id
    WHERE u.room_id = ?
  `).all(roomId) as Association[];
};

export const getAssociationsByGuessItem = (guessItemId: number): Association[] => {
  return db.query("SELECT * FROM associations WHERE guess_item_id = ?").all(guessItemId) as Association[];
};

export const getAssociationByUserAndItem = (userId: number, guessItemId: number): Association | null => {
  return db.query("SELECT * FROM associations WHERE user_id = ? AND guess_item_id = ?")
    .get(userId, guessItemId) as Association | null;
};

// Assignment operations
export const setAssignments = (roomId: number, assignments: Map<number, number>): void => {
  const insert = db.query(
    "INSERT OR REPLACE INTO assignments (room_id, user_id, guess_item_id, assigned_at) VALUES (?, ?, ?, ?)"
  );
  const clear = db.query("DELETE FROM assignments WHERE room_id = ?");

  const now = Date.now();
  db.transaction(() => {
    clear.run(roomId);
    for (const [userId, guessItemId] of assignments.entries()) {
      insert.run(roomId, userId, guessItemId, now);
    }
  })();
};

export const getAssignmentByUser = (roomId: number, userId: number): { user_id: number; guess_item_id: number } | null => {
  return db
    .query("SELECT user_id, guess_item_id FROM assignments WHERE room_id = ? AND user_id = ?")
    .get(roomId, userId) as { user_id: number; guess_item_id: number } | null;
};

export const getAssignmentsByRoom = (roomId: number): { user_id: number; guess_item_id: number }[] => {
  return db
    .query("SELECT user_id, guess_item_id FROM assignments WHERE room_id = ?")
    .all(roomId) as { user_id: number; guess_item_id: number }[];
};

// Guess operations
export const createGuess = (userId: number, guessItemId: number, guessedItemId: number, roundNumber: number): Guess => {
  const now = Date.now();
  return db.query("INSERT INTO guesses (user_id, guess_item_id, guessed_item_id, round_number, submitted_at) VALUES (?, ?, ?, ?, ?) RETURNING *")
    .get(userId, guessItemId, guessedItemId, roundNumber, now) as Guess;
};

export const getGuessesByRound = (roomId: number, roundNumber: number): Guess[] => {
  return db.query(`
    SELECT g.* FROM guesses g
    JOIN users u ON g.user_id = u.id
    WHERE u.room_id = ? AND g.round_number = ?
  `).all(roomId, roundNumber) as Guess[];
};

export const getGuessesByRoom = (roomId: number): Guess[] => {
  return db.query(`
    SELECT g.* FROM guesses g
    JOIN users u ON g.user_id = u.id
    WHERE u.room_id = ?
  `).all(roomId) as Guess[];
};

export const getGuessByUserAndRound = (userId: number, roundNumber: number): Guess | null => {
  return db.query("SELECT * FROM guesses WHERE user_id = ? AND round_number = ?")
    .get(userId, roundNumber) as Guess | null;
};

// Round operations
export const createRound = (roomId: number, guessItemId: number, roundNumber: number): Round => {
  return db.query("INSERT INTO rounds (room_id, guess_item_id, round_number, status, revealed_at) VALUES (?, ?, ?, ?, ?) RETURNING *")
    .get(roomId, guessItemId, roundNumber, 'active', null) as Round;
};

export const getCurrentRound = (roomId: number): Round | null => {
  return db.query("SELECT * FROM rounds WHERE room_id = ? ORDER BY round_number DESC LIMIT 1")
    .get(roomId) as Round | null;
};

export const updateRoundStatus = (roundId: number, status: RoundStatus): void => {
  const now = status === 'revealed' ? Date.now() : null;
  db.query("UPDATE rounds SET status = ?, revealed_at = ? WHERE id = ?").run(status, now, roundId);
};

// Round options operations
export const setRoundOptions = (roomId: number, roundNumber: number, guessItemIds: number[]): void => {
  const clear = db.query("DELETE FROM round_options WHERE room_id = ? AND round_number = ?");
  const insert = db.query(
    "INSERT INTO round_options (room_id, round_number, guess_item_id, option_order) VALUES (?, ?, ?, ?)"
  );

  db.transaction(() => {
    clear.run(roomId, roundNumber);
    guessItemIds.forEach((guessItemId, index) => {
      insert.run(roomId, roundNumber, guessItemId, index);
    });
  })();
};

export const getRoundOptions = (roomId: number, roundNumber: number): GuessItem[] => {
  return db.query(`
    SELECT gi.* FROM round_options ro
    JOIN guess_items gi ON gi.id = ro.guess_item_id
    WHERE ro.room_id = ? AND ro.round_number = ?
    ORDER BY ro.option_order
  `).all(roomId, roundNumber) as GuessItem[];
};

// Round queue operations
export const clearRoundQueue = (roomId: number): void => {
  db.query("DELETE FROM round_queue WHERE room_id = ?").run(roomId);
};

export const setRoundQueue = (roomId: number, phase: 'standard' | 'lightning', guessItemIds: number[]): void => {
  const clear = db.query("DELETE FROM round_queue WHERE room_id = ? AND phase = ?");
  const insert = db.query(
    "INSERT INTO round_queue (room_id, phase, position, guess_item_id, played) VALUES (?, ?, ?, ?, 0)"
  );

  db.transaction(() => {
    clear.run(roomId, phase);
    guessItemIds.forEach((guessItemId, index) => {
      insert.run(roomId, phase, index + 1, guessItemId);
    });
  })();
};

export const getNextQueuedItem = (
  roomId: number,
  phase: 'standard' | 'lightning'
): { guess_item_id: number } | null => {
  return db.query(
    "SELECT guess_item_id FROM round_queue WHERE room_id = ? AND phase = ? AND played = 0 ORDER BY position ASC LIMIT 1"
  ).get(roomId, phase) as { guess_item_id: number } | null;
};

export const markQueuedItemPlayed = (
  roomId: number,
  phase: 'standard' | 'lightning',
  guessItemId: number
): void => {
  db.query(
    "UPDATE round_queue SET played = 1 WHERE room_id = ? AND phase = ? AND guess_item_id = ?"
  ).run(roomId, phase, guessItemId);
};

export { db };
