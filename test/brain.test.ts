import { expect, test } from "bun:test";
import { handleTurn } from "../server/brain";
import { createBackend, type Mode } from "../server/fakeBackend";
import type { Llm } from "../server/llm";
import { newSession } from "../server/session";

const fast = { retries: 2, timeoutMs: 30, backoffMs: 1, waitFirstMs: 10, waitEveryMs: 1000 };
const FULL_ID = "B as in Bravo, D as in Delta, four one eight two zero seven";

function setup(script: Mode[] = [], llm?: Llm, timing = fast) {
  const backend = createBackend({ normalMs: 1, slowMs: 60, failMs: 1 });
  backend.forced = "ok";
  backend.script = script;
  const said: string[] = [];
  const session = newSession("test");
  const deps = { backend, say: (text: string) => said.push(text), log: () => {}, llm, timing };
  const talk = async (...lines: string[]) => {
    for (const line of lines) await handleTurn(session, line, deps);
  };
  return { backend, session, said, talk };
}

test("books a delivery on the happy path", async () => {
  const { backend, session, said, talk } = setup();
  await talk(FULL_ID, "yes", "the second one", "yes");
  expect(session.stage).toBe("DONE");
  expect(backend.bookings.size).toBe(1);
  expect(said.at(-1)).toContain("You are all set");
});

test("collects the ID over several turns", async () => {
  const { session, talk } = setup();
  await talk("B as in Bravo, D as in Delta, four one");
  expect(session.stage).toBe("ASK_ID");
  expect(session.trackingId).toBe("BD41");
  await talk("eight two zero seven");
  expect(session.stage).toBe("CONFIRM_ID");
});

test("asks again from the start when part of the ID was missed", async () => {
  const { session, said, talk } = setup();
  await talk("seasoned broccoli D as in Delta four one eight two zero seven");
  expect(session.trackingId).toBe("");
  expect(said.at(-1)).toContain("from the start");
});

test("fixes one letter when the caller corrects it", async () => {
  const { session, said, talk } = setup();
  await talk("D as in Delta, D as in Delta, four one eight two zero seven");
  await talk("no, B as in Bravo, not D");
  expect(session.trackingId).toBe("BD418207");
  expect(said.at(-1)).toContain("B as in Bravo");
  expect(session.stage).toBe("CONFIRM_ID");
});

test("does not move on from the ID without a yes", async () => {
  const { session, talk } = setup();
  await talk(FULL_ID, "hmm not sure");
  expect(session.stage).toBe("CONFIRM_ID");
});

test("never books without an explicit yes", async () => {
  const { backend, session, talk } = setup();
  await talk(FULL_ID, "yes", "the second one", "hmm maybe");
  expect(session.stage).toBe("CONFIRM_SLOT");
  expect(backend.bookings.size).toBe(0);
});

test("a caller who changes their mind is asked to confirm the new slot", async () => {
  const { backend, session, talk } = setup();
  await talk(FULL_ID, "yes", "the first one");
  const other = session.slots[4]!;
  await talk(`actually ${other.day} ${other.period}`);
  expect(session.chosenSlotId).toBe(other.id);
  expect(backend.bookings.size).toBe(0);
  await talk("yes");
  expect([...backend.bookings.values()][0]!.slotId).toBe(other.id);
});

test("a lost reply when booking does not double-book", async () => {
  const { backend, session, talk } = setup();
  await talk(FULL_ID, "yes", "the second one");
  backend.script = ["lostack", "ok"];
  await talk("yes");
  expect(session.stage).toBe("DONE");
  expect(backend.bookings.size).toBe(1);
});

test("a failed booking is reported honestly and can be retried", async () => {
  const { backend, session, said, talk } = setup();
  await talk(FULL_ID, "yes", "the second one");
  backend.script = ["fail", "fail", "fail", "ok"];
  await talk("yes");
  expect(said.at(-1)).toContain("nothing has been booked");
  expect(session.stage).toBe("CONFIRM_SLOT");
  expect(backend.bookings.size).toBe(0);
  await talk("yes");
  expect(session.stage).toBe("DONE");
  expect(backend.bookings.size).toBe(1);
});

test("an unreachable backend leaves the outcome unknown and checking again is safe", async () => {
  const { backend, session, said, talk } = setup();
  await talk(FULL_ID, "yes", "the second one");
  backend.script = ["lostack", "lostack", "lostack", "fail", "fail"];
  await talk("yes");
  expect(session.stage).toBe("BOOKING");
  expect(said.at(-1)).toContain("do not want to book twice");
  await talk("yes");
  expect(session.stage).toBe("DONE");
  expect(backend.bookings.size).toBe(1);
});

test("keeps talking while the slot lookup fails, then recovers", async () => {
  const { backend, session, said, talk } = setup();
  await talk(FULL_ID);
  backend.script = ["fail", "fail", "fail"];
  await talk("yes");
  expect(said.at(-1)).toContain("trouble reaching");
  expect(session.slots.length).toBe(0);
  await talk("yes");
  expect(session.slots.length).toBeGreaterThan(0);
});

test("tells the caller to wait while the backend is slow", async () => {
  const { backend, session, said, talk } = setup([], undefined, { ...fast, timeoutMs: 200 });
  await talk(FULL_ID, "yes", "the second one");
  backend.script = ["slow"];
  await talk("yes");
  expect(said.some((line) => line.includes("One moment"))).toBe(true);
  expect(session.stage).toBe("DONE");
});

test("answers a side question with the LLM, then repeats what it needs", async () => {
  const llm: Llm = async () => "I can only help with rescheduling.";
  const { said, talk } = setup([], llm);
  await talk("what is the weather like");
  expect(said.at(-1)).toContain("I can only help with rescheduling.");
  expect(said.at(-1)).toContain("tracking ID");
});

test("still replies when the LLM fails", async () => {
  const llm: Llm = async () => {
    throw new Error("down");
  };
  const { said, talk } = setup([], llm);
  await talk("hello there");
  expect(said.at(-1)).toContain("did not catch that");
});

test("start over resets the call", async () => {
  const { session, talk } = setup();
  await talk(FULL_ID, "yes", "start over");
  expect(session.stage).toBe("ASK_ID");
  expect(session.trackingId).toBe("");
});
