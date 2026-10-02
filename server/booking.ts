import type { Backend } from "./fakeBackend";

export type LogKind = "info" | "good" | "warn" | "bad";

export type Booking = {
  key: string;
  status: "pending" | "unknown" | "done" | "failed";
  slotId: string;
  ref?: string;
};

export type Options = {
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  waitFirstMs?: number;
  waitEveryMs?: number;
  onWait?: (count: number) => void;
  onEvent?: (kind: LogKind, text: string) => void;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

// Tries a backend call a few times. Returns undefined if every attempt failed or timed out.
export async function callWithRetry<T>(
  call: () => Promise<T>,
  what: string,
  options: Options = {},
  attempts = (options.retries ?? 2) + 1,
): Promise<T | undefined> {
  const { timeoutMs = 4000, backoffMs = 300, onEvent } = options;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      onEvent?.("info", `${what} (attempt ${attempt} of ${attempts})`);
      return await withTimeout(call(), timeoutMs);
    } catch (error) {
      onEvent?.("warn", `${what} failed: ${(error as Error).message}`);
      if (attempt < attempts) await sleep(backoffMs * attempt);
    }
  }
  return undefined;
}

// Calls onWait while run is still going, so the caller never hears silence.
export async function withWaitNotice<T>(options: Options, run: () => Promise<T>): Promise<T> {
  const { waitFirstMs = 1500, waitEveryMs = 6000, onWait } = options;
  let count = 0;
  let timer: ReturnType<typeof setTimeout>;
  const wait = () => {
    onWait?.(++count);
    timer = setTimeout(wait, waitEveryMs);
  };
  timer = setTimeout(wait, waitFirstMs);
  try {
    return await run();
  } finally {
    clearTimeout(timer);
  }
}

// Only a slot the caller explicitly confirmed can be booked.
// The returned booking should be stored on the session before bookSlot is called.
export function startBooking(trackingId: string, slotId: string, confirmedSlotId?: string): Booking {
  if (slotId !== confirmedSlotId) throw new Error("slot was not confirmed by the caller");
  return { key: `${trackingId}:${slotId}`, slotId, status: "pending" };
}

// Every attempt sends the same key, so the backend never books twice.
// If every attempt fails, we ask the backend whether the booking exists before giving up.
export function bookSlot(backend: Backend, booking: Booking, options: Options = {}): Promise<Booking> {
  return withWaitNotice(options, async () => {
    const booked = await callWithRetry(() => backend.book(booking.key, booking.slotId), "Booking request", options);
    const found = booked ?? (await callWithRetry(() => backend.status(booking.key), "Status check", options, 2));

    if (found) {
      booking.status = "done";
      booking.ref = found.ref;
    } else {
      booking.status = found === null ? "failed" : "unknown";
    }
    return booking;
  });
}
