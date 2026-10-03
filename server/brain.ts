import { bookSlot, callWithRetry, startBooking, withWaitNotice, type LogKind, type Options } from "./booking";
import type { Backend, Slot } from "./fakeBackend";
import type { Llm } from "./llm";
import type { Session } from "./session";
import { hasValidShape, ID_LENGTH, isValid, spell, updateId } from "./trackingId";

export type Deps = {
  backend: Backend;
  say: (text: string) => void;
  log: (kind: LogKind, text: string) => void;
  llm?: Llm;
  timing?: Options;
};

type Ctx = { session: Session; deps: Deps; say: (text: string) => void };

const FILLERS = [
  "One moment, still checking.",
  "Still working on it, thank you for waiting.",
  "Sorry, this is taking a while. Almost there.",
];

const LLM_SYSTEM =
  "You are a phone agent for a courier service that reschedules deliveries. " +
  "Reply with one short sentence and no question. If the caller asks about anything other than " +
  "rescheduling this delivery, say you can only help with rescheduling. Never promise delivery times or prices.";

const YES = /\b(yes|yeah|yep|yup|sure|correct|right|confirm|confirmed|okay|ok|please do|go ahead|book it)\b/i;
const NO = /\b(no|nope|nah|not|wrong|incorrect|dont|don't|cancel)\b/i;
const START_OVER = /\b(start over|begin again|restart)\b/i;

const isYes = (text: string) => YES.test(text) && !NO.test(text);
const isNo = (text: string) => NO.test(text);

export function greet(session: Session, deps: Deps) {
  speak(session, deps, "Hi, I can reschedule your delivery. What is your tracking ID?");
}

export async function handleTurn(session: Session, text: string, deps: Deps): Promise<void> {
  const ctx: Ctx = { session, deps, say: (line) => speak(session, deps, line) };
  if (session.busy) return ctx.say("Still working on it, one moment.");

  session.busy = true;
  const turn = route(ctx, text).finally(() => {
    session.busy = false;
  });
  session.turn = turn.catch(() => {});
  await turn;
}

function speak(session: Session, deps: Deps, text: string) {
  session.lastSaid = text;
  deps.say(text);
}

async function route(ctx: Ctx, text: string) {
  const { session, say } = ctx;

  if (START_OVER.test(text)) {
    Object.assign(session, { stage: "ASK_ID", trackingId: "", slots: [], chosenSlotId: undefined, confirmedSlotId: undefined, booking: undefined });
    return say("No problem, let's start again. What is your tracking ID?");
  }

  switch (session.stage) {
    case "ASK_ID": return askId(ctx, text);
    case "CONFIRM_ID": return confirmId(ctx, text);
    case "OFFER_SLOTS": return chooseSlot(ctx, text);
    case "CONFIRM_SLOT": return confirmSlot(ctx, text);
    case "BOOKING": return retryBooking(ctx, text);
    case "DONE": return say("You are all set. Goodbye.");
  }
}

// A full ID said from scratch replaces the old one. Otherwise the text adds to it or corrects it.
function applyId(current: string, text: string): string {
  const fresh = updateId("", text);
  return isValid(fresh) ? fresh : updateId(current, text);
}

function askId(ctx: Ctx, text: string) {
  const { session, deps, say } = ctx;
  const before = session.trackingId;
  const id = applyId(before, text);

  if (!hasValidShape(id)) {
    session.trackingId = "";
    deps.log("warn", `Heard ${id}, which is not two letters then six digits`);
    return say("I think I missed part of that. A tracking ID is two letters followed by six digits. Please say it again from the start.");
  }

  session.trackingId = id;
  if (id === before) return unclear(ctx, text);

  deps.log("info", `Understood so far: ${[...id.padEnd(ID_LENGTH, "_")].join(" ")}`);
  if (isValid(id)) {
    session.stage = "CONFIRM_ID";
    return say(`Let me read that back. ${spell(id)}. Is that correct?`);
  }
  say(`I have ${spell(id)}. What comes next?`);
}

async function confirmId(ctx: Ctx, text: string) {
  const { session, deps, say } = ctx;
  if (isYes(text)) {
    deps.log("good", `Caller confirmed tracking ID ${session.trackingId}`);
    session.stage = "OFFER_SLOTS";
    return offerSlots(ctx);
  }

  const next = applyId(session.trackingId, text);
  if (next !== session.trackingId && isValid(next)) {
    deps.log("warn", `Corrected tracking ID to ${next}`);
    session.trackingId = next;
    return say(`Sorry about that. Is it ${spell(next)}?`);
  }
  if (isNo(text)) return say("Sorry. Which character is wrong? Or say the whole ID again.");
  await unclear(ctx, text);
}

async function offerSlots(ctx: Ctx) {
  const { session, deps, say } = ctx;
  const options = callOptions(ctx);
  const slots = await withWaitNotice(options, () => callWithRetry(() => deps.backend.slots(), "Looking up delivery slots", options));

  if (!slots) {
    deps.log("bad", "Could not load delivery slots");
    return say("I am having trouble reaching the scheduling system. Shall I try again?");
  }
  session.slots = slots;
  say(`Thanks. ${slotPrompt(session)}`);
}

async function chooseSlot(ctx: Ctx, text: string) {
  const { session, deps, say } = ctx;
  if (!session.slots.length) {
    if (isNo(text)) {
      session.stage = "DONE";
      return say("No problem. Please call back any time. Goodbye.");
    }
    return offerSlots(ctx);
  }

  const slot = pickSlot(session.slots, text);
  if (!slot) return unclear(ctx, text);

  deps.log("info", `Caller chose ${slot.label}`);
  session.chosenSlotId = slot.id;
  session.stage = "CONFIRM_SLOT";
  say(`${slot.label}. Shall I book that?`);
}

async function confirmSlot(ctx: Ctx, text: string) {
  const { session, deps, say } = ctx;
  const chosen = session.slots.find((slot) => slot.id === session.chosenSlotId)!;

  const picked = pickSlot(session.slots, text);
  if (picked && picked.id !== chosen.id) {
    deps.log("info", `Caller changed their mind to ${picked.label}`);
    session.chosenSlotId = picked.id;
    return say(`${picked.label}. Shall I book that?`);
  }
  if (isYes(text)) {
    session.confirmedSlotId = chosen.id;
    deps.log("good", `Caller confirmed ${chosen.label}`);
    return book(ctx, chosen);
  }
  if (isNo(text)) {
    session.stage = "OFFER_SLOTS";
    session.chosenSlotId = undefined;
    return say(`No problem. ${slotPrompt(session)}`);
  }
  await unclear(ctx, text);
}

async function book(ctx: Ctx, slot: Slot) {
  const { session, deps, say } = ctx;
  session.stage = "BOOKING";
  session.booking = startBooking(session.trackingId, slot.id, session.confirmedSlotId);

  const booking = await bookSlot(deps.backend, session.booking, callOptions(ctx));

  if (booking.status === "done") {
    session.stage = "DONE";
    deps.log("good", `Booked ${slot.label}, reference ${booking.ref}`);
    return say(`You are all set. Your delivery is booked for ${slot.label}. Your reference is ${booking.ref!.replace("-", " ")}.`);
  }
  if (booking.status === "failed") {
    session.stage = "CONFIRM_SLOT";
    session.confirmedSlotId = undefined;
    deps.log("bad", "Booking failed, nothing was booked");
    return say("Sorry, I could not complete the booking, and nothing has been booked. Shall I try again?");
  }
  deps.log("bad", "Booking outcome unknown");
  say("I could not confirm whether the booking went through, and I do not want to book twice. Shall I check again?");
}

// The booking outcome was unknown. Checking again is safe because the booking key never changes.
async function retryBooking(ctx: Ctx, text: string) {
  const { session, say } = ctx;
  if (isYes(text)) return book(ctx, session.slots.find((slot) => slot.id === session.chosenSlotId)!);
  if (isNo(text)) {
    session.stage = "DONE";
    return say("Understood. Please call back shortly to check the booking. Goodbye.");
  }
  await unclear(ctx, text);
}

// Falls back to the LLM for side questions, then always repeats what we need from the caller.
async function unclear({ session, deps, say }: Ctx, text: string) {
  let answer = "Sorry, I did not catch that.";
  if (deps.llm) {
    try {
      answer = await deps.llm(LLM_SYSTEM, `The caller said: "${text}"`);
    } catch (error) {
      deps.log("warn", `LLM unavailable: ${(error as Error).message}`);
    }
  }
  say(`${answer} ${reprompt(session)}`);
}

function reprompt(session: Session): string {
  switch (session.stage) {
    case "ASK_ID": return "Please say your tracking ID: two letters followed by six digits.";
    case "CONFIRM_ID": return `Is ${spell(session.trackingId)} correct? Please say yes, or tell me what to change.`;
    case "OFFER_SLOTS": return session.slots.length ? slotPrompt(session) : "Shall I try again?";
    case "CONFIRM_SLOT": return "Shall I book it? Please say yes or no.";
    case "BOOKING": return "Shall I check again?";
    case "DONE": return "";
  }
}

function slotPrompt(session: Session): string {
  const [first, second, third] = session.slots;
  return `I can offer: first, ${first!.label}. Second, ${second!.label}. Third, ${third!.label}. Which would you like?`;
}

// "the second one" picks from the three offered. A day or a time of day picks from all slots.
export function pickSlot(slots: Slot[], text: string): Slot | undefined {
  const t = text.toLowerCase();
  const ordinal = ["first", "second", "third"].findIndex((word) => t.includes(word));
  if (ordinal >= 0) return slots[ordinal];

  const scored = slots.map((slot) => ({
    slot,
    score: (t.includes(slot.day.toLowerCase()) ? 2 : 0) + (t.includes(slot.period) ? 1 : 0),
  }));
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a));
  return best.score > 0 ? best.slot : undefined;
}

function callOptions({ say, deps }: Ctx): Options {
  return {
    ...deps.timing,
    onEvent: deps.log,
    onWait: (count) => {
      deps.log("warn", "The system is slow, telling the caller to wait");
      say(FILLERS[Math.min(count, FILLERS.length) - 1]!);
    },
  };
}
