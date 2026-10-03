import { expect, test } from "bun:test";
import { startCall } from "../server/call";
import { createBackend, type Backend } from "../server/fakeBackend";
import type { ServerMessage } from "../server/protocol";
import type { createStt } from "../server/stt";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Handlers = Parameters<typeof createStt>[1];

// A call with fake speech services: the agent "speaks" 20 chunks, 20 ms apart.
function setup(silenceMs?: number, again?: { sessionId: string; backend: Backend }, recoverMs?: number, idPauseMs?: number) {
  const messages: ServerMessage[] = [];
  const audio: Uint8Array[] = [];
  let handlers!: Handlers;

  const backend = again?.backend ?? createBackend({ normalMs: 1, slowMs: 150 });
  if (!again) backend.forced = "ok";
  const sessionId = again?.sessionId ?? `test-${Math.random()}`;

  const socket = {
    send: (data: string | Uint8Array) => {
      if (typeof data === "string") messages.push(JSON.parse(data));
      else audio.push(data);
    },
  };
  const services = {
    createStt: ((_key: string, given: Handlers) => {
      handlers = given;
      return { send: () => {}, close: () => {} };
    }) as typeof createStt,
    synthesize: async function* (_text: string, signal: AbortSignal) {
      for (let i = 0; i < 20 && !signal.aborted; i++) {
        await sleep(20);
        yield new Uint8Array(480);
      }
    },
  };

  const call = startCall(socket, sessionId, { backend, deepgramKey: "x", silenceMs, recoverMs, idPauseMs }, services);
  const types = () => messages.map((message) => message.type);
  const lastState = () => messages.findLast((m) => m.type === "state") as Extract<ServerMessage, { type: "state" }>;
  const spoken = () => messages.filter((m) => m.type === "agent").map((m) => (m as { text: string }).text);
  return { call, backend, sessionId, messages, audio, handlers: () => handlers, types, lastState, spoken };
}

test("speaks the greeting, then listens", async () => {
  const { audio, types } = setup();
  await sleep(100);
  expect(types()).toContain("agent");
  expect(audio.length).toBeGreaterThan(0);
});

test("the caller speaking over the agent stops the audio at once", async () => {
  const { audio, types, handlers } = setup();
  await sleep(100);
  handlers().onInterim("yes");
  const sentBefore = audio.length;

  expect(types()).toContain("stop_audio");
  await sleep(200);
  expect(audio.length).toBe(sentBefore);
});

test("a full ID said over the greeting is still understood", async () => {
  const { handlers, lastState } = setup();
  await sleep(100);
  handlers().onInterim("B as in");
  handlers().onFinal("B as in Bravo D as in Delta four one eight two zero seven");
  await sleep(100);

  expect(lastState().trackingId).toBe("BD418207");
  expect(lastState().stage).toBe("CONFIRM_ID");
});

test("filler sounds do not interrupt the agent", async () => {
  const { types, handlers } = setup();
  await sleep(100);
  handlers().onInterim("um");
  handlers().onFinal("uh hmm");
  expect(types()).not.toContain("stop_audio");
  expect(types()).not.toContain("user");
});

test("the agent's own voice picked up by the mic does not interrupt it", async () => {
  const { types, handlers } = setup();
  await sleep(100);
  handlers().onInterim("hi I can reschedule your delivery");
  expect(types()).not.toContain("stop_audio");
});

test("unclear speech gets a reply instead of silence", async () => {
  const { messages, handlers } = setup();
  await sleep(600);
  handlers().onUnclear("the", 0.2);
  const spoken = messages.filter((message) => message.type === "agent").map((message) => (message as { text: string }).text);
  expect(spoken.at(-1)).toContain("lot of noise");
});

test("speech after the agent has stopped is a normal turn", async () => {
  const { handlers, lastState } = setup();
  await sleep(600);
  handlers().onFinal("B as in Bravo D as in Delta four one eight two zero seven");
  await sleep(100);
  expect(lastState().stage).toBe("CONFIRM_ID");
});

test("a silent caller is asked again, with the same question, then left alone after three tries", async () => {
  const { call, spoken } = setup(60);
  await sleep(1800);
  const reminders = spoken().filter((text) => text.startsWith("Sorry, I cannot hear you."));
  expect(reminders.length).toBe(3);
  expect(reminders[0]).toContain("What is your tracking ID?");
  call.end();
});

test("a caller who speaks is not nagged", async () => {
  const { call, handlers, spoken } = setup(60);
  await sleep(100);
  handlers().onInterim("B as in");
  handlers().onFinal("B as in Bravo D as in Delta four one eight two zero seven");
  await sleep(300);
  expect(spoken().some((text) => text.startsWith("Sorry, I cannot hear you."))).toBe(false);
  call.end();
});

test("a caller who reconnects is welcomed back and the conversation carries on", async () => {
  const first = setup();
  await sleep(100);
  first.handlers().onFinal("B as in Bravo D as in Delta four one eight two zero seven");
  await sleep(100);
  first.call.end();

  const second = setup(undefined, first);
  await sleep(100);
  expect(second.spoken()[0]).toContain("Welcome back");
  expect(second.spoken()[0]).toContain("Is that correct");
  expect(second.spoken().join(" ")).not.toContain("Hi, I can reschedule");
  expect(second.lastState().trackingId).toBe("BD418207");

  await sleep(600);
  second.handlers().onFinal("yes");
  await sleep(100);
  expect(second.lastState().stage).toBe("OFFER_SLOTS");
  second.call.end();
});

