// Notices when the caller starts talking, even in a noisy car.
// Speech has to be clearly louder than the background, and the background level is learned as it goes.

const MIN_LEVEL = 0.02;
const LOUDER_THAN_BACKGROUND = 3;
const FRAMES_TO_TRIGGER = 3;
const BACKGROUND_SMOOTHING = 0.05;

function level(frame: Float32Array): number {
  let sum = 0;
  for (const sample of frame) sum += sample * sample;
  return Math.sqrt(sum / frame.length);
}

// Returns a function to call with every mic frame. onSpeech fires once per burst of speech.
export function createSpeechDetector(onSpeech: () => void) {
  let background = 0;
  let loudFrames = 0;
  let triggered = false;

  return (frame: Float32Array) => {
    const current = level(frame);
    if (background === 0) background = current;

    if (current <= Math.max(MIN_LEVEL, background * LOUDER_THAN_BACKGROUND)) {
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
