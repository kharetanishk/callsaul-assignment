import index from "../web/index.html";
import { startCall, type Call } from "./call";
import { createBackend, type Mode } from "./fakeBackend";
import { createLlm } from "./llm";

type SocketData = { sessionId: string; call?: Call };

const deepgramKey = process.env.DEEPGRAM_API_KEY;
if (!deepgramKey) throw new Error("DEEPGRAM_API_KEY is missing. Copy .env.example to .env and fill it in.");

const port = Number(process.env.PORT ?? 3000);
const backend = createBackend({ seed: process.env.FAKE_SEED ? Number(process.env.FAKE_SEED) : undefined });
const openRouterKey = process.env.OPENROUTER_API_KEY;
const llm = openRouterKey
  ? createLlm(openRouterKey, process.env.OPENROUTER_MODEL ?? "google/gemma-4-26b-a4b-it:free")
  : undefined;

Bun.serve<SocketData>({
  port,
  routes: { "/": index },
  fetch(request, server) {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      const sessionId = url.searchParams.get("session") ?? crypto.randomUUID();
      if (server.upgrade(request, { data: { sessionId } })) return;
    }
    // Stress test: make the fake backend behave in one way. mode=random goes back to normal.
    if (url.pathname === "/api/chaos") {
      const mode = url.searchParams.get("mode");
      backend.forced = mode === "random" ? undefined : (mode as Mode);
      return Response.json({ forced: backend.forced ?? "random" });
    }
    if (url.pathname === "/api/bookings") return Response.json([...backend.bookings.values()]);

    return new Response("Not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      ws.data.call = startCall(ws, ws.data.sessionId, { backend, llm, deepgramKey });
    },
    message(ws, data) {
      if (typeof data !== "string") ws.data.call?.sendAudio(data);
    },
    close(ws) {
      ws.data.call?.end();
    },
  },
});

console.log(`Open http://localhost:${port}`);