test("the old connection says nothing once it has dropped", async () => {
  const first = setup();
  await sleep(100);
  first.call.end();
  const before = first.messages.length;
  const audioBefore = first.audio.length;
  first.handlers().onFinal("B as in Bravo D as in Delta four one eight two zero seven");
  await sleep(300);
  expect(first.messages.length).toBe(before);
  expect(first.audio.length).toBe(audioBefore);
});

test("a booking that finishes while the line is down is reported on reconnect, and made only once", async () => {
  const first = setup();
  const say = async (text: string) => {
    first.handlers().onFinal(text);
    await sleep(80);
  };
  await sleep(100);
  await say("B as in Bravo D as in Delta four one eight two zero seven");
  await say("yes");
  await say("the second one");
  first.backend.forced = "slow";
  await say("yes");
  expect(first.lastState().stage).toBe("BOOKING");

  first.call.end();
  const second = setup(undefined, first);
  await sleep(500);

  const welcome = second.spoken()[0]!;
  expect(welcome).toContain("Welcome back");
  expect(welcome).toContain("You are all set");
  expect(first.spoken().some((text) => text.includes("You are all set"))).toBe(false);
  expect(first.backend.bookings.size).toBe(1);
  second.call.end();
});

test("people talking in the background do not stop the agent", async () => {
  const { types, handlers } = setup();
  await sleep(100);
  handlers().onInterim("did you see the game last night");
  handlers().onFinal("did you see the game last night", 0.9);
  expect(types()).not.toContain("stop_audio");
  expect(types()).not.toContain("user");
});

test("a doubtful transcript does not stop the agent", async () => {
  const { types, handlers } = setup();
  await sleep(100);
  handlers().onInterim("yes", 0.3);
  expect(types()).not.toContain("stop_audio");
});

test("background talk while the agent is waiting gets no answer", async () => {
  const { types, handlers, spoken } = setup();
  await sleep(600);
  const before = spoken().length;
  handlers().onFinal("we should leave around six tomorrow", 0.5);
  await sleep(100);
  expect(types()).not.toContain("user");
  expect(spoken().length).toBe(before);
});

test("if the caller cut in and it was only background talk, the agent repeats itself at once", async () => {
  const { handlers, spoken } = setup();
  await sleep(100);
  handlers().onInterim("no");
  await sleep(30);
  handlers().onFinal("the weather is nice today", 0.5);
  await sleep(100);
  expect(spoken().at(-1)).toMatch(/^Sorry, as I was saying\. Hi, I can reschedule/);
});

test("if the caller cut in and then said nothing useful, the agent takes the floor back", async () => {
  const { call, handlers, spoken } = setup(undefined, undefined, 80);
  await sleep(100);
  handlers().onInterim("yes");
  await sleep(250);
  expect(spoken().at(-1)).toMatch(/^Sorry, as I was saying\./);
  call.end();
});

test("after several chunks of background talk the agent says it can hear other people, once", async () => {
  const { handlers, spoken } = setup();
  await sleep(600);
  for (const chatter of ["so I told him we should leave around six", "and then grab some food after the game", "did you see what happened last night", "it was unbelievable honestly"]) {
    handlers().onFinal(chatter, 0.9);
    await sleep(20);
  }
  const notices = spoken().filter((text) => text.includes("other people talking nearby"));
  expect(notices.length).toBe(1);
});

test("the page is told the ID is not confirmed until the caller says yes", async () => {
  const { handlers, lastState } = setup();
  await sleep(100);
  handlers().onFinal("B as in Bravo D as in Delta four one eight two zero seven");
  await sleep(100);
  expect(lastState().trackingId).toBe("BD418207");
  expect(lastState().idConfirmed).toBe(false);

  await sleep(600);
  handlers().onFinal("yes");
  await sleep(100);
  expect(lastState().idConfirmed).toBe(true);
});

test("after the ID is confirmed, a new ID that comes in two chunks is waited for and put together", async () => {
  const { handlers, lastState } = setup();
  await sleep(100);
  handlers().onFinal("B as in Bravo D as in Delta four one eight two zero seven");
  await sleep(150);
  await sleep(500);
  handlers().onFinal("yes");
  await sleep(200);
  expect(lastState().stage).toBe("OFFER_SLOTS");

  handlers().onFinal("a is in alpha", 0.9, false);
  await sleep(300);
  expect(lastState().stage).toBe("OFFER_SLOTS");
  handlers().onFinal("k as in kilo five five two zero one nine", 0.9, true);
  await sleep(300);
  expect(lastState().trackingId).toBe("AK552019");
  expect(lastState().stage).toBe("CONFIRM_ID");
  expect(lastState().idConfirmed).toBe(false);
});

test("an unfinished ID is not read back while the caller is still talking", async () => {
  const { call, handlers, spoken, lastState } = setup(undefined, undefined, undefined, 100);
  await sleep(600);
  handlers().onFinal("b as in bravo", 0.9, true);
  await sleep(60);
  handlers().onInterim("d as in delta four one");
  await sleep(150);
  expect(spoken().some((text) => text.includes("What comes next"))).toBe(false);

  handlers().onFinal("d as in delta four one eight two zero seven", 0.9, true);
  await sleep(150);
  expect(lastState().trackingId).toBe("BD418207");
  expect(lastState().stage).toBe("CONFIRM_ID");
  expect(spoken().some((text) => text.includes("What comes next"))).toBe(false);
  call.end();
});

test("an unfinished ID is read back once the caller really has stopped", async () => {
  const { call, handlers, spoken } = setup(undefined, undefined, undefined, 100);
  await sleep(600);
  handlers().onFinal("b as in bravo", 0.9, true);
  await sleep(300);
  expect(spoken().some((text) => text.includes("What comes next"))).toBe(true);
  call.end();
});
