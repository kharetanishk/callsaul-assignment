// Turns text into speech (24 kHz PCM16). Deepgram is the free voice, ElevenLabs the premium one.

export type Voice = "deepgram" | "elevenlabs";

export const TTS_SAMPLE_RATE = 24000;

async function* body(response: Response): AsyncGenerator<Uint8Array> {
  if (!response.ok || !response.body) throw new Error(`speech error ${response.status}`);
  for await (const chunk of response.body) yield chunk;
}

function deepgram(text: string, signal: AbortSignal) {
  const params = new URLSearchParams({
    model: "aura-2-thalia-en",
    encoding: "linear16",
    sample_rate: String(TTS_SAMPLE_RATE),
    container: "none",
  });
  return fetch(`https://api.deepgram.com/v1/speak?${params}`, {
    method: "POST",
    headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal,
  }).then(body);
}

const ELEVENLABS_SETTINGS = {
  language_code: "en",
  seed: 7,
  voice_settings: { stability: 0.75, similarity_boost: 0.85, style: 0, use_speaker_boost: true, speed: 1 },
};

function elevenlabs(text: string, signal: AbortSignal, previous: string) {
  const voice = process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM";
  const model = process.env.ELEVENLABS_MODEL ?? "eleven_turbo_v2_5";
  return fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=pcm_${TTS_SAMPLE_RATE}`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: model, previous_text: previous || undefined, ...ELEVENLABS_SETTINGS }),
    signal,
  }).then(body);
}

// Each chunk must hold whole 16-bit samples, so a split sample is carried to the next chunk.
async function* wholeSamples(source: AsyncIterable<Uint8Array>) {
  let leftover = new Uint8Array(0);
  for await (const chunk of source) {
    const joined = new Uint8Array(leftover.length + chunk.length);
    joined.set(leftover);
    joined.set(chunk, leftover.length);
    const even = joined.length - (joined.length % 2);
    leftover = joined.slice(even);
    if (even) yield joined.slice(0, even);
  }
}

type Options = { voice?: Voice; previous?: string; onFallback?: (reason: string) => void };

// ElevenLabs gets a second try before Deepgram is used, because switching voice mid-call is very noticeable.
// onFallback says when it happens, so it shows in the call log.
export async function* synthesize(text: string, signal: AbortSignal, options: Options = {}): AsyncGenerator<Uint8Array> {
  const { voice = "deepgram", previous = "", onFallback } = options;
  if (voice === "elevenlabs" && process.env.ELEVENLABS_API_KEY) {
    let reason = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      let started = false;
      try {
        for await (const chunk of wholeSamples(await elevenlabs(text, signal, previous))) {
          started = true;
          yield chunk;
        }
        return;
      } catch (error) {
        if (started || signal.aborted) throw error;
        reason = (error as Error).message;
      }
    }
    onFallback?.(reason);
  }
  yield* wholeSamples(await deepgram(text, signal));
}
