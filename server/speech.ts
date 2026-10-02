// Helpers for telling real interruptions apart from noise and echo.

const FILLER_WORDS = new Set(["um", "uh", "hmm", "mm", "mhm", "ah", "er", "oh"]);

// Echo needs at least this many words. A short answer like "yes" is never treated as echo.
const MIN_ECHO_WORDS = 3;

export function realWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((word) => word && !FILLER_WORDS.has(word));
}

// The agent's own voice coming back through the mic: several words, all of which the agent just said.
export function isEcho(words: string[], agentText: string): boolean {
  if (words.length < MIN_ECHO_WORDS) return false;
  const said = new Set(realWords(agentText));
  return words.every((word) => said.has(word));
}

// True when the caller is genuinely talking over the agent.
export function isInterruption(text: string, agentText: string): boolean {
  const words = realWords(text);
  return words.length > 0 && !isEcho(words, agentText);
}
