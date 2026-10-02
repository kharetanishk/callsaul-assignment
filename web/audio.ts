// Microphone capture and speaker playback. No knowledge of the page or the server protocol.
import { createSpeechDetector } from "./vad";

const SEND_RATE = 16000;
const PLAYBACK_RATE = 24000;
const FRAME_SAMPLES = 2048;
// Small delay before the first chunk so playback does not start in the past.
const PLAYBACK_LEAD_SECONDS = 0.05;
// How long the agent stays quiet after a possible interruption, if no words follow.
const DUCK_MS = 1200;
// Time constant for fading the volume, so cutting it does not click.
const FADE_SECONDS = 0.015;
// Speech is quiet on a 0 to 1 scale, so loudness is boosted to use more of the range.
const LEVEL_GAIN = 4;

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

export type Mic = {
  context: AudioContext;
  // How loud the caller is right now, from 0 to 1.
  level: () => number;
  stop: () => void;
};
export type Player = {
  play: (pcm16: ArrayBuffer) => void;
  // How loud the agent is right now, from 0 to 1.
  level: () => number;
  // Mutes the agent for a moment. The volume comes back unless stop() is called first.
  duck: () => void;
  // Cuts the agent off and throws away everything still queued.
  stop: () => void;
};
type PlayerOptions = { onPlaying: () => void; onIdle: () => void };
type MicHandlers = { onAudio: (pcm16: ArrayBuffer) => void; onSpeech: () => void };

// Asks for the microphone. Sends 16 kHz PCM16 audio to onAudio, and calls onSpeech when the caller starts talking.
export async function startMic({ onAudio, onSpeech }: MicHandlers): Promise<Mic> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  const context = new AudioContext();
  await context.audioWorklet.addModule(URL.createObjectURL(new Blob([MIC_WORKLET], { type: "text/javascript" })));

  const detectSpeech = createSpeechDetector(onSpeech);
  const worklet = new AudioWorkletNode(context, "mic");
  worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
    detectSpeech(event.data);
    onAudio(toPcm16(event.data, context.sampleRate));
  };
  const source = context.createMediaStreamSource(stream);
  source.connect(worklet);
  const meter = createMeter(context);
  source.connect(meter.node);
  // Some browsers only run a node that reaches the output. The worklet writes silence, so nothing is heard.
  worklet.connect(context.destination);

  return {
    context,
    level: meter.level,
    stop: () => {
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
    },
  };
}

// Plays PCM16 chunks (24 kHz) back to back so speech has no gaps.
export function createPlayer(context: AudioContext, { onPlaying, onIdle }: PlayerOptions): Player {
  const meter = createMeter(context);
  const output = context.createGain();
  meter.node.connect(output);
  output.connect(context.destination);

  const playing = new Set<AudioBufferSourceNode>();
  let nextStart = 0;
  let duckTimer: ReturnType<typeof setTimeout> | undefined;

  const setVolume = (volume: number) => output.gain.setTargetAtTime(volume, context.currentTime, FADE_SECONDS);

  return {
    level: meter.level,

    play(pcm16) {
      const samples = new Int16Array(pcm16);
      const buffer = context.createBuffer(1, samples.length, PLAYBACK_RATE);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) channel[i] = samples[i]! / 0x8000;

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(meter.node);
      source.onended = () => {
        playing.delete(source);
        if (playing.size === 0) onIdle();
      };
      if (playing.size === 0) onPlaying();
      playing.add(source);

      nextStart = Math.max(context.currentTime + PLAYBACK_LEAD_SECONDS, nextStart);
      source.start(nextStart);
      nextStart += buffer.duration;
    },

    duck() {
      if (playing.size === 0) return;
      setVolume(0);
      clearTimeout(duckTimer);
      duckTimer = setTimeout(() => setVolume(1), DUCK_MS);
    },

    stop() {
      clearTimeout(duckTimer);
      playing.forEach((source) => {
        source.onended = null;
        source.stop();
      });
      playing.clear();
      nextStart = 0;
      output.gain.value = 1;
      onIdle();
    },
  };
}

// Reads how loud the audio passing through is. The meter does not change the sound.
function createMeter(context: AudioContext) {
  const node = context.createAnalyser();
  node.fftSize = 512;
  const samples = new Float32Array(node.fftSize);

  return {
    node,
    level: () => {
      node.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      return Math.min(1, Math.sqrt(sum / samples.length) * LEVEL_GAIN);
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
