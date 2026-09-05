import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { approveDataset, datasetFingerprint, decide, exportDataset, freshReview, parseDataset } from "../lib/handwriting-dataset.ts";
import { analysisPreview, applyReviewAction, catalog, createDataset, readDataset } from "../lib/handwriting-store.server.ts";
import { checkDevRequest } from "../lib/handwriting-access.server.ts";
import { readJson } from "../lib/handwriting-http.server.ts";

const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1cAAAAASUVORK5CYII=";
const dataset = () => parseDataset({ schemaVersion: 1, kind: "handwriting-candidates", name: "Synthetic library test",
  samples: ["x", "x", "x", "y", "z"].map((latex, i) => ({ id: String(i + 1), latex, image, context: image,
    source: { file: "synthetic.pdf", sha256: "a".repeat(64), page: 1, pageWidth: 600, pageHeight: 800, box: [20 * i, 10, 10, 10] } })) });
let folder;
const previousFolder = process.env.HANDWRITING_DATA_DIR;
beforeEach(async () => { folder = await mkdtemp(path.join(os.tmpdir(), "aibook-handwriting-test-")); process.env.HANDWRITING_DATA_DIR = folder; });
afterEach(async () => {
  assert.equal(path.dirname(path.resolve(folder)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(folder).startsWith("aibook-handwriting-test-"));
  await rm(folder, { recursive: true, force: true });
  if (previousFolder === undefined) delete process.env.HANDWRITING_DATA_DIR; else process.env.HANDWRITING_DATA_DIR = previousFolder;
});

async function approvedFixture() {
  const data = dataset();
  let review = data.samples.reduce((r, sample) => decide(r, sample, sample.id === "5" ? "rejected" : "accepted", sample.latex,
    "2026-09-05T09:00:00Z", sample.id === "5" ? "incorrect-outline" : undefined), freshReview());
  review = approveDataset(data, { ...review, inspectedRevision: review.revision });
  return { data, review, approved: exportDataset({ dataset: data, review, fingerprint: await datasetFingerprint(data) }) };
}

test("candidate import starts pending, persists to disk, and duplicate import never resets a decision", async () => {
  const data = dataset(), item = await createDataset({ ...data, approvedAt: "2026-09-05" });
  assert.equal(item.pending, 5);
  await applyReviewAction(item.id, { type: "decide", expectedVersion: 0, sampleId: "1", latex: "x", status: "accepted" });
  assert.equal((await createDataset(data)).accepted, 1);
  const saved = await readDataset(item.id);
  assert.equal(saved.review.decisions["1"].status, "accepted");
  assert.equal(JSON.parse(await readFile(path.join(folder, item.id, "state.json"), "utf8")).version, 1);
  assert.equal((await catalog()).length, 1);
  assert.equal((await analysisPreview(item.id)).approved, false);
});

test("approved import restores all decisions including excluded rare symbols and rejected crops", async () => {
  const { data, review, approved } = await approvedFixture();
  const item = await createDataset(approved, { sourceCandidates: data, name: "Imported review" });
  assert.equal(item.status, "approved");
  assert.equal(item.total, 5);
  assert.equal(item.exportable, 3);
  const restored = await readDataset(item.id);
  assert.deepEqual(restored.review.decisions, review.decisions);
  assert.equal(restored.review.approvedAt, approved.approvedAt);
  assert.deepEqual(restored.review.history, []);
  assert.deepEqual(JSON.parse(await readFile(path.join(folder, item.id, "original-approved.json"), "utf8")), approved);
  assert.deepEqual((await analysisPreview(item.id)).symbols, [{ latex: "x", count: 3 }]);
});

test("approved import rejects mismatched source packs and inconsistent export claims", async () => {
  const { data, approved } = await approvedFixture();
  await assert.rejects(createDataset(approved, { sourceCandidates: { ...data, name: "Changed" } }), /does not match/);
  await assert.rejects(createDataset({ ...approved, samples: approved.samples.slice(1) }, { sourceCandidates: data }), /do not match/);
  await assert.rejects(createDataset({ ...approved, decisions: approved.decisions.slice(1) }, { sourceCandidates: data }), /missing/);
  assert.deepEqual(await catalog(), []);
});

test("concurrent stale writes cannot overwrite decisions; undo and approval remain versioned", async () => {
  const item = await createDataset(dataset());
  const results = await Promise.allSettled(["accepted", "rejected"].map(status => applyReviewAction(item.id,
    { type: "decide", expectedVersion: 0, sampleId: "1", latex: "x", status })));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.find(r => r.status === "rejected").reason.status, 409);
  const saved = await readDataset(item.id);
  assert.equal(saved.version, 1);
  assert.equal(saved.review.history.length, 1);
  await assert.rejects(applyReviewAction(item.id, { type: "approve", expectedVersion: 1 }), /every sample/);
  const undone = await applyReviewAction(item.id, { type: "undo", expectedVersion: 1 });
  assert.equal(undone.version, 2);
  assert.equal(undone.selectedId, "1");
  assert.deepEqual(undone.review.decisions, {});
});

