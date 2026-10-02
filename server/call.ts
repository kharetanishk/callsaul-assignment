// One phone call: caller audio in, agent speech out.
import { greet, handleTurn, type Deps } from "./brain";
import type { Backend } from "./fakeBackend";
import type { Llm } from "./llm";
import type { ServerMessage } from "./protocol";
import { getSession } from "./session";
import { createStt } from "./stt";
import { isValid, updateId } from "./trackingId";
import { synthesize, TTS_SAMPLE_RATE } from "./tts";

export type Socket = { send: (data: string | Uint8Array) => void };
export type Call = { sendAudio: (audio: Uint8Array) => void; end: () => void };
type Shared = { backend: Backend; llm?: Llm; deepgramKey: string };

// Callers pause between characters, so an unfinished ID waits a little longer for the rest.
const ID_PAUSE_MS = 900;
const SPEECH_TIMEOUT_MS = 15_000;
// Extra time after the computed end of speech, to cover network and playback delay.
const PLAYBACK_MARGIN_MS = 300;

export function startCall(socket: Socket, sessionId: string, { backend, llm, deepgramKey }: Shared): Call {
  const session = getSession(sessionId);

  let heardText = "";
  let heardAt = 0;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let speechQueue: Promise<void> = Promise.resolve();
  let sentencesQueued = 0;
  let speakingUntil = 0;

  const send = (message: ServerMessage) => socket.send(JSON.stringify(message));
  const isSpeaking = () => sentencesQueued > 0 || Date.now() < speakingUntil;

  const sendState = () =>
    send({ type: "state", stage: session.stage, trackingId: session.trackingId, bookings: backend.bookings.size });

  const deps: Deps = {
    backend,
    llm,
    say: speak,
    log: (kind, text) => {
      send({ type: "log", kind, text });
      sendState();
    },
  };

  // Sentences are spoken one after another, in the order they were said.
  function speak(text: string) {
    send({ type: "agent", text });
    sentencesQueued++;
    speechQueue = speechQueue.then(() => streamSpeech(text));
  }

  async function streamSpeech(text: string) {
    const requestedAt = Date.now();
    let firstAudioAt = requestedAt;
    let bytes = 0;
    try {
      for await (const chunk of synthesize(text, AbortSignal.timeout(SPEECH_TIMEOUT_MS))) {
        if (bytes === 0) {
          firstAudioAt = Date.now();
          send({ type: "metric", name: "voice", ms: firstAudioAt - requestedAt });
          if (heardAt) send({ type: "metric", name: "response", ms: firstAudioAt - heardAt });
          heardAt = 0;
        }
        bytes += chunk.length;
        socket.send(chunk);
      }
    } catch (error) {
      deps.log("warn", `Voice failed (${(error as Error).message}), using the browser voice`);
      send({ type: "speak_fallback", text });
    } finally {
      sentencesQueued--;
      // Playback starts at the first chunk, or right after the previous sentence finishes.
      const seconds = bytes / 2 / TTS_SAMPLE_RATE;
      speakingUntil = Math.max(firstAudioAt, speakingUntil) + seconds * 1000 + PLAYBACK_MARGIN_MS;
    }
  }

  function onHeard(text: string) {
    heardText = `${heardText} ${text}`.trim();
    heardAt = Date.now();
    const idUnfinished = session.stage === "ASK_ID" && !isValid(updateId(session.trackingId, heardText));
    clearTimeout(holdTimer);
    holdTimer = setTimeout(deliver, idUnfinished ? ID_PAUSE_MS : 0);
  }

  async function deliver() {
    const text = heardText;
    heardText = "";
    if (isSpeaking()) return deps.log("warn", `Ignored "${text}" because the agent was speaking`);

    send({ type: "user", text });
    try {
      await handleTurn(session, text, deps);
    } catch (error) {
      deps.log("bad", `Something went wrong: ${(error as Error).message}`);
      speak("Sorry, something went wrong on my side. Could you say that again?");
    }
    sendState();
  }

  const stt = createStt(deepgramKey, {
    onInterim: (text) => send({ type: "interim", text }),
    onFinal: onHeard,
    onError: (message) => deps.log("bad", message),
  });

  greet(session, deps);
  sendState();

  return { sendAudio: stt.send, end: stt.close };
}
