import { expect, test } from "bun:test";
import { discardSession, getSession, releaseSession } from "../server/session";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("a released session is kept for a while, then forgotten", async () => {
  const session = getSession("expires");
  session.lastSaid = "hello";
  releaseSession("expires", 30);

  await sleep(10);
  expect(getSession("expires").lastSaid).toBe("hello");
  releaseSession("expires", 30);
  await sleep(60);
  expect(getSession("expires").lastSaid).toBe("");
  discardSession("expires");
});

test("coming back before the time is up keeps the session", async () => {
  getSession("returns").lastSaid = "hello";
  releaseSession("returns", 30);
  getSession("returns");
  await sleep(60);
  expect(getSession("returns").lastSaid).toBe("hello");
  discardSession("returns");
});

test("a call that was ended on purpose cannot be resumed", () => {
  getSession("hung-up").lastSaid = "hello";
  discardSession("hung-up");
  expect(getSession("hung-up").lastSaid).toBe("");
  discardSession("hung-up");
});