test("revising an imported approval clears analysis eligibility without changing the archived export", async () => {
  const { data, approved } = await approvedFixture();
  const item = await createDataset(approved, { sourceCandidates: data });
  const result = await applyReviewAction(item.id, { type: "decide", expectedVersion: 0, sampleId: "1", status: "rejected", latex: "x", issue: "incorrect-symbol" });
  assert.equal(result.review.approvedAt, null);
  assert.equal(result.review.decisions["1"].issue, "incorrect-symbol");
  assert.deepEqual((await analysisPreview(item.id)).symbols, []);
  assert.equal((await catalog())[0].status, "reviewed");
  assert.deepEqual(JSON.parse(await readFile(path.join(folder, item.id, "original-approved.json"), "utf8")), approved);
});

test("bad paths and malformed labels cannot create files or change a review", async () => {
  await assert.rejects(readDataset("../../elsewhere"), /not found/);
  await assert.rejects(createDataset({ ...dataset(), samples: [{ ...dataset().samples[0], latex: "\\unknowncommand" }] }), /Invalid LaTeX/);
  const item = await createDataset(dataset());
  await assert.rejects(applyReviewAction(item.id, { type: "decide", expectedVersion: 0, sampleId: "1", status: "accepted", latex: "x", issue: "incorrect-outline" }), /cannot be accepted/);
  assert.equal((await readDataset(item.id)).version, 0);
  await writeFile(path.join(folder, item.id, "state.json"), "broken");
  await assert.rejects(catalog());
});

test("dev access is disabled by default, local only, and rejects cross-origin writes", () => {
  const enabled = process.env.HANDWRITING_REVIEW_ENABLED;
  const nodeEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production"; process.env.HANDWRITING_REVIEW_ENABLED = "0";
    const request = (host, method = "GET", origin) => new Request("http://localhost/dev/datasets", { method,
      headers: { host, "content-type": "application/json", ...(origin ? { origin } : {}) } });
    assert.equal(checkDevRequest(request("localhost")).status, 404);
    process.env.HANDWRITING_REVIEW_ENABLED = "1";
    assert.equal(checkDevRequest(request("example.com")).status, 404);
    assert.equal(checkDevRequest(request("localhost")), null);
    assert.equal(checkDevRequest(request("localhost", "POST", "https://example.com")).status, 403);
    assert.equal(checkDevRequest(request("localhost", "POST", "http://localhost")), null);
  } finally {
    if (enabled === undefined) delete process.env.HANDWRITING_REVIEW_ENABLED; else process.env.HANDWRITING_REVIEW_ENABLED = enabled;
    if (nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = nodeEnv;
  }
});

test("request limits also apply to streamed bodies without Content-Length", async () => {
  const request = new Request("http://localhost/dev/datasets", { method: "POST", body: JSON.stringify({ value: "a".repeat(100) }) });
  await assert.rejects(readJson(request, 32), error => error.status === 413);
  await assert.rejects(readJson(new Request("http://localhost", { method: "POST", body: "invalid" })), /Invalid JSON/);
});
