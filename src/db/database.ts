import { createClient, type RedisClientType } from "redis";
import type { Room, User, GuessItem, Association, Guess, Round, RoomStatus, RoundStatus } from "../types/game";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
export const redis: RedisClientType = createClient({ url: redisUrl });

redis.on("error", (err) => {
  console.error("Redis error:", err);
});

await redis.connect();

const ROOM_CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += ROOM_CODE_CHARS.charAt(Math.floor(Math.random() * ROOM_CODE_CHARS.length));
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

async function generateUniqueUserId(): Promise<number> {
  for (let attempts = 0; attempts < 10; attempts++) {
    const id = generateRandomId();
    const exists = await redis.exists(`user:${id}`);
    if (!exists) return id;
  }
  return Date.now() + Math.floor(Math.random() * 1000);
}

async function nextId(key: string): Promise<number> {
  const value = await redis.incr(key);
  return Number(value);
}

function parseNumber(value: string | undefined): number {
  return value ? Number(value) : 0;
}

function parseBoolean(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

async function getHash<T extends Record<string, any>>(key: string): Promise<T | null> {
  const data = await redis.hGetAll(key);
  if (!data || Object.keys(data).length === 0) return null;
  return data as T;
}

function toRoom(raw: Record<string, string>): Room {
  return {
    id: parseNumber(raw.id),
    code: raw.code,
    host_id: parseNumber(raw.host_id),
    status: raw.status as RoomStatus,
    created_at: parseNumber(raw.created_at)
  };
}

function toUser(raw: Record<string, string>): User {
  return {
    id: parseNumber(raw.id),
    nickname: raw.nickname,
    room_id: parseNumber(raw.room_id),
    score: parseNumber(raw.score),
    is_host: parseBoolean(raw.is_host),
    joined_at: parseNumber(raw.joined_at)
  };
}

function toGuessItem(raw: Record<string, string>): GuessItem {
  return {
    id: parseNumber(raw.id),
    room_id: parseNumber(raw.room_id),
    name: raw.name,
    order_index: parseNumber(raw.order_index)
  };
}

function toAssociation(raw: Record<string, string>): Association {
  return {
    id: parseNumber(raw.id),
    user_id: parseNumber(raw.user_id),
    guess_item_id: parseNumber(raw.guess_item_id),
    value: raw.value,
    submitted_at: parseNumber(raw.submitted_at)
  };
}

function toGuess(raw: Record<string, string>): Guess {
  return {
    id: parseNumber(raw.id),
    user_id: parseNumber(raw.user_id),
    guess_item_id: parseNumber(raw.guess_item_id),
    guessed_item_id: parseNumber(raw.guessed_item_id),
    round_number: parseNumber(raw.round_number),
    submitted_at: parseNumber(raw.submitted_at)
  };
}

function toRound(raw: Record<string, string>): Round {
  return {
    id: parseNumber(raw.id),
    room_id: parseNumber(raw.room_id),
    guess_item_id: parseNumber(raw.guess_item_id),
    round_number: parseNumber(raw.round_number),
    status: raw.status as RoundStatus,
    revealed_at: raw.revealed_at ? parseNumber(raw.revealed_at) : null
  };
}

export const createRoom = async (hostNickname: string): Promise<{ room: Room; host: User }> => {
  let code = generateRoomCode();
  let attempts = 0;

  while (attempts < 10) {
    const exists = await redis.exists(`rooms:code:${code}`);
    if (!exists) break;
    code = generateRoomCode();
    attempts++;
  }

  const roomId = await nextId("next:roomId");
  const now = Date.now();

  await redis.hSet(`room:${roomId}`, {
    id: roomId.toString(),
    code,
    host_id: "0",
    status: "lobby",
    created_at: now.toString()
  });
  await redis.set(`rooms:code:${code}`, roomId.toString());
  await redis.sAdd("rooms:ids", roomId.toString());

  const hostId = await generateUniqueUserId();
  await redis.hSet(`user:${hostId}`, {
    id: hostId.toString(),
    nickname: hostNickname,
    room_id: roomId.toString(),
    score: "0",
    is_host: "1",
    joined_at: now.toString()
  });
  await redis.zAdd(`room:${roomId}:users:z`, { score: now, value: hostId.toString() });

  await redis.hSet(`room:${roomId}`, { host_id: hostId.toString() });

  const room = await getRoomById(roomId);
  const host = await getUserById(hostId);

  if (!room || !host) throw new Error("Failed to create room");
  return { room, host };
};

export const getRoomByCode = async (code: string): Promise<Room | null> => {
  const roomId = await redis.get(`rooms:code:${code}`);
  if (!roomId) return null;
  return getRoomById(Number(roomId));
};

export const getRoomById = async (id: number): Promise<Room | null> => {
  const raw = await getHash<Record<string, string>>(`room:${id}`);
  return raw ? toRoom(raw) : null;
};

export const updateRoomStatus = async (roomId: number, status: RoomStatus): Promise<void> => {
  await redis.hSet(`room:${roomId}`, { status });
};

export const createUser = async (nickname: string, roomId: number): Promise<User> => {
  const now = Date.now();
  const userId = await generateUniqueUserId();
  await redis.hSet(`user:${userId}`, {
    id: userId.toString(),
    nickname,
    room_id: roomId.toString(),
    score: "0",
    is_host: "0",
    joined_at: now.toString()
  });
  await redis.zAdd(`room:${roomId}:users:z`, { score: now, value: userId.toString() });
  const user = await getUserById(userId);
  if (!user) throw new Error("Failed to create user");
  return user;
};

export const getUserById = async (id: number): Promise<User | null> => {
  const raw = await getHash<Record<string, string>>(`user:${id}`);
  return raw ? toUser(raw) : null;
};

export const getUsersByRoom = async (roomId: number): Promise<User[]> => {
  const userIds = await redis.zRange(`room:${roomId}:users:z`, 0, -1);
  if (userIds.length === 0) return [];

  const pipeline = redis.multi();
  userIds.forEach(id => pipeline.hGetAll(`user:${id}`));
  const results = (await pipeline.exec()) || [];

  return results
    .map(result => (result as Record<string, string>) || null)
    .filter((raw): raw is Record<string, string> => !!raw && Object.keys(raw).length > 0)
    .map(toUser);
};

export const removeUserFromRoom = async (roomId: number, userId: number): Promise<void> => {
  const multi = redis.multi();
  multi.zRem(`room:${roomId}:users:z`, userId.toString());
  multi.hDel(`room:${roomId}:assignments`, userId.toString());
  multi.del(`user:${userId}`);
  await multi.exec();
};

export const updateUserScore = async (userId: number, scoreIncrement: number): Promise<void> => {
  await redis.hIncrBy(`user:${userId}`, "score", scoreIncrement);
};

export const createGuessItems = async (roomId: number, items: string[]): Promise<GuessItem[]> => {
  const results: GuessItem[] = [];

  for (let index = 0; index < items.length; index++) {
    const item = items[index]!;
    const guessItemId = await nextId("next:guessItemId");

    await redis.hSet(`guess_item:${guessItemId}`, {
      id: guessItemId.toString(),
      room_id: roomId.toString(),
      name: item,
      order_index: index.toString()
    });
    await redis.zAdd(`room:${roomId}:guess_items:z`, { score: index, value: guessItemId.toString() });

    results.push({ id: guessItemId, room_id: roomId, name: item, order_index: index });
  }

  return results;
};

export const getGuessItemsByRoom = async (roomId: number): Promise<GuessItem[]> => {
  const ids = await redis.zRange(`room:${roomId}:guess_items:z`, 0, -1);
  if (ids.length === 0) return [];
  const pipeline = redis.multi();
  ids.forEach(id => pipeline.hGetAll(`guess_item:${id}`));
  const results = (await pipeline.exec()) || [];

  return results
    .map(result => (result as Record<string, string>) || null)
    .filter((raw): raw is Record<string, string> => !!raw && Object.keys(raw).length > 0)
    .map(toGuessItem);
};

export const getGuessItemById = async (id: number): Promise<GuessItem | null> => {
  const raw = await getHash<Record<string, string>>(`guess_item:${id}`);
  return raw ? toGuessItem(raw) : null;
};

export const createAssociation = async (userId: number, guessItemId: number, value: string): Promise<Association> => {
  const now = Date.now();
  const associationId = await nextId("next:associationId");
  const guessItem = await getGuessItemById(guessItemId);
  if (!guessItem) throw new Error("Guess item not found");

  await redis.hSet(`association:${associationId}`, {
    id: associationId.toString(),
    user_id: userId.toString(),
    guess_item_id: guessItemId.toString(),
    value,
    submitted_at: now.toString()
  });

  await redis.sAdd(`room:${guessItem.room_id}:associations`, associationId.toString());
  await redis.sAdd(`guess_item:${guessItemId}:associations`, associationId.toString());
  await redis.set(`assoc:user:${userId}:item:${guessItemId}`, associationId.toString());

  return { id: associationId, user_id: userId, guess_item_id: guessItemId, value, submitted_at: now };
};

export const getAssociationsByRoom = async (roomId: number): Promise<Association[]> => {
  const ids = await redis.sMembers(`room:${roomId}:associations`);
  if (ids.length === 0) return [];
  const pipeline = redis.multi();
  ids.forEach(id => pipeline.hGetAll(`association:${id}`));
  const results = (await pipeline.exec()) || [];

  return results
    .map(result => (result as Record<string, string>) || null)
    .filter((raw): raw is Record<string, string> => !!raw && Object.keys(raw).length > 0)
    .map(toAssociation);
};

export const getAssociationsByGuessItem = async (guessItemId: number): Promise<Association[]> => {
  const ids = await redis.sMembers(`guess_item:${guessItemId}:associations`);
  if (ids.length === 0) return [];
  const pipeline = redis.multi();
  ids.forEach(id => pipeline.hGetAll(`association:${id}`));
  const results = (await pipeline.exec()) || [];

  return results
    .map(result => (result as Record<string, string>) || null)
    .filter((raw): raw is Record<string, string> => !!raw && Object.keys(raw).length > 0)
    .map(toAssociation);
};

export const getAssociationByUserAndItem = async (userId: number, guessItemId: number): Promise<Association | null> => {
  const assocId = await redis.get(`assoc:user:${userId}:item:${guessItemId}`);
  if (!assocId) return null;
  const raw = await getHash<Record<string, string>>(`association:${assocId}`);
  return raw ? toAssociation(raw) : null;
};

export const setAssignments = async (roomId: number, assignments: Map<number, number>): Promise<void> => {
  await redis.del(`room:${roomId}:assignments`);
  if (assignments.size === 0) return;
  const data: Record<string, string> = {};
  assignments.forEach((guessItemId, userId) => {
    data[userId.toString()] = guessItemId.toString();
  });
  await redis.hSet(`room:${roomId}:assignments`, data);
};

export const getAssignmentByUser = async (
  roomId: number,
  userId: number
): Promise<{ user_id: number; guess_item_id: number } | null> => {
  const guessItemId = await redis.hGet(`room:${roomId}:assignments`, userId.toString());
  if (!guessItemId) return null;
  return { user_id: userId, guess_item_id: Number(guessItemId) };
};

export const getAssignmentsByRoom = async (
  roomId: number
): Promise<{ user_id: number; guess_item_id: number }[]> => {
  const data = await redis.hGetAll(`room:${roomId}:assignments`);
  return Object.entries(data).map(([userId, guessItemId]) => ({
    user_id: Number(userId),
    guess_item_id: Number(guessItemId)
  }));
};

export const createGuess = async (
  userId: number,
  guessItemId: number,
  guessedItemId: number,
  roundNumber: number
): Promise<Guess> => {
  const now = Date.now();
  const guessId = await nextId("next:guessId");
  const user = await getUserById(userId);
  if (!user) throw new Error("User not found");

  await redis.hSet(`guess:${guessId}`, {
    id: guessId.toString(),
    user_id: userId.toString(),
    guess_item_id: guessItemId.toString(),
    guessed_item_id: guessedItemId.toString(),
    round_number: roundNumber.toString(),
    submitted_at: now.toString()
  });

  await redis.sAdd(`room:${user.room_id}:guesses`, guessId.toString());
  await redis.sAdd(`room:${user.room_id}:round:${roundNumber}:guesses`, guessId.toString());

  return {
    id: guessId,
    user_id: userId,
    guess_item_id: guessItemId,
    guessed_item_id: guessedItemId,
    round_number: roundNumber,
    submitted_at: now
  };
};

export const getGuessesByRound = async (roomId: number, roundNumber: number): Promise<Guess[]> => {
  const ids = await redis.sMembers(`room:${roomId}:round:${roundNumber}:guesses`);
  if (ids.length === 0) return [];
  const pipeline = redis.multi();
  ids.forEach(id => pipeline.hGetAll(`guess:${id}`));
  const results = (await pipeline.exec()) || [];

  return results
    .map(result => (result as Record<string, string>) || null)
    .filter((raw): raw is Record<string, string> => !!raw && Object.keys(raw).length > 0)
    .map(toGuess);
};

export const getGuessesByRoom = async (roomId: number): Promise<Guess[]> => {
  const ids = await redis.sMembers(`room:${roomId}:guesses`);
  if (ids.length === 0) return [];
  const pipeline = redis.multi();
  ids.forEach(id => pipeline.hGetAll(`guess:${id}`));
  const results = (await pipeline.exec()) || [];

  return results
    .map(result => (result as Record<string, string>) || null)
    .filter((raw): raw is Record<string, string> => !!raw && Object.keys(raw).length > 0)
    .map(toGuess);
};

export const getGuessByUserAndRound = async (userId: number, roundNumber: number): Promise<Guess | null> => {
  const user = await getUserById(userId);
  if (!user) return null;
  const ids = await redis.sMembers(`room:${user.room_id}:round:${roundNumber}:guesses`);
  if (ids.length === 0) return null;

  const pipeline = redis.multi();
  ids.forEach(id => pipeline.hGetAll(`guess:${id}`));
  const results = (await pipeline.exec()) || [];

  for (const result of results) {
    const raw = result as Record<string, string>;
    if (raw && raw.user_id && Number(raw.user_id) === userId) {
      return toGuess(raw);
    }
  }

  return null;
};

export const createRound = async (roomId: number, guessItemId: number, roundNumber: number): Promise<Round> => {
  const roundId = await nextId("next:roundId");
  await redis.hSet(`round:${roundId}`, {
    id: roundId.toString(),
    room_id: roomId.toString(),
    guess_item_id: guessItemId.toString(),
    round_number: roundNumber.toString(),
    status: "active",
    revealed_at: ""
  });
  await redis.zAdd(`room:${roomId}:rounds:z`, { score: roundNumber, value: roundId.toString() });

  return {
    id: roundId,
    room_id: roomId,
    guess_item_id: guessItemId,
    round_number: roundNumber,
    status: "active",
    revealed_at: null
  };
};

export const getCurrentRound = async (roomId: number): Promise<Round | null> => {
  const ids = await redis.zRange(`room:${roomId}:rounds:z`, -1, -1);
  if (ids.length === 0) return null;
  const raw = await getHash<Record<string, string>>(`round:${ids[0]}`);
  return raw ? toRound(raw) : null;
};

export const updateRoundStatus = async (roundId: number, status: RoundStatus): Promise<void> => {
  const now = status === "revealed" ? Date.now() : 0;
  await redis.hSet(`round:${roundId}`, {
    status,
    revealed_at: now ? now.toString() : ""
  });
};

export const setRoundOptions = async (
  roomId: number,
  roundNumber: number,
  guessItemIds: number[]
): Promise<void> => {
  const key = `room:${roomId}:round:${roundNumber}:options`;
  await redis.del(key);
  if (guessItemIds.length === 0) return;
  await redis.rPush(key, guessItemIds.map(String));
};

export const getRoundOptions = async (roomId: number, roundNumber: number): Promise<GuessItem[]> => {
  const ids = await redis.lRange(`room:${roomId}:round:${roundNumber}:options`, 0, -1);
  if (ids.length === 0) return [];
  const pipeline = redis.multi();
  ids.forEach(id => pipeline.hGetAll(`guess_item:${id}`));
  const results = (await pipeline.exec()) || [];

  return results
    .map(result => (result as Record<string, string>) || null)
    .filter((raw): raw is Record<string, string> => !!raw && Object.keys(raw).length > 0)
    .map(toGuessItem);
};

export const clearRoundQueue = async (roomId: number): Promise<void> => {
  await redis.del(`room:${roomId}:queue:standard`, `room:${roomId}:queue:lightning`);
};

export const setRoundQueue = async (
  roomId: number,
  phase: "standard" | "lightning",
  guessItemIds: number[]
): Promise<void> => {
  const key = `room:${roomId}:queue:${phase}`;
  await redis.del(key);
  if (guessItemIds.length === 0) return;
  await redis.rPush(key, guessItemIds.map(String));
};

export const getNextQueuedItem = async (
  roomId: number,
  phase: "standard" | "lightning"
): Promise<{ guess_item_id: number } | null> => {
  const id = await redis.lIndex(`room:${roomId}:queue:${phase}`, 0);
  if (!id) return null;
  return { guess_item_id: Number(id) };
};

export const markQueuedItemPlayed = async (
  roomId: number,
  phase: "standard" | "lightning",
  guessItemId: number
): Promise<void> => {
  const key = `room:${roomId}:queue:${phase}`;
  const popped = await redis.lPop(key);
  if (popped && Number(popped) !== guessItemId) {
    await redis.lRem(key, 1, guessItemId.toString());
  }
};
