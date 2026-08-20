import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize, formatReport } from "./report.mjs";

const results = [
  { name: "LoadTest-01", joined: true, ice: true, remote: 24, errors: [] },
  { name: "LoadTest-02", joined: true, ice: false, remote: 0, errors: ["boom"] },
];

test("summarize counts joined and ice-connected peers", () => {
  const summary = summarize(results);
  assert.equal(summary.total, 2);
  assert.equal(summary.joined, 2);
  assert.equal(summary.ice, 1);
  assert.equal(summary.withErrors, 1);
});

test("formatReport renders one row per peer with name and counts", () => {
  const table = formatReport(results);
  assert.match(table, /LoadTest-01/);
  assert.match(table, /LoadTest-02/);
  assert.match(table, /boom/);
});
