import { afterEach, expect, test } from "bun:test";
import { synthesize } from "../server/tts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
process.env.ELEVENLABS_API_KEY ??= "test";

// Fakes both voices. ElevenLabs fails the given number of times first.
function fakeVoices(elevenlabsFailures: number) {
  const calls: { to: string; body: any }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const to = url.includes("elevenlabs") ? "elevenlabs" : "deepgram";
    calls.push({ to, body: JSON.parse(String(init.body)) });
    if (to === "elevenlabs" && calls.filter((call) => call.to === "elevenlabs").length <= elevenlabsFailures) {
      return new Response("busy", { status: 429 });
    }
    return new Response(new Uint8Array(480));
  }) as typeof fetch;
  return calls;
}

async function speak(previous = "") {
  const fallbacks: string[] = [];
  const chunks: Uint8Array[] = [];
  for await (const chunk of synthesize("Shall I book that?", new AbortController().signal, {
    voice: "elevenlabs",
    previous,
    onFallback: (reason) => fallbacks.push(reason),
  })) {
    chunks.push(chunk);
  }
  return { fallbacks, chunks };
}

test("every sentence asks for the same steady English voice and carries on from the previous one", async () => {
  const calls = fakeVoices(0);
  await speak("Thanks.");
  const body = calls[0]!.body;
  expect(body.language_code).toBe("en");
  expect(body.voice_settings.stability).toBeGreaterThanOrEqual(0.7);
  expect(body.seed).toBeDefined();
  expect(body.previous_text).toBe("Thanks.");
});

test("one ElevenLabs failure is retried, so the voice does not change", async () => {
  const calls = fakeVoices(1);
  const { fallbacks, chunks } = await speak();
  expect(calls.map((call) => call.to)).toEqual(["elevenlabs", "elevenlabs"]);
  expect(fallbacks).toEqual([]);
  expect(chunks.length).toBeGreaterThan(0);
});

test("only after two failures is the Deepgram voice used, and it is reported", async () => {
  const calls = fakeVoices(2);
  const { fallbacks } = await speak();
  expect(calls.map((call) => call.to)).toEqual(["elevenlabs", "elevenlabs", "deepgram"]);
  expect(fallbacks.length).toBe(1);
});
