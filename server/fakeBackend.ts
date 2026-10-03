// A courier backend that misbehaves on purpose, so the agent has to cope.

export type Mode = "ok" | "slow" | "fail" | "lostack" | "hang";
export type Slot = { id: string; label: string; day: string; period: "morning" | "afternoon" | "evening" };
export type BackendBooking = { ref: string; key: string; slotId: string };

export type CallKind = "slots" | "book" | "status";
export type BackendEvent = { call: CallKind; mode: Mode };

type Options = { normalMs?: number; slowMs?: number; failMs?: number };

// ok: answers fast. slow: answers late. fail: errors, nothing saved.
// lostack: saves the booking but the reply is lost. hang: never answers.
const WEIGHTS: [Mode, number][] = [["ok", 8], ["slow", 4], ["fail", 4], ["lostack", 3], ["hang", 1]];
const MODES = WEIGHTS.flatMap(([mode, count]) => Array<Mode>(count).fill(mode));

const WINDOWS = [
  { period: "morning", time: "9 AM to 11 AM" },
  { period: "afternoon", time: "1 PM to 3 PM" },
  { period: "evening", time: "4 PM to 6 PM" },
] as const;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function slotList(): Slot[] {
  return [1, 2].flatMap((daysAhead) => {
    const date = new Date(Date.now() + daysAhead * 86_400_000);
    const day = date.toLocaleDateString("en-US", { weekday: "long" });
    const iso = date.toISOString().slice(0, 10);
    return WINDOWS.map(({ period, time }, i) => ({ id: `${iso}-${i + 1}`, label: `${day} ${time}`, day, period }));
  });
}

export function createBackend({ normalMs = 300, slowMs = 6000, failMs = 500 }: Options = {}) {
  const bookings = new Map<string, BackendBooking>();
  const listeners = new Set<(event: BackendEvent) => void>();

  const backend = {
    bookings,
    // Forces every booking request into one mode. Used by the stress test buttons.
    // Looking up slots and checking a booking stay normal, so the agent can still recover.
    forced: undefined as Mode | undefined,
    // Modes used by the next calls, in order. Used by tests.
    script: [] as Mode[],

    // Tells the listener what the backend decided to do, before it does it.
    subscribe(listener: (event: BackendEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    pickMode(kind: CallKind = "book"): Mode {
      const scripted = backend.script.shift();
      if (scripted) return scripted;
      if (backend.forced) return kind === "book" ? backend.forced : "ok";
      return MODES[Math.floor(Math.random() * MODES.length)]!;
    },

    slots: () => act("slots", slotList),

    // Booking the same key twice returns the first booking.
    book: (key: string, slotId: string) =>
      act("book", () => {
        const existing = bookings.get(key);
        if (existing) return existing;
        const booking = { ref: `CR-${7000 + bookings.size + 1}`, key, slotId };
        bookings.set(key, booking);
        return booking;
      }),

    status: (key: string) => act("status", () => bookings.get(key) ?? null),
  };

  async function act<T>(call: CallKind, run: () => T): Promise<T> {
    const mode = backend.pickMode(call);
    listeners.forEach((listener) => listener({ call, mode }));
    if (mode === "hang") return new Promise<T>(() => {});
    if (mode === "fail") {
      await sleep(failMs);
      throw new Error("backend error 500");
    }
    await sleep(mode === "slow" ? slowMs : normalMs);
    const result = run();
    if (mode === "lostack") throw new Error("connection reset");
    return result;
  }

  return backend;
}

export type Backend = ReturnType<typeof createBackend>;
