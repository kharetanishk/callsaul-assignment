import { expect, test } from "bun:test";
import { hasValidShape, isValid, spell, updateId } from "../server/trackingId";

test("reads a full ID with phonetic letters", () => {
  const text = "B as in Bravo, D as in Delta, four one eight two zero seven";
  expect(updateId("", text)).toBe("BD418207");
});

test("reads an ID spoken as one word", () => {
  expect(updateId("", "it is bd418207")).toBe("BD418207");
});

test("builds the ID over several turns", () => {
  const first = updateId("", "bee dee four one eight");
  expect(first).toBe("BD418");
  expect(updateId(first, "two oh seven")).toBe("BD418207");
});

test("handles double and triple", () => {
  expect(updateId("", "A K double two triple five one")).toBe("AK225551");
});

test("oh is a letter in the first two positions and a zero after", () => {
  expect(updateId("", "oh k one two three four five six")).toBe("OK123456");
});

test("ignores extra speech past eight characters", () => {
  expect(updateId("BD418207", "nine nine")).toBe("BD418207");
});

test("ignores words that are not part of an ID", () => {
  expect(updateId("BD41", "yes that's right")).toBe("BD41");
});

test("corrects one letter: B as in Bravo, not D", () => {
  expect(updateId("DD418207", "no, B as in Bravo, not D")).toBe("BD418207");
});

test("corrects one digit: zero not nine", () => {
  expect(updateId("BD418297", "it's zero not nine")).toBe("BD418207");
});

test("corrects by position", () => {
  expect(updateId("BD418207", "the third digit is 9")).toBe("BD419207");
});

test("a correction for something not in the ID changes nothing", () => {
  expect(updateId("BD418207", "no, Z not Q")).toBe("BD418207");
});

test("validates the format", () => {
  expect(isValid("BD418207")).toBe(true);
  expect(isValid("BD41820")).toBe(false);
  expect(isValid("4D418207")).toBe(false);
});

test("spells the ID for reading back", () => {
  expect(spell("BD418207")).toBe("B as in Bravo, D as in Delta, 4 1 8 2 0 7");
  expect(spell("BD41")).toBe("B as in Bravo, D as in Delta, 4 1");
  expect(spell("B")).toBe("B as in Bravo");
});

test("spells whatever characters it has, even a partial ID", () => {
  expect(spell("BD")).toBe("B as in Bravo, D as in Delta");
  expect(spell("B")).toBe("B as in Bravo");
  expect(spell("D4182")).toBe("D as in Delta, 4 1 8 2");
});

test("knows when characters can no longer become a valid ID", () => {
  expect(hasValidShape("")).toBe(true);
  expect(hasValidShape("BD41")).toBe(true);
  expect(hasValidShape("B")).toBe(true);
  expect(hasValidShape("418")).toBe(false);
  expect(hasValidShape("D4182")).toBe(false);
  expect(hasValidShape("BD41A")).toBe(false);
});
