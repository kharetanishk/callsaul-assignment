import index from "../web/index.html";
import { startCall, type Call } from "./call";
import { createBackend, type Mode } from "./fakeBackend";
import { createLlm } from "./llm";
import { banner, log } from "./logger";

type SocketData = { sessionId: string; call?: Call };

const deepgramKey = process.env.DEEPGRAM_API_KEY;
if (!deepgramKey) throw new Error("DEEPGRAM_API_KEY is missing. Copy .env.example to .env and fill it in.");

const port = Number(process.env.PORT ?? 3000);
const seed = process.env.FAKE_SEED ? Number(process.env.FAKE_SEED) : undefined;
const backend = createBackend({ seed });
const openRouterKey = process.env.OPENROUTER_API_KEY;
const llmModel = process.env.OPENROUTER_MODEL ?? "google/gemma-4-26b-a4b-it:free";
const llm = openRouterKey ? createLlm(openRouterKey, llmModel) : undefined;

const MODES: Mode[] = ["ok", "slow", "fail", "lostack", "hang"];

Bun.serve<SocketData>({
  port,
  routes: { "/": index },
  fetch(request, server) {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      const sessionId = url.searchParams.get("session") ?? crypto.randomUUID();
      if (server.upgrade(request, { data: { sessionId } })) return;
    }
    // Stress test. With ?mode=slow the booking requests behave that way, ?mode=random goes back to normal.
    // Without a mode it just reports the current setting.
    if (url.pathname === "/api/chaos") {
      const mode = url.searchParams.get("mode");
      if (mode === "random") backend.forced = undefined;
      else if (mode && MODES.includes(mode as Mode)) backend.forced = mode as Mode;
      else if (mode) return Response.json({ error: `unknown mode ${mode}` }, { status: 400 });
      if (mode) log("BACKEND", `Stress test set to: ${backend.forced ?? "random"}`, "warn");
      return Response.json({ mode: backend.forced ?? "random" });
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

banner("Reschedule voice agent", [
  ["Open", `http://localhost:${port}`],
  ["Listening", "Deepgram nova-3"],
  ["Speaking", process.env.TTS_PROVIDER === "elevenlabs" ? "ElevenLabs (falls back to Deepgram)" : "Deepgram aura-2"],
  ["Brain LLM", llm ? llmModel : "off (set OPENROUTER_API_KEY), fixed replies only"],
  ["Booking system", `fake courier backend, ${seed === undefined ? "random behaviour" : `seed ${seed}`}`],
]);
