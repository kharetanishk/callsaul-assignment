// Notices when the caller starts talking, even in a noisy car or with people nearby.
// Speech has to be clearly louder than the background, and the background level is learned as it goes.

// The first moments are only used to learn how loud the room is. About one second of frames.
const WARMUP_FRAMES = 25;
const MIN_LEVEL = 0.035;
const LOUDER_THAN_BACKGROUND = 3.5;
// About a fifth of a second of sound before it counts, so a cough or a bump does not.
const FRAMES_TO_TRIGGER = 5;
const BACKGROUND_SMOOTHING = 0.05;
// While the agent is talking, some of its own voice leaks into the mic. The bar is raised by this share of its volume.
const ECHO_ALLOWANCE = 0.6;

function level(frame: Float32Array): number {
  let sum = 0;
  for (const sample of frame) sum += sample * sample;
  return Math.sqrt(sum / frame.length);
}

// Returns a function to call with every mic frame. onSpeech fires once per burst of speech.
// agentLevel says how loud the agent is right now, from 0 to 1.
export function createSpeechDetector(onSpeech: () => void, agentLevel: () => number = () => 0) {
  let background = 0;
  let seen = 0;
  let loudFrames = 0;
  let triggered = false;

  return (frame: Float32Array) => {
    const current = level(frame);

    if (seen < WARMUP_FRAMES) {
      background = (background * seen + current) / (seen + 1);
      seen++;
      return;
    }

    const bar = Math.max(MIN_LEVEL, background * LOUDER_THAN_BACKGROUND) + agentLevel() * ECHO_ALLOWANCE;
    if (current <= bar) {
      background += (current - background) * BACKGROUND_SMOOTHING;
      loudFrames = 0;
      triggered = false;
      return;
    }
    loudFrames++;
    if (loudFrames >= FRAMES_TO_TRIGGER && !triggered) {
      triggered = true;
      onSpeech();
    }
  };
}
