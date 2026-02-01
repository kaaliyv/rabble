import plugin from "bun-plugin-tailwind";
import { handleRoute } from "./server/routes";
import { handleWebSocket } from "./server/websocket";

const distIndex = Bun.file("./dist/index.html");

if (process.env.NODE_ENV !== "production") {
  const hasDist = await distIndex.exists();
  if (!hasDist) {
    await Bun.build({
      entrypoints: ["./src/index.html"],
      outdir: "./dist",
      plugins: [plugin],
      target: "browser"
    });
  }
}

const hasDistBuild = await distIndex.exists();
const publicDir = hasDistBuild ? "./dist" : "./src";

const server = Bun.serve({
  port: 3000,
  
  async fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (url.pathname === "/ws") {
      const upgradeUrl = new URL(req.url);
      const roomId = upgradeUrl.searchParams.get("roomId");
      const userId = upgradeUrl.searchParams.get("userId");

      if (!roomId || !userId) {
        return new Response("Missing roomId or userId", { status: 400 });
      }

      const success = server.upgrade(req, {
        data: {
          roomId: parseInt(roomId),
          userId: parseInt(userId)
        }
      });

      if (success) {
        return undefined as any;
      }

      return new Response("WebSocket upgrade failed", { status: 500 });
    }

    // API routes
    const routeResponse = await handleRoute(req);
    if (routeResponse) {
      return routeResponse;
    }

    // Serve frontend for all other routes
    const filePath = url.pathname === "/" ? "/index.html" : url.pathname;
    const primaryFile = Bun.file(`${publicDir}${filePath}`);

    if (await primaryFile.exists()) {
      return new Response(primaryFile);
    }

    if (publicDir !== "./src") {
      const devFile = Bun.file(`./src${filePath}`);
      if (await devFile.exists()) {
        return new Response(devFile);
      }
    }

    // Fallback to index.html for SPA routing
    const fallback = publicDir === "./dist" ? Bun.file("./dist/index.html") : Bun.file("./src/index.html");
    return new Response(fallback);
  },

  websocket: handleWebSocket
});

console.log(`🎮 Rabble server running on http://localhost:${server.port}`);
