// Turns text into speech (24 kHz PCM16). Deepgram is the free default, ElevenLabs is optional.

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

function elevenlabs(text: string, signal: AbortSignal) {
  const voice = process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM";
  return fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=pcm_${TTS_SAMPLE_RATE}`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_flash_v2_5" }),
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

// Falls back to Deepgram if ElevenLabs fails before any audio was produced.
export async function* synthesize(text: string, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  if (process.env.TTS_PROVIDER === "elevenlabs" && process.env.ELEVENLABS_API_KEY) {
    let started = false;
    try {
      for await (const chunk of wholeSamples(await elevenlabs(text, signal))) {
        started = true;
        yield chunk;
      }
      return;
    } catch (error) {
      if (started || signal.aborted) throw error;
      console.warn(`ElevenLabs failed, using Deepgram: ${(error as Error).message}`);
    }
  }
  yield* wholeSamples(await deepgram(text, signal));
}
