// Starts and ends the call, and routes what the server sends to the right place.
import type { ServerMessage } from "../server/protocol";
import { createPlayer, startMic, type Mic, type Player } from "./audio";
import * as ui from "./ui";

type Call = { socket: WebSocket; mic: Mic; player: Player };

let call: Call | undefined;
let asking = false;

ui.bindControls({
  onCallClick: () => (call ? endCall() : void startCall()),
  onChaosSelect: (mode) => void fetch(`/api/chaos?mode=${mode}`),
});

async function startCall() {
  if (asking) return;
  asking = true;

  let mic: Mic;
  try {
    mic = await startMic((audio) => call?.socket.readyState === WebSocket.OPEN && call.socket.send(audio));
  } catch {
    ui.addLine("bad", "The microphone is blocked. Allow microphone access in the browser and try again.");
    return;
  } finally {
    asking = false;
  }
  ui.showCallStarted();

  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${location.host}/ws?session=${crypto.randomUUID()}`);
  socket.binaryType = "arraybuffer";
  socket.onmessage = (event) => (typeof event.data === "string" ? onMessage(JSON.parse(event.data)) : call?.player.play(event.data));
  socket.onclose = endCall;
  call = { socket, mic, player: createPlayer(mic.context) };
}

function endCall() {
  const ended = call;
  call = undefined;
  ended?.socket.close();
  ended?.mic.stop();
  speechSynthesis.cancel();
  ui.showCallEnded();
}

function onMessage(message: ServerMessage) {
  switch (message.type) {
    case "user":
    case "agent":
      return ui.addLine(message.type, message.text);
    case "log":
      return ui.addLine(message.kind, message.text);
    case "interim":
      return ui.showInterim(message.text);
    case "state":
      return ui.showState(message);
    case "metric":
      return onMetric(message);
    case "speak_fallback":
      return speechSynthesis.speak(new SpeechSynthesisUtterance(message.text));
  }
}

function onMetric({ name, ms }: Extract<ServerMessage, { type: "metric" }>) {
  if (name === "response") {
    ui.showResponseTime(ms);
    ui.addLine("info", "Agent replied", { detail: `${ms} ms after the caller stopped speaking`, technical: true });
  } else {
    ui.addLine("info", "Voice started", { detail: `${ms} ms to the first sound`, technical: true });
  }
}
