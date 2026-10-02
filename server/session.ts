import type { Booking } from "./booking";
import type { Slot } from "./fakeBackend";

export type Stage = "ASK_ID" | "CONFIRM_ID" | "OFFER_SLOTS" | "CONFIRM_SLOT" | "BOOKING" | "DONE";

export type Session = {
  id: string;
  stage: Stage;
  trackingId: string;
  slots: Slot[];
  chosenSlotId?: string;
  confirmedSlotId?: string;
  booking?: Booking;
  lastSaid: string;
  busy: boolean;
};

export const sessions = new Map<string, Session>();

export function newSession(id: string): Session {
  return { id, stage: "ASK_ID", trackingId: "", slots: [], lastSaid: "", busy: false };
}

export function getSession(id: string): Session {
  let session = sessions.get(id);
  if (!session) {
    session = newSession(id);
    sessions.set(id, session);
  }
  return session;
}
