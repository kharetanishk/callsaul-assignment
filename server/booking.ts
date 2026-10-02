import type { Backend } from "./fakeBackend";

export type Booking = {
  key: string;
  status: "pending" | "unknown" | "done" | "failed";
  slotId: string;
  ref?: string;
};

type Options = {
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  waitFirstMs?: number;
  waitEveryMs?: number;
  onWait?: (count: number) => void;
  onEvent?: (text: string) => void;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

// Only a slot the caller explicitly confirmed can be booked.
// The returned booking should be stored on the session before bookSlot is called.
export function startBooking(trackingId: string, slotId: string, confirmedSlotId?: string): Booking {
  if (slotId !== confirmedSlotId) throw new Error("slot was not confirmed by the caller");
  return { key: `${trackingId}:${slotId}`, slotId, status: "pending" };
}

// Every attempt sends the same key, so the backend never books twice.
// If every attempt fails, we ask the backend whether the booking exists before giving up.
export async function bookSlot(backend: Backend, booking: Booking, options: Options = {}): Promise<Booking> {
  const { timeoutMs = 4000, retries = 2, backoffMs = 300, waitFirstMs = 1500, waitEveryMs = 6000 } = options;
  const log = options.onEvent ?? (() => {});

  async function tryCalls<T>(attempts: number, call: () => Promise<T>, what: string): Promise<T | undefined> {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        log(`${what}, attempt ${attempt} of ${attempts}`);
        return await withTimeout(call(), timeoutMs);
      } catch (error) {
        log(`${what} failed: ${(error as Error).message}`);
        if (attempt < attempts) await sleep(backoffMs * attempt);
      }
    }
    return undefined;
  }

  let waits = 0;
  let timer: ReturnType<typeof setTimeout>;
  const wait = () => {
    options.onWait?.(++waits);
    timer = setTimeout(wait, waitEveryMs);
  };
  timer = setTimeout(wait, waitFirstMs);

  try {
    const booked = await tryCalls(retries + 1, () => backend.book(booking.key, booking.slotId), "Booking request");
    const found = booked ?? (await tryCalls(2, () => backend.status(booking.key), "Status check"));

    if (found) {
      booking.status = "done";
      booking.ref = found.ref;
    } else {
      booking.status = found === null ? "failed" : "unknown";
    }
    return booking;
  } finally {
    clearTimeout(timer);
  }
}
