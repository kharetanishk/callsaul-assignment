// One phone call: caller audio in, agent speech out.
import { greet, handleTurn, type Deps } from "./brain";
import type { Backend, CallKind, Mode } from "./fakeBackend";
import type { Llm } from "./llm";
import { log, type Level, type Scope } from "./logger";
import type { ServerMessage } from "./protocol";
import { getSession } from "./session";
import { isInterruption } from "./speech";
import { createStt } from "./stt";
import { isValid, updateId } from "./trackingId";
import { synthesize, TTS_SAMPLE_RATE } from "./tts";

export type Socket = { send: (data: string | Uint8Array) => void };
export type Call = { sendAudio: (audio: Uint8Array) => void; end: () => void };
type Shared = { backend: Backend; llm?: Llm; deepgramKey: string; silenceMs?: number };
type Services = { createStt: typeof createStt; synthesize: typeof synthesize };

// Callers pause between characters, so an unfinished ID waits a little longer for the rest.
const ID_PAUSE_MS = 900;
const SPEECH_TIMEOUT_MS = 15_000;
// Extra time after the computed end of speech, to cover network and playback delay.
const PLAYBACK_MARGIN_MS = 300;
// If the caller says nothing this long after the agent finishes, the agent says it cannot hear them.
const SILENCE_MS = 8000;
const MAX_REMINDERS = 3;

const BACKEND_CALL_NAMES: Record<CallKind, string> = { slots: "Slot lookup", book: "Booking request", status: "Status check" };
const BACKEND_BEHAVIOURS: Record<Mode, string> = {
  ok: "answered normally",
  slow: "is answering slowly (about 6 seconds)",
  fail: "returned an error and saved nothing",
  lostack: "saved the booking but the reply will be lost",
  hang: "will never answer",
};

