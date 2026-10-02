import { expect, test } from "bun:test";
import { bookSlot, startBooking } from "../server/booking";
import { createBackend, type Mode } from "../server/fakeBackend";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const fast = { timeoutMs: 30, backoffMs: 1, waitFirstMs: 10, waitEveryMs: 1000 };

function setup(script: Mode[]) {
  const backend = createBackend({ normalMs: 1, slowMs: 60, failMs: 1 });
  backend.script = script;
  return { backend, booking: startBooking("BD418207", "slot-1", "slot-1") };
}

test("refuses to book a slot the caller did not confirm", () => {
  expect(() => startBooking("BD418207", "slot-1")).toThrow();
  expect(() => startBooking("BD418207", "slot-1", "slot-2")).toThrow();
});

test("books on the happy path", async () => {
  const { backend, booking } = setup(["ok"]);
  await bookSlot(backend, booking, fast);
  expect(booking.status).toBe("done");
  expect(backend.bookings.size).toBe(1);
});

test("a lost reply followed by a retry does not double-book", async () => {
  const { backend, booking } = setup(["lostack", "ok"]);
  await bookSlot(backend, booking, fast);
  expect(booking.status).toBe("done");
  expect(backend.bookings.size).toBe(1);
  expect(booking.ref).toBe([...backend.bookings.values()][0]!.ref);
});

test("a slow reply that finishes after the retry does not double-book", async () => {
  const { backend, booking } = setup(["slow", "ok"]);
  await bookSlot(backend, booking, fast);
  await sleep(100);
  expect(booking.status).toBe("done");
  expect(backend.bookings.size).toBe(1);
});

test("every reply lost still ends as booked, once, after a status check", async () => {
  const { backend, booking } = setup(["lostack", "lostack", "lostack", "ok"]);
  await bookSlot(backend, booking, fast);
  expect(booking.status).toBe("done");
  expect(backend.bookings.size).toBe(1);
});

test("a backend that never saved the booking ends as failed", async () => {
  const { backend, booking } = setup(["fail", "fail", "fail", "ok"]);
  await bookSlot(backend, booking, fast);
  expect(booking.status).toBe("failed");
  expect(backend.bookings.size).toBe(0);
});

test("a backend that never answers still gives an answer", async () => {
  const { backend, booking } = setup(["hang", "hang", "hang", "ok"]);
  await bookSlot(backend, booking, fast);
  expect(booking.status).toBe("failed");
});

test("an unreachable backend ends as unknown, not failed", async () => {
  const { backend, booking } = setup(["fail", "fail", "fail", "fail", "fail"]);
  await bookSlot(backend, booking, fast);
  expect(booking.status).toBe("unknown");
  expect(backend.bookings.size).toBe(0);
});

test("tells the caller to wait while the backend is slow", async () => {
  const { backend, booking } = setup(["slow"]);
  const waits: number[] = [];
  await bookSlot(backend, booking, { ...fast, timeoutMs: 200, onWait: (n) => waits.push(n) });
  expect(waits).toEqual([1]);
  expect(booking.status).toBe("done");
});

test("the same seed gives the same misbehaviour", () => {
  const modes = (seed: number) => {
    const backend = createBackend({ seed });
    return Array.from({ length: 20 }, () => backend.pickMode());
  };
  expect(modes(42)).toEqual(modes(42));
  expect(modes(42)).not.toEqual(modes(7));
});

test("offers slots with an id and a label", async () => {
  const backend = createBackend({ normalMs: 1 });
  backend.forced = "ok";
  const slots = await backend.slots();
  expect(slots.length).toBeGreaterThanOrEqual(3);
  expect(slots[0]).toHaveProperty("id");
  expect(slots[0]).toHaveProperty("label");
});
