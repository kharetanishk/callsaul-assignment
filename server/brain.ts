import { bookSlot, callWithRetry, startBooking, withWaitNotice, type LogKind, type Options } from "./booking";
import type { Backend, Slot } from "./fakeBackend";
import { matchIntent, type Intent } from "./intents";
import type { Llm } from "./llm";
import type { Session } from "./session";
import { isQuestion, wantsNewId } from "./speech";
import { hasValidShape, ID_LENGTH, idCharsIn, isValid, namesPositionOnly, spell, updateId } from "./trackingId";

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

const IGNORE = "IGNORE";
// How long the agent waits quietly after the caller says "hold on".
const HOLD_MS = 30_000;
const HISTORY_TURNS = 6;
const MAX_ANSWER_CHARS = 220;
const MAX_YES_WORDS = 6;

const YES = /\b(yes|yeah|yep|yup|sure|correct|right|confirm|confirmed|okay|ok|please do|go ahead|book it)\b/i;
const NO = /\b(no|nope|nah|not|wrong|incorrect|dont|don't|cancel)\b/i;
const START_OVER = /\b(start over|begin again|restart)\b/i;

// A confirmation is a short answer. A long sentence that happens to contain "yes" is probably someone else talking.
const isYes = (text: string) => YES.test(text) && !NO.test(text) && text.trim().split(/\s+/).length <= MAX_YES_WORDS;
const isNo = (text: string) => NO.test(text);

export function greet(session: Session, deps: Deps) {
  speak(session, deps, "Hi, I can reschedule your delivery. What is your tracking ID?");
}

export async function handleTurn(session: Session, text: string, deps: Deps): Promise<void> {
  const ctx: Ctx = { session, deps, say: (line) => speak(session, deps, line) };
  if (session.busy) return ctx.say("Still working on it, one moment.");

  remember(session, "user", text);
  session.busy = true;
  const turn = route(ctx, text).finally(() => {
    session.busy = false;
  });
  session.turn = turn.catch(() => {});
  await turn;
}

function remember(session: Session, role: "user" | "assistant", text: string) {
  session.history.push({ role, text });
  session.history.splice(0, Math.max(0, session.history.length - HISTORY_TURNS * 2));
}

function speak(session: Session, deps: Deps, text: string) {
  session.lastSaid = text;
  remember(session, "assistant", text);
  deps.say(text);
}

async function route(ctx: Ctx, text: string) {
  const { session, say } = ctx;

  if (START_OVER.test(text)) {
    clearBookingState(session);
    return say("No problem, let's start again. What is your tracking ID?");
  }

  // The caller can fix or change the ID at any point, not only while we are asking for it.
  const pendingFix = session.pendingFix;
  session.pendingFix = undefined;
  if (session.trackingId) {
    // A correction can come in two breaths: "no, the last two digits" ... "should be one three".
    const said = pendingFix ? `${pendingFix} ${text}` : text;
    const fixed = applyId(session.trackingId, said);
    if (fixed !== session.trackingId && isValid(fixed) && (pendingFix || wantsNewId(text) || namesPositionOrNot(text))) {
      return replaceId(ctx, fixed);
    }
    if (namesPositionOnly(said)) {
      session.pendingFix = said;
      return say("Sure. What should it be?");
    }
  }
  if (wantsNewId(text)) return changeId(ctx, text);
  if (session.stage !== "ASK_ID" && session.stage !== "CONFIRM_ID") {
    const changed = applyId(session.trackingId, text);
    if (changed !== session.trackingId && isValid(changed)) return replaceId(ctx, changed);
    // The start of a new ID, for example when it arrives in pieces. Collect it like a fresh ID.
    if (startsNewId(idCharsIn(text))) {
      ctx.deps.log("warn", "Caller started giving a new tracking ID");
      clearBookingState(session);
      return askId(ctx, text);
    }
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

// Forgets the ID and everything that depended on it, and goes back to asking for it.
function clearBookingState(session: Session) {
  Object.assign(session, {
    stage: "ASK_ID",
    trackingId: "",
    idConfirmed: false,
    slots: [],
    chosenSlotId: undefined,
    confirmedSlotId: undefined,
    booking: undefined,
  });
}

// "I want to change the tracking ID" or "the ID is wrong". The fix or the new ID often follows in the next breath,
// so the current ID is kept until we know which: "the last digit is seven" fixes it, a whole ID replaces it.
function changeId(ctx: Ctx, text: string) {
  const { session, deps, say } = ctx;
  deps.log("warn", "Caller wants to change the tracking ID");
  if (applyId("", text) !== "") {
    clearBookingState(session);
    return askId(ctx, text);
  }
  if (!session.trackingId) return say("No problem. What is the tracking ID?");
  // The ID is in question now, so nothing can be booked against it until it is confirmed again.
  Object.assign(session, { stage: "CONFIRM_ID", idConfirmed: false, slots: [], chosenSlotId: undefined, confirmedSlotId: undefined });
  session.pendingFix = text;
  say("No problem. Tell me which part to change, for example the last digit is seven, or say the whole new ID.");
}

// "the third digit is 9" or "B not D": a correction that says where, as opposed to a whole new ID.
const namesPositionOrNot = (text: string) => /\bnot\b/i.test(text) || namesPositionOnly(text.split(/\b(is|are|should|to)\b/i)[0] ?? "");

// The caller gave a different ID, or corrected part of it. The new one has to be confirmed again,
// and the slot picked for the old one no longer counts.
function replaceId(ctx: Ctx, id: string) {
  const { session, deps, say } = ctx;
  const different = changedCharacters(session.trackingId, id) >= NEW_ID_CHARACTERS;
  deps.log("warn", `Tracking ID changed from ${session.trackingId} to ${id}, waiting for the caller to confirm it`);
  Object.assign(session, {
    stage: "CONFIRM_ID",
    trackingId: id,
    idConfirmed: false,
    slots: [],
    chosenSlotId: undefined,
    confirmedSlotId: undefined,
    booking: undefined,
  });
  say(different ? `I heard a new tracking ID. ${spell(id)}. Is that correct?` : `Sorry about that. So it is ${spell(id)}. Is that correct?`);
}

// The two letters an ID begins with, a few characters that begin with a letter, or several of any kind.
// A lone digit is just an answer like "the second one".
const startsNewId = (chars: string) =>
  chars.length >= 5 || (chars.length >= 3 && /^[A-Z]/.test(chars)) || /^[A-Z]{2}/.test(chars);

const changedCharacters = (a: string, b: string) => [...b].filter((char, index) => char !== a[index]).length;
// A different ID in three or more places is a new ID, not a small correction.
const NEW_ID_CHARACTERS = 3;

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
  session.idConfirmed = false;
  if (id === before) return fallback(ctx, text);

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
    session.idConfirmed = true;
    session.stage = "OFFER_SLOTS";
    return offerSlots(ctx);
  }

  const next = applyId(session.trackingId, text);
  if (next !== session.trackingId && isValid(next)) return replaceId(ctx, next);
  // Letters or digits we could not place. Never hand these to the LLM, it would make up its own version of the ID.
  if (idCharsIn(text)) {
    return say("Sorry, I could not tell which part to change. You can say, for example, the last digit is seven, or say the whole ID again.");
  }
  if (isNo(text)) return say("Sorry. Which part is wrong? You can say, for example, the last two digits are one three, or say the whole ID again.");
  await fallback(ctx, text);
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
  if (!slot) return fallback(ctx, text);

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
  await fallback(ctx, text);
}

async function book(ctx: Ctx, slot: Slot) {
  const { session, deps, say } = ctx;
  // The flow cannot reach this without a confirmed ID. This makes sure of it.
  if (!session.idConfirmed) throw new Error("the tracking ID was not confirmed by the caller");
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
  await fallback(ctx, text);
}

// The caller said something the current step cannot use. Questions about the agent and requests like
// "hold on" are answered from fixed rules. Anything else goes to the LLM, which can also say it was not meant for us.
async function fallback(ctx: Ctx, text: string) {
  const { session, deps, say } = ctx;

  const intent = matchIntent(text);
  if (intent) return answerIntent(ctx, intent);

  // A bare yes or no with nothing to confirm is not something to ask the LLM about.
  if ((isYes(text) || isNo(text)) && text.trim().split(/\s+/).length <= 3) {
    return say(`Sorry, I am not sure what you are answering. ${reprompt(session)}`);
  }

  const answer = await askLlm(ctx);
  if (answer === IGNORE) return deps.log("info", `Ignored "${text}", it did not sound like it was meant for the agent`);
  if (answer) return say(`${answer} ${reprompt(session)}`);

  if (isQuestion(text)) return say(`I can only help with rescheduling your delivery. ${reprompt(session)}`);
  say(`Sorry, I did not catch that. ${reprompt(session)}`);
}

function answerIntent({ session, deps, say }: Ctx, intent: Intent) {
  deps.log("info", `Caller asked for: ${intent.name}`);
  switch (intent.name) {
    case "goodbye":
      session.stage = "DONE";
      return say("Okay, goodbye.");
    case "wait":
      session.holdUntil = Date.now() + HOLD_MS;
      return say("Of course, take your time. I will be here.");
    case "repeat":
      return say(`Sure. ${session.lastSaid.replace(/^(Sure\. )+/, "")}`);
    default:
      return say(`${intent.reply} ${reprompt(session)}`.trim());
  }
}

function systemPrompt(session: Session): string {
  const facts = session.trackingId ? `The tracking ID heard so far is ${session.trackingId}.` : "No tracking ID has been heard yet.";
  return [
    "You are a polite phone agent for a courier service. Your only job is to reschedule one delivery:",
    "collect the tracking ID (two letters and six digits), confirm it, offer new delivery slots, and book one after the caller says yes.",
    `Right now the call is at this point: ${reprompt(session)}`,
    facts,
    "Reply in one or two short plain sentences. No lists, no markdown, no emojis, and do not ask a question, because the system adds the next question itself.",
    "You may explain what you do and how this call works.",
    "Never read out, repeat, guess or change the tracking ID or any letters or digits. The system does that itself.",
    "You cannot look up parcel status, prices, policies or delivery times, and you must never guess them. Say you cannot help with that and that you can only reschedule.",
    `If the caller is clearly talking to someone else, or it is background chatter, reply with exactly ${IGNORE}.`,
  ].join(" ");
}

// Returns the cleaned answer, IGNORE, or nothing if the LLM is missing or fails.
async function askLlm({ session, deps, say }: Ctx): Promise<string | undefined> {
  if (!deps.llm) return;
  const options: Options = { ...deps.timing, onWait: () => say("One moment.") };
  try {
    const turns = session.history.map((turn) => ({ role: turn.role, content: turn.text }));
    const raw = await withWaitNotice(options, () => deps.llm!(systemPrompt(session), turns));
    return cleanAnswer(raw);
  } catch (error) {
    deps.log("warn", `LLM unavailable: ${(error as Error).message}`);
  }
}

// Spoken answers are plain and short, whatever the model returned.
function cleanAnswer(raw: string): string | undefined {
  const text = raw.replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
  if (!text) return;
  if (text.toUpperCase().startsWith(IGNORE)) return IGNORE;
  // The system asks the next question itself, so any sentence in the answer that asks something is dropped.
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !/\?$|\b(please|could you|can you|tracking id)\b|\bas in\b|\d/i.test(sentence))
    .slice(0, 2)
    .join(" ");
  if (!sentences) return;
  return sentences.length > MAX_ANSWER_CHARS ? sentences.slice(0, MAX_ANSWER_CHARS).replace(/\s+\S*$/, "") + "." : sentences;
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
