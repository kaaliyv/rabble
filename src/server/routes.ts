import type { ServerWebSocket } from "bun";
import * as db from "../db/database";
import * as game from "./game-logic";

export const routes = {
  // Create a new room
  "POST /api/room/create": async (req: Request) => {
    const body = await req.json();
    const rawNickname = (body?.nickname ?? "").toString().trim();
    const nickname = rawNickname.slice(0, 20);

    if (!nickname || nickname.trim().length === 0) {
      return Response.json({ error: "Nickname is required" }, { status: 400 });
    }

    try {
      const { room, host } = await db.createRoom(nickname);
      await game.initializeRoomState(room.id);

      return Response.json({
        room,
        user: host
      });
    } catch (error) {
      console.error("Error creating room:", error);
      return Response.json({ error: "Failed to create room" }, { status: 500 });
    }
  },

  // Join an existing room
  "POST /api/room/join": async (req: Request) => {
    const body = await req.json();
    const code = (body?.code ?? "").toString().trim();
    const rawNickname = (body?.nickname ?? "").toString().trim();
    const nickname = rawNickname.slice(0, 20);

    if (!code || !nickname) {
      return Response.json({ error: "Code and nickname are required" }, { status: 400 });
    }

    try {
      const room = await db.getRoomByCode(code.toUpperCase());

      if (!room) {
        return Response.json({ error: "Room not found" }, { status: 404 });
      }

      if (room.status !== "lobby") {
        return Response.json({ error: "Room has already started" }, { status: 400 });
      }

      const users = await db.getUsersByRoom(room.id);
      if (users.length >= 50) {
        return Response.json({ error: "Room is full" }, { status: 400 });
      }

      const user = await db.createUser(nickname, room.id);
      await game.refreshRoomState(room.id);

      return Response.json({
        room,
        user
      });
    } catch (error) {
      console.error("Error joining room:", error);
      return Response.json({ error: "Failed to join room" }, { status: 500 });
    }
  },

  // Reconnect to an existing user in a room
  "POST /api/room/reconnect": async (req: Request) => {
    const body = await req.json();
    const code = (body?.code ?? "").toString().trim();
    const userId = Number(body?.userId);

    if (!code || !Number.isInteger(userId)) {
      return Response.json({ error: "Code and userId are required" }, { status: 400 });
    }

    try {
      const room = await db.getRoomByCode(code.toUpperCase());
      if (!room) {
        return Response.json({ error: "Room not found" }, { status: 404 });
      }

      const user = await db.getUserById(userId);
      if (!user || user.room_id !== room.id) {
        return Response.json({ error: "User not found" }, { status: 404 });
      }

      await game.refreshRoomState(room.id);

      return Response.json({
        room,
        user
      });
    } catch (error) {
      console.error("Error reconnecting:", error);
      return Response.json({ error: "Failed to reconnect" }, { status: 500 });
    }
  },

  // Get room state
  "GET /api/room/:code": async (req: Request) => {
    const url = new URL(req.url);
    const code = url.pathname.split("/").pop();

    if (!code) {
      return Response.json({ error: "Room code is required" }, { status: 400 });
    }

    try {
      const room = await db.getRoomByCode(code.toUpperCase());

      if (!room) {
        return Response.json({ error: "Room not found" }, { status: 404 });
      }

      const state = (await game.getRoomState(room.id)) || (await game.initializeRoomState(room.id));

      return Response.json(state);
    } catch (error) {
      console.error("Error getting room:", error);
      return Response.json({ error: "Failed to get room" }, { status: 500 });
    }
  },

  // Health check
  "GET /api/health": async (req: Request) => {
    return Response.json({ status: "ok" });
  }
};

export async function handleRoute(req: Request): Promise<Response | null> {
  const url = new URL(req.url);
  const method = req.method;
  const path = url.pathname;

  // Try exact match first
  const exactKey = `${method} ${path}`;
  if (routes[exactKey as keyof typeof routes]) {
    return routes[exactKey as keyof typeof routes](req) as any;
  }

  // Try pattern match for parameterized routes
  for (const [pattern, handler] of Object.entries(routes)) {
    const [routeMethod, routePath] = pattern.split(" ");

    if (method !== routeMethod) continue;

    // Convert route pattern to regex
    const regexPattern = routePath.replace(/:[^/]+/g, "([^/]+)");
    const regex = new RegExp(`^${regexPattern}$`);

    if (regex.test(path)) {
      return handler(req) as any;
    }
  }

  return null;
}
