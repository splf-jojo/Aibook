import test from "node:test";
import assert from "node:assert/strict";
import { readyHandwriting, chooseHandwriting, canvasHandwritingCatalog, canvasHandwritingDataset, handwritingIssue, formulaSeed } from "../lib/canvas-handwriting.ts";

const id = "a".repeat(64);
const ready = { id, status: "approved", analysisStatus: "complete", exportable: 43, updatedAt: "2026-09-05" };
test("auto selects the largest approved analyzed profile; an explicit unavailable choice never switches profiles", () => {
  const items = [{ ...ready, id: "draft", status: "review", exportable: 100 },
    { ...ready, id: "stale", analysisStatus: "stale", exportable: 100 },
    { ...ready, id: "empty", exportable: 0 }, { ...ready, id: "smaller", exportable: 20 }, ready];
  assert.equal(chooseHandwriting(items, "auto").id, id);
  assert.equal(chooseHandwriting(items, "smaller").id, "smaller");
  assert.equal(chooseHandwriting(items, "stale"), undefined);
  assert.equal(chooseHandwriting(items, "font"), undefined);
  assert.deepEqual(readyHandwriting(items).map(item => item.id), [id, "smaller"]);
  assert.equal(items[0].id, "draft");
});

test("protected requests establish the existing dev session and retry only after success", async t => {
  const calls = [], signal = new AbortController().signal;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? new Response(null, { status: 401 }) : Response.json(calls.length === 2 ? {} : [ready]);
  });
  assert.deepEqual(await canvasHandwritingCatalog("test-token", signal), [ready]);
  assert.deepEqual(calls.map(call => call.url), ["/dev/datasets", "/dev/session", "/dev/datasets"]);
  assert.equal(calls[1].options.body, JSON.stringify({ token: "test-token" }));
  assert.ok(calls.every(call => call.options.cache === "no-store" && call.options.signal === signal));
});

test("forbidden session does not retry or expose a profile", async t => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; return new Response(null, { status: 403 }); });
  await assert.rejects(canvasHandwritingCatalog("test-token"), error => handwritingIssue(error) === "sign-in");
  assert.equal(requests, 2);
});

test("dataset validation rejects unapproved, stale and empty packs and unsafe IDs", async t => {
  let requests = 0, dataset = { approved: true, status: "complete", glyphs: [{}] };
  t.mock.method(globalThis, "fetch", async () => { requests++; return Response.json(dataset); });
  assert.deepEqual(await canvasHandwritingDataset(id, "test-token"), dataset);
  for (const invalid of [{ ...dataset, approved: false }, { ...dataset, status: "stale" }, { ...dataset, glyphs: [] }]) {
    dataset = invalid;
    await assert.rejects(canvasHandwritingDataset(id, "test-token"), error => handwritingIssue(error) === "not-ready");
  }
  await assert.rejects(canvasHandwritingDataset("../private", "test-token"));
  assert.equal(requests, 4);
});

test("aborted request propagates and formula seeds reproduce settings", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new DOMException("Aborted", "AbortError"); });
  await assert.rejects(canvasHandwritingCatalog("test-token"), { name: "AbortError" });
  assert.equal(formulaSeed("x+1"), formulaSeed("x+1"));
  assert.notEqual(formulaSeed("x+1"), formulaSeed("x+2"));
});
