import { test } from "node:test";
import assert from "node:assert/strict";
import { guestName } from "./naming.mjs";

test("guestName zero-pads to width of total", () => {
  assert.equal(guestName("LoadTest", 0, 25), "LoadTest-01");
  assert.equal(guestName("LoadTest", 9, 25), "LoadTest-10");
  assert.equal(guestName("LoadTest", 24, 25), "LoadTest-25");
});

test("guestName widens padding for 100+ guests", () => {
  assert.equal(guestName("QA", 0, 100), "QA-001");
});
