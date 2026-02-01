-- Rabble Game Database Schema

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
