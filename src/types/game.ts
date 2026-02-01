// Game Types

export type RoomStatus = 'lobby' | 'submitting' | 'guessing' | 'lightning' | 'results' | 'finished';
export type RoundStatus = 'active' | 'voting' | 'revealed' | 'completed';

export interface Room {
  id: number;
  code: string;
  host_id: number;
  status: RoomStatus;
  created_at: number;
}

export interface User {
  id: number;
  nickname: string;
  room_id: number;
  score: number;
  is_host: boolean;
  joined_at: number;
}

export interface GuessItem {
  id: number;
  room_id: number;
  name: string;
  order_index: number;
}

export interface Association {
  id: number;
  user_id: number;
  guess_item_id: number;
  value: string;
  submitted_at: number;
}

export interface Guess {
  id: number;
  user_id: number;
  guess_item_id: number; // The item being guessed
  guessed_item_id: number; // The item they chose
  round_number: number;
  submitted_at: number;
}

export interface Round {
  id: number;
  room_id: number;
  guess_item_id: number;
  round_number: number;
  status: RoundStatus;
  revealed_at: number | null;
}

// WebSocket Message Types
export interface WSMessage {
  type: string;
  payload?: any;
}

export interface RoomState {
  room: Room;
  users: User[];
  guessItems: GuessItem[];
  currentRound: Round | null;
  associations: Association[];
  guesses: Guess[];
}

// Client-side vote tally
export interface VoteTally {
  guess_item_id: number;
  guess_item_name: string;
  vote_count: number;
}
