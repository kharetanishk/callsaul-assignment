// Microphone capture and speaker playback. No knowledge of the page or the server protocol.

const SEND_RATE = 16000;
const PLAYBACK_RATE = 24000;
const FRAME_SAMPLES = 2048;
// Small delay before the first chunk so playback does not start in the past.
const PLAYBACK_LEAD_SECONDS = 0.05;

// Runs on the audio thread and hands over a fixed-size frame of mic samples at a time.
const MIC_WORKLET = `
class Mic extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(${FRAME_SAMPLES});
    this.filled = 0;
  }
  process(inputs) {
    const channel = inputs[0][0];
    if (!channel) return true;
    for (const sample of channel) {
      this.frame[this.filled++] = sample;
      if (this.filled === this.frame.length) {
        this.port.postMessage(this.frame.slice());
        this.filled = 0;
      }
    }
    return true;
  }
}
registerProcessor("mic", Mic);
`;

export type Mic = { context: AudioContext; stop: () => void };
export type Player = { play: (pcm16: ArrayBuffer) => void };

// Asks for the microphone and calls onAudio with 16 kHz PCM16 audio until stopped.
export async function startMic(onAudio: (pcm16: ArrayBuffer) => void): Promise<Mic> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  const context = new AudioContext();
  await context.audioWorklet.addModule(URL.createObjectURL(new Blob([MIC_WORKLET], { type: "text/javascript" })));

  const worklet = new AudioWorkletNode(context, "mic");
  worklet.port.onmessage = (event: MessageEvent<Float32Array>) => onAudio(toPcm16(event.data, context.sampleRate));
  context.createMediaStreamSource(stream).connect(worklet);
  // Some browsers only run a node that reaches the output. The worklet writes silence, so nothing is heard.
  worklet.connect(context.destination);

  return {
    context,
    stop: () => {
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
    },
  };
}

// Plays PCM16 chunks (24 kHz) back to back so speech has no gaps.
export function createPlayer(context: AudioContext): Player {
  let nextStart = 0;

  return {
    play(pcm16) {
      const samples = new Int16Array(pcm16);
      const buffer = context.createBuffer(1, samples.length, PLAYBACK_RATE);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) channel[i] = samples[i]! / 0x8000;

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      nextStart = Math.max(context.currentTime + PLAYBACK_LEAD_SECONDS, nextStart);
      source.start(nextStart);
      nextStart += buffer.duration;
    },
  };
}

// Averages groups of samples down to 16 kHz and converts them to 16-bit integers.
function toPcm16(input: Float32Array, inputRate: number): ArrayBuffer {
  const ratio = inputRate / SEND_RATE;
  const output = new Int16Array(Math.floor(input.length / ratio));
  for (let i = 0; i < output.length; i++) {
    const from = Math.floor(i * ratio);
    const to = Math.max(from + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = from; j < to; j++) sum += input[j]!;
    output[i] = Math.max(-1, Math.min(1, sum / (to - from))) * 0x7fff;
  }
  return output.buffer;
}
