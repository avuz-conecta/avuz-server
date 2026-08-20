import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfig } from "./config.mjs";

test("parseConfig reads defaults when only TALK_URL set", () => {
  const config = parseConfig({ TALK_URL: "https://x/call/abc" });
  assert.equal(config.talkUrl, "https://x/call/abc");
  assert.equal(config.guests, 25);
  assert.equal(config.holdSeconds, 300);
  assert.equal(config.staggerMs, 500);
  assert.equal(config.namePrefix, "LoadTest");
  assert.equal(config.navTimeoutMs, 60000);
  assert.equal(config.joinTimeoutMs, 45000);
  assert.equal(config.headful, false);
});

test("parseConfig reads NAV_TIMEOUT_MS and JOIN_TIMEOUT_MS for slow links", () => {
  const config = parseConfig({
    TALK_URL: "https://x/call/abc",
    NAV_TIMEOUT_MS: "120000",
    JOIN_TIMEOUT_MS: "90000",
  });
  assert.equal(config.navTimeoutMs, 120000);
  assert.equal(config.joinTimeoutMs, 90000);
});

test("parseConfig overrides from env and coerces numbers", () => {
  const config = parseConfig({
    TALK_URL: "https://x/call/abc",
    GUESTS: "10",
    HOLD_SECONDS: "60",
    STAGGER_MS: "250",
    NAME_PREFIX: "QA",
    HEADFUL: "1",
  });
  assert.equal(config.guests, 10);
  assert.equal(config.holdSeconds, 60);
  assert.equal(config.staggerMs, 250);
  assert.equal(config.namePrefix, "QA");
  assert.equal(config.headful, true);
});

test("parseConfig defaults nameOffset to 0 and nameTotal to guests", () => {
  const config = parseConfig({ TALK_URL: "https://x/call/abc", GUESTS: "13" });
  assert.equal(config.nameOffset, 0);
  assert.equal(config.nameTotal, 13);
});

test("parseConfig reads NAME_OFFSET and NAME_TOTAL for sharded runs", () => {
  const config = parseConfig({
    TALK_URL: "https://x/call/abc",
    GUESTS: "12",
    NAME_OFFSET: "13",
    NAME_TOTAL: "25",
  });
  assert.equal(config.nameOffset, 13);
  assert.equal(config.nameTotal, 25);
});

test("parseConfig throws when TALK_URL missing", () => {
  assert.throws(() => parseConfig({}), /TALK_URL/);
});
