// Messages the server sends to the browser as JSON. Audio is sent as binary frames instead.
import type { LogKind } from "./booking";
import type { Mode } from "./fakeBackend";
import type { Stage } from "./session";

export type ServerMessage =
  | { type: "agent"; text: string }
  | { type: "user"; text: string }
  | { type: "interim"; text: string }
  | { type: "log"; kind: LogKind; text: string }
  | { type: "metric"; name: "voice" | "response"; ms: number }
  | { type: "state"; stage: Stage; trackingId: string; bookings: number }
  | { type: "backend"; mode: Mode; text: string }
  | { type: "stop_audio" }
  | { type: "speak_fallback"; text: string };

// Messages the browser sends as JSON. Audio is sent as binary frames instead.
export type ClientMessage = { type: "hangup" };
