import type { LogKind } from "./booking";
import type { Mode } from "./fakeBackend";
import type { Stage } from "./session";

export type ServerMessage =
  | { type: "agent"; text: string }
  | { type: "user"; text: string }
  | { type: "interim"; text: string }
  | { type: "log"; kind: LogKind; text: string }
  | { type: "metric"; name: "voice" | "response"; ms: number }
  | { type: "state"; stage: Stage; trackingId: string; idConfirmed: boolean; bookings: number }
  | { type: "backend"; mode: Mode; text: string }
  | { type: "stop_audio" }
  | { type: "hangup" }
  | { type: "speak_fallback"; text: string };

export type ClientMessage = { type: "hangup" };
