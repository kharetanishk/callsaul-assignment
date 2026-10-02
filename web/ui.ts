// Everything that touches the page. Other files call these functions and never use the DOM directly.
import type { LogKind } from "../server/booking";
import type { Stage } from "../server/session";

export type TimelineKind = LogKind | "user" | "agent";
type Level = LogKind | "off";

const STEP_NAMES: Record<Stage, string> = {
  ASK_ID: "Asking for the tracking ID",
  CONFIRM_ID: "Confirming the tracking ID",
  OFFER_SLOTS: "Choosing a delivery slot",
  CONFIRM_SLOT: "Confirming the slot",
  BOOKING: "Booking",
  DONE: "Done",
};

const SLOW_RESPONSE_MS = 1500;
const BAD_RESPONSE_MS = 3000;

const element = (id: string) => document.getElementById(id)!;
const timeline = element("timeline");
const chaosButtons = document.querySelectorAll<HTMLButtonElement>(".chaos");

let timelineStartedAt = Date.now();

type Handlers = { onCallClick: () => void; onChaosSelect: (mode: string) => void };

export function bindControls({ onCallClick, onChaosSelect }: Handlers) {
  element("call-button").onclick = onCallClick;
  element("technical-toggle").onchange = (event) =>
    timeline.classList.toggle("show-technical", (event.target as HTMLInputElement).checked);

  chaosButtons.forEach((button) => {
    button.onclick = () => {
      onChaosSelect(button.dataset.mode!);
      chaosButtons.forEach((other) => other.classList.toggle("active", other === button));
    };
  });
  chaosButtons[0]!.classList.add("active");
}

export function showCallEnded() {
  showConnection("off", "Not connected");
  showStep(undefined);
  showTrackingId("");
  element("call-button").textContent = "Start call";
  showInterim("");
}

export function showCallStarted() {
  showConnection("good", "Connected");
  element("call-button").textContent = "End call";
  timeline.replaceChildren();
  timelineStartedAt = Date.now();
}

export function showState(state: { stage: Stage; trackingId: string; bookings: number }) {
  showStep(state.stage);
  showTrackingId(state.trackingId);
  element("bookings").textContent = String(state.bookings);
  showInterim("");
}

export function showInterim(text: string) {
  element("interim").textContent = text ? `Hearing: ${text}` : "";
}

export function showResponseTime(ms: number) {
  const level = ms < SLOW_RESPONSE_MS ? "good" : ms < BAD_RESPONSE_MS ? "warn" : "bad";
  setWithDot("response", level, `${(ms / 1000).toFixed(1)} s`);
}

// A technical line is only visible when "Show technical details" is on.
export function addLine(kind: TimelineKind, text: string, options: { detail?: string; technical?: boolean } = {}) {
  const line = document.createElement("div");
  line.className = `line ${kind}${options.technical ? " technical" : ""}`;
  line.append(
    textElement("span", "time", elapsedTime()),
    body(kind, text, options.detail),
  );
  timeline.append(line);
  timeline.scrollTop = timeline.scrollHeight;
}

function body(kind: TimelineKind, text: string, detail?: string) {
  const container = document.createElement("div");
  if (kind === "user") container.append(textElement("span", "who", "Caller: "));
  if (kind === "agent") container.append(textElement("span", "who", "Agent: "));
  container.append(textElement("span", "text", text));
  if (detail) container.append(textElement("div", "detail", detail));
  return container;
}

function showConnection(level: Level, text: string) {
  setWithDot("connection", level, text);
}

function showStep(stage: Stage | undefined) {
  element("step").textContent = stage ? STEP_NAMES[stage] : "Waiting to start";
}

function showTrackingId(id: string) {
  element("tracking-id").textContent = id ? [...id.padEnd(8, "_")].join(" ") : "-";
}

function setWithDot(id: string, level: Level, text: string) {
  const dot = textElement("span", level === "off" ? "dot" : `dot ${level}`, "");
  element(id).replaceChildren(dot, text);
}

function textElement(tag: string, className: string, text: string) {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function elapsedTime() {
  const seconds = Math.floor((Date.now() - timelineStartedAt) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// Initial values before any call.
showCallEnded();
element("bookings").textContent = "0";
element("response").textContent = "-";
timeline.append(textElement("p", "empty", "Press Start call and allow the microphone."));
