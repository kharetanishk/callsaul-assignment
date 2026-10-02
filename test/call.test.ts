import { expect, test } from "bun:test";
import { startCall } from "../server/call";
import { createBackend } from "../server/fakeBackend";
import type { ServerMessage } from "../server/protocol";
import type { createStt } from "../server/stt";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Handlers = Parameters<typeof createStt>[1];

// A call with fake speech services: the agent "speaks" 20 chunks, 20 ms apart.
function setup(silenceMs?: number) {
  const messages: ServerMessage[] = [];
  const audio: Uint8Array[] = [];
  let handlers!: Handlers;

  const backend = createBackend({ normalMs: 1 });
  backend.forced = "ok";

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

  const call = startCall(socket, `test-${Math.random()}`, { backend, deepgramKey: "x", silenceMs }, services);
  const types = () => messages.map((message) => message.type);
  const lastState = () => messages.findLast((m) => m.type === "state") as Extract<ServerMessage, { type: "state" }>;
  const spoken = () => messages.filter((m) => m.type === "agent").map((m) => (m as { text: string }).text);
  return { call, messages, audio, handlers: () => handlers, types, lastState, spoken };
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
