import { expect, test } from "bun:test";
import { createSpeechDetector } from "../web/vad";

const frame = (amplitude: number) => Float32Array.from({ length: 2048 }, (_, i) => (i % 2 ? amplitude : -amplitude));

function run(frames: number[]) {
  let triggers = 0;
  const detect = createSpeechDetector(() => triggers++);
  for (const amplitude of frames) detect(frame(amplitude));
  return triggers;
}

const repeat = (amplitude: number, count: number) => Array<number>(count).fill(amplitude);

test("triggers once when someone starts talking in a quiet room", () => {
  expect(run([...repeat(0.002, 20), ...repeat(0.3, 10)])).toBe(1);
});

test("a steady engine rumble does not trigger", () => {
  expect(run(repeat(0.05, 100))).toBe(0);
});

test("speech over engine noise triggers", () => {
  expect(run([...repeat(0.05, 50), ...repeat(0.4, 10)])).toBe(1);
});

test("a single short bump does not trigger", () => {
  expect(run([...repeat(0.002, 20), 0.5, 0.5, ...repeat(0.002, 20)])).toBe(0);
});

test("a second burst of speech triggers again", () => {
  expect(run([...repeat(0.01, 20), ...repeat(0.3, 8), ...repeat(0.01, 10), ...repeat(0.3, 8)])).toBe(2);
});
