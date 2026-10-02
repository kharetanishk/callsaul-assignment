// Readable terminal output: one line per event with a time, a coloured label and a message.

export type Scope = "SERVER" | "CALL" | "HEARD" | "AGENT" | "BRAIN" | "BACKEND" | "VOICE" | "LISTEN" | "BARGE-IN";
export type Level = "info" | "good" | "warn" | "bad";

const RESET = "\x1b[0m";
const color = (code: number, text: string) => `\x1b[38;5;${code}m${text}${RESET}`;
const dim = (text: string) => `\x1b[2m${text}${RESET}`;
const bold = (text: string) => `\x1b[1m${text}${RESET}`;

const SCOPE_COLOURS: Record<Scope, number> = {
  SERVER: 245,
  CALL: 141,
  HEARD: 117,
  AGENT: 215,
  BRAIN: 183,
  BACKEND: 220,
  VOICE: 114,
  LISTEN: 110,
  "BARGE-IN": 209,
};

const LEVEL_COLOURS: Record<Level, number | undefined> = { info: undefined, good: 114, warn: 214, bad: 203 };

function clock() {
  const now = new Date();
  const part = (value: number, size = 2) => String(value).padStart(size, "0");
  return `${part(now.getHours())}:${part(now.getMinutes())}:${part(now.getSeconds())}.${part(now.getMilliseconds(), 3)}`;
}

// callId separates the lines of calls that overlap. It is the first characters of the session id.
export function log(scope: Scope, message: string, level: Level = "info", callId?: string) {
  const label = color(SCOPE_COLOURS[scope], bold(scope.padEnd(8)));
  const tag = callId ? dim(`[${callId}] `) : "";
  const levelColour = LEVEL_COLOURS[level];
  console.log(`${dim(clock())}  ${label} ${tag}${levelColour ? color(levelColour, message) : message}`);
}

export function banner(title: string, rows: [string, string][]) {
  const width = Math.max(...rows.map(([label]) => label.length)) + 2;
  console.log("");
  console.log(`  ${color(215, bold(title))}`);
  console.log(`  ${dim("-".repeat(46))}`);
  for (const [label, value] of rows) console.log(`  ${dim(label.padEnd(width))}${value}`);
  console.log("");
}
