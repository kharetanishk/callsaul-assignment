import { expect, test } from "bun:test";
import { isInterruption } from "../server/speech";

const agent = "Let me read that back. B as in Bravo, D as in Delta, 4 1 8 2 0 7. Is that correct?";

test("a short answer interrupts", () => {
  expect(isInterruption("yes", agent)).toBe(true);
  expect(isInterruption("no, not D", agent)).toBe(true);
});

test("a correction that reuses the agent's words interrupts only if it adds words of its own", () => {
  expect(isInterruption("B as in Bravo", "B as in Bravo, D as in Delta")).toBe(false);
  expect(isInterruption("no B as in Bravo not D", agent)).toBe(true);
});

test("filler sounds do not interrupt", () => {
  expect(isInterruption("um", agent)).toBe(false);
  expect(isInterruption("uh hmm", agent)).toBe(false);
  expect(isInterruption("", agent)).toBe(false);
});

test("the agent's own voice coming back is not an interruption", () => {
  expect(isInterruption("let me read that back", agent)).toBe(false);
  expect(isInterruption("is that correct", agent)).toBe(false);
});
