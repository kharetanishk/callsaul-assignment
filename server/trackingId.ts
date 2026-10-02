// Tracking ID: two letters then six digits, for example BD418207.

const NATO_WORDS = [
  "alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india",
  "juliet", "kilo", "lima", "mike", "november", "oscar", "papa", "quebec", "romeo",
  "sierra", "tango", "uniform", "victor", "whiskey", "xray", "yankee", "zulu",
];

const LETTER_NAMES = {
  bee: "B", cee: "C", dee: "D", gee: "G", jay: "J", kay: "K",
  pee: "P", tee: "T", vee: "V", zee: "Z", em: "M", en: "N", ex: "X",
};

const DIGIT_WORDS = {
  zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4",
  five: "5", six: "6", seven: "7", eight: "8", nine: "9",
};

const WORDS = new Map<string, string>([
  ...NATO_WORDS.map((word, i): [string, string] => [word, String.fromCharCode(65 + i)]),
  ["alfa", "A"],
  ["juliett", "J"],
  ...Object.entries(LETTER_NAMES),
  ...Object.entries(DIGIT_WORDS),
]);

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];
const ORDINAL_PATTERN = new RegExp(`\\b(${ORDINALS.join("|")})\\s+(digit|letter|character)\\b`);
const AS_IN_PATTERN = new RegExp(`\\b[a-z0-9]+\\s+(?:as in|for)\\s+(${NATO_WORDS.join("|")})\\b`, "g");

export const ID_LENGTH = 8;

export function isValid(id: string): boolean {
  return /^[A-Z]{2}\d{6}$/.test(id);
}

// "B as in Bravo, D as in Delta, 4 1 8 2 0 7". Digits have no commas so the voice does not stall on each one.
export function spell(id: string): string {
  const letters = [...id.slice(0, 2)].map((c) => {
    if (!/[A-Z]/.test(c)) return c;
    const word = NATO_WORDS[c.charCodeAt(0) - 65]!;
    return `${c} as in ${word[0]!.toUpperCase()}${word.slice(1)}`;
  });
  const digits = [...id.slice(2)].join(" ");
  return [...letters, digits].filter(Boolean).join(", ");
}

// Adds what the caller just said to the ID, or applies a correction if they made one.
export function updateId(current: string, text: string): string {
  const clean = simplify(text);

  const position = clean.match(ORDINAL_PATTERN);
  if (position) {
    const index = ORDINALS.indexOf(position[1]!) + (position[2] === "digit" ? 2 : 0);
    const [right] = toChars(clean.slice(position.index! + position[0].length));
    return right ? replaceAt(current, index, right) : current;
  }

  const [before = "", after] = clean.split(/\bnot\b/);
  if (after !== undefined) {
    const [right] = toChars(before);
    const [wrong] = toChars(after);
    if (!right || !wrong) return current;
    return replaceAt(current, current.indexOf(wrong), right);
  }

  return fit([...current, ...toChars(clean)]);
}

function simplify(text: string): string {
  return text
    .toLowerCase()
    .replace(/x[- ]ray/g, "xray")
    .replace(AS_IN_PATTERN, "$1")
    .replace(/'/g, "")
    .replace(/[^a-z0-9 ]/g, " ");
}

// Ignores words that are not part of an ID. A lone letter, digits, or "bd418" style words count.
function toChars(text: string): string[] {
  const out: string[] = [];
  let repeat = 1;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (word === "double") repeat = 2;
    else if (word === "triple") repeat = 3;
    else {
      const found = WORDS.get(word) ?? (/^([a-z0-9]|\d+|[a-z]{2}\d+)$/.test(word) ? word.toUpperCase() : "");
      for (const c of found) out.push(...Array<string>(repeat).fill(c));
      repeat = 1;
    }
  }
  return out;
}

function replaceAt(id: string, index: number, char: string): string {
  if (index < 0 || index >= id.length) return id;
  return fit([...id.slice(0, index), char, ...id.slice(index + 1)]);
}

// Positions 0-1 must be letters and 2-7 digits, so "oh" becomes O or 0 by position.
function fit(chars: string[]): string {
  return chars
    .map((c, i) => (i < 2 ? (c === "0" ? "O" : c) : c === "O" ? "0" : c))
    .join("")
    .slice(0, ID_LENGTH);
}