export function startCall(
  socket: Socket,
  sessionId: string,
  { backend, llm, deepgramKey, silenceMs = SILENCE_MS }: Shared,
  services: Services = { createStt, synthesize },
): Call {
  const session = getSession(sessionId);

  let heardText = "";
  let heardAt = 0;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let speechQueue: Promise<void> = Promise.resolve();
  let sentencesQueued = 0;
  let speakingUntil = 0;
  let silenceTimer: ReturnType<typeof setTimeout> | undefined;
  let reminders = 0;
  let lastQuestion = "";
  // Aborted when the caller interrupts, which cancels every sentence that has not finished playing.
  let interrupted = new AbortController();
  // Once the connection has gone, the call stops talking. A turn that is still running just finishes quietly.
  let ended = false;

  const callId = sessionId.slice(0, 4);
  const note = (scope: Scope, text: string, level: Level = "info") => log(scope, text, level, callId);
  const send = (message: ServerMessage) => !ended && socket.send(JSON.stringify(message));
  const isSpeaking = () => sentencesQueued > 0 || Date.now() < speakingUntil;

  const sendState = () =>
    send({ type: "state", stage: session.stage, trackingId: session.trackingId, bookings: backend.bookings.size });

  const deps: Deps = {
    backend,
    llm,
    say: (text) => speak(text),
    log: (kind, text) => tell(kind, text),
  };

  // Shows a line in the browser timeline and in the server terminal.
  function tell(kind: Level, text: string, scope: Scope = "BRAIN") {
    send({ type: "log", kind, text });
    note(scope, text, kind);
    sendState();
  }

  const stopListening = backend.subscribe(({ call, mode }) => {
    const text = `${BACKEND_CALL_NAMES[call]}: the booking system ${BACKEND_BEHAVIOURS[mode]}`;
    send({ type: "backend", mode, text });
    note("BACKEND", text, mode === "ok" ? "info" : "warn");
  });

  // Sentences are spoken one after another, in the order they were said.
  function speak(text: string, isReminder = false) {
    if (ended) return;
    if (!isReminder) lastQuestion = text;
    send({ type: "agent", text });
    note("AGENT", text);
    sentencesQueued++;
    const cancelled = interrupted.signal;
    speechQueue = speechQueue.then(() => streamSpeech(text, cancelled));
  }

  async function streamSpeech(text: string, cancelled: AbortSignal) {
    if (cancelled.aborted) return;

    const requestedAt = Date.now();
    let firstAudioAt = requestedAt;
    let bytes = 0;
    try {
      const request = AbortSignal.any([cancelled, AbortSignal.timeout(SPEECH_TIMEOUT_MS)]);
      for await (const chunk of services.synthesize(text, request)) {
        if (cancelled.aborted) return;
        if (bytes === 0) {
          firstAudioAt = Date.now();
          send({ type: "metric", name: "voice", ms: firstAudioAt - requestedAt });
          note("VOICE", `first sound after ${firstAudioAt - requestedAt} ms`);
          if (heardAt) {
            const gap = firstAudioAt - heardAt;
            send({ type: "metric", name: "response", ms: gap });
            note("VOICE", `reply started ${(gap / 1000).toFixed(1)} s after the caller stopped speaking`, gap < 1500 ? "good" : gap < 3000 ? "warn" : "bad");
          }
          heardAt = 0;
        }
        bytes += chunk.length;
        if (!ended) socket.send(chunk);
      }
    } catch (error) {
      if (cancelled.aborted) return;
      tell("warn", `Voice failed (${(error as Error).message}), using the browser voice`, "VOICE");
      send({ type: "speak_fallback", text });
    }

    if (cancelled.aborted) return;
    sentencesQueued--;
    // Playback starts at the first chunk, or right after the previous sentence finishes.
    const seconds = bytes / 2 / TTS_SAMPLE_RATE;
    speakingUntil = Math.max(firstAudioAt, speakingUntil) + seconds * 1000 + PLAYBACK_MARGIN_MS;
    if (sentencesQueued === 0) waitForCaller();
  }

  // Never leave the caller in silence: if they say nothing, say we cannot hear them and ask again.
  function waitForCaller() {
    clearTimeout(silenceTimer);
    if (reminders >= MAX_REMINDERS || session.stage === "DONE") return;
    silenceTimer = setTimeout(remind, silenceMs + Math.max(0, speakingUntil - Date.now()));
  }

  function remind() {
    if (isSpeaking() || session.busy) return waitForCaller();
    reminders++;
    tell("warn", "The caller said nothing, so the agent asked again", "CALL");
    speak(`Sorry, I cannot hear you. ${lastQuestion}`, true);
  }

  // The caller spoke over the agent: stop talking now and forget the rest of what was queued.
  function interrupt() {
    interrupted.abort();
    interrupted = new AbortController();
    sentencesQueued = 0;
    speakingUntil = 0;
    send({ type: "stop_audio" });
    tell("info", "Caller spoke over the agent, so the agent stopped talking", "BARGE-IN");
  }

  function onInterim(text: string) {
    clearTimeout(silenceTimer);
    send({ type: "interim", text });
    if (isSpeaking() && isInterruption(text, session.lastSaid)) interrupt();
  }

  function onHeard(text: string) {
    note("HEARD", `"${text}"`);
    reminders = 0;
    clearTimeout(silenceTimer);
    if (isSpeaking()) {
      if (!isInterruption(text, session.lastSaid)) return tell("info", `Ignored "${text}", it was only noise or an echo`, "LISTEN");
      interrupt();
    }
    heardText = `${heardText} ${text}`.trim();
    heardAt = Date.now();
    const idUnfinished = session.stage === "ASK_ID" && !isValid(updateId(session.trackingId, heardText));
    clearTimeout(holdTimer);
    holdTimer = setTimeout(deliver, idUnfinished ? ID_PAUSE_MS : 0);
  }

  // Heard something, but too unclear to trust. Ask again instead of staying silent.
  function onUnclear(text: string, confidence: number) {
    tell("warn", `Could not make out "${text}" (confidence ${confidence.toFixed(2)})`, "LISTEN");
    if (!isSpeaking() && !heardText) speak("Sorry, there is a lot of noise on the line. Could you say that again?", true);
  }

  async function deliver() {
    const text = heardText;
    heardText = "";

    send({ type: "user", text });
    try {
      await handleTurn(session, text, deps);
    } catch (error) {
      tell("bad", `Something went wrong: ${(error as Error).message}`, "CALL");
      speak("Sorry, something went wrong on my side. Could you say that again?");
    }
    sendState();
  }

  const stt = services.createStt(deepgramKey, {
    onInterim,
    onFinal: onHeard,
    onUnclear,
    onError: (message) => tell("bad", message, "LISTEN"),
  });

  // A session that already has history is a caller coming back after the line dropped.
  const resuming = session.lastSaid !== "";
  if (resuming) void resume();
  else {
    note("CALL", `started, session ${sessionId}`, "good");
    greet(session, deps);
  }
  sendState();

  // Picks the conversation up where it stopped. If a turn was still running, its result is what gets repeated.
  async function resume() {
    tell("good", `Reconnected, the call continues at step ${session.stage}`, "CALL");
    await session.turn;
    if (ended) return;
    lastQuestion = session.lastSaid;
    speak(`Welcome back, sorry about the interruption. ${session.lastSaid}`, true);
    sendState();
  }

  return {
    sendAudio: stt.send,
    end: () => {
      if (ended) return;
      note("CALL", `connection closed at step ${session.stage}, bookings made: ${backend.bookings.size}`, "good");
      ended = true;
      interrupted.abort();
      stopListening();
      clearTimeout(silenceTimer);
      clearTimeout(holdTimer);
      stt.close();
    },
  };
}
