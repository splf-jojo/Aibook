import test from "node:test";
import assert from "node:assert/strict";
import { approveDataset, datasetStats, decide, exportDataset, freshReview, parseDataset, reviewForImport, undoDecision } from "../lib/handwriting-dataset.ts";

const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1cAAAAASUVORK5CYII=";
const sample = (id, latex = "x", x = Number(id) * 20) => ({ id, latex, image, context: image,
  source: { file: "test.pdf", sha256: "a".repeat(64), page: 1, pageWidth: 600, pageHeight: 800, box: [x, 10, 10, 10] } });
const dataset = () => parseDataset({ schemaVersion: 1, kind: "handwriting-candidates", name: "Test", samples: [sample("1"), sample("2"), sample("3"), sample("4", "y")] });
function acceptAll(data) { return data.samples.reduce((review, item) => decide(review, item, "accepted", item.latex), freshReview()); }

test("new candidates remain pending even if the imported file claims they are approved", () => {
  const data = dataset();
  const imported = parseDataset({ ...data, approvedAt: "2026-01-01", samples: data.samples.map((s) => ({ ...s, status: "accepted" })) });
  assert.equal(datasetStats(imported, freshReview()).pending, 4);
  assert.equal(imported.samples[0].status, undefined);
});

test("extending a pack preserves exact existing decisions but requires a new final approval", () => {
  const data = dataset();
  let review = acceptAll(data);
  review = decide(review, data.samples[3], "rejected", "y", undefined, "incorrect-outline");
  review = approveDataset(data, { ...review, inspectedRevision: review.revision });
  const previous = { dataset: data, fingerprint: "old", review };
  const extended = parseDataset({ ...data, samples: [...data.samples, sample("5")] });
  const next = reviewForImport(extended, previous);
  assert.deepEqual(next.decisions, review.decisions);
  assert.deepEqual(next.history, review.history);
  assert.equal(next.approvedAt, null);
  assert.equal(next.inspectedRevision, null);
  assert.equal(datasetStats(extended, next).pending, 1);
  assert.deepEqual(reviewForImport(extended, null), freshReview());
  extended.samples[0].latex = "z";
  assert.deepEqual(reviewForImport(extended, previous), freshReview());
  assert.ok(previous.review.approvedAt);
});

test("final acceptance requires decisions on every candidate and an explicit final inspection", () => {
  const data = dataset();
  assert.throws(() => approveDataset(data, freshReview()), /every sample/);
  let review = acceptAll(data);
  assert.throws(() => approveDataset(data, review), /gallery/);
  review = approveDataset(data, { ...review, inspectedRevision: review.revision });
  assert.ok(review.approvedAt);
});

test("export contains only accepted examples of sufficiently represented symbols", () => {
  const data = dataset();
  let review = acceptAll(data);
  review = approveDataset(data, { ...review, inspectedRevision: review.revision });
  const result = exportDataset({ dataset: data, fingerprint: "fingerprint", review });
  assert.equal(result.samples.length, 3);
  assert.ok(result.samples.every((s) => s.latex === "x"));
  assert.deepEqual(result.excludedSymbols.map((g) => g.latex), ["y"]);
  assert.equal(result.decisions.length, 4);
});

test("changing or undoing a decision invalidates final acceptance", () => {
  const data = dataset();
  let review = acceptAll(data);
  review = approveDataset(data, { ...review, inspectedRevision: review.revision });
  review = decide(review, data.samples[0], "rejected", "x");
  assert.equal(review.approvedAt, null);
  assert.equal(review.inspectedRevision, null);
  assert.throws(() => exportDataset({ dataset: data, fingerprint: "f", review }), /not approved/);
  const undone = undoDecision(review);
  assert.equal(undone.id, "1");
  assert.equal(undone.review.decisions["1"].status, "accepted");
  assert.equal(undone.review.approvedAt, null);
});

test("a corrected label determines coverage and export", () => {
  const data = dataset();
  let review = acceptAll(data);
  review = decide(review, data.samples[0], "accepted", "z");
  assert.equal(datasetStats(data, review).eligible.length, 0);
  assert.throws(() => approveDataset(data, { ...review, inspectedRevision: review.revision }), /At least one/);
});

test("rejecting every example cannot produce an accepted empty dataset", () => {
  const data = dataset();
  let review = data.samples.reduce((r, s) => decide(r, s, "rejected", s.latex), freshReview());
  review = { ...review, inspectedRevision: review.revision };
  assert.throws(() => approveDataset(data, review), /At least one/);
});

test("separate outline and symbol issues persist in the audit, never in accepted samples", () => {
  const data = dataset();
  data.samples.push(sample("5"));
  let review = acceptAll(data);
  review = decide(review, data.samples[3], "rejected", "y", "2026-09-05", "incorrect-outline");
  review = decide(review, data.samples[4], "rejected", "x", "2026-09-05", "incorrect-symbol");
  assert.equal(datasetStats(data, review).accepted, 3);
  assert.equal(datasetStats(data, review).rejected, 2);
  review = approveDataset(data, { ...review, inspectedRevision: review.revision });
  const exported = exportDataset({ dataset: data, fingerprint: "f", review });
  assert.deepEqual(exported.samples.map((s) => s.id), ["1", "2", "3"]);
  assert.equal(exported.decisions[3].issue, "incorrect-outline");
  assert.equal(exported.decisions[4].issue, "incorrect-symbol");
  const revised = decide(review, data.samples[3], "rejected", "y");
  assert.equal(revised.decisions["4"].issue, undefined);
  const undo = undoDecision(revised);
  assert.equal(undo.review.decisions["4"].issue, "incorrect-outline");
  assert.equal(undo.review.approvedAt, null);
  assert.throws(() => decide(review, data.samples[3], "accepted", "y", undefined, "incorrect-outline"), /cannot be accepted/);
});

test("import rejects duplicate identities, duplicate source crops, remote images, and bad bounds", () => {
  const data = dataset();
  assert.throws(() => parseDataset({ ...data, samples: [data.samples[0], data.samples[0]] }), /ID/);
  assert.throws(() => parseDataset({ ...data, samples: [sample("1"), sample("2", "x", 20)] }), /same PDF crop/);
  assert.throws(() => parseDataset({ ...data, samples: [{ ...sample("1"), image: "https://example.com/private.png" }] }), /PNG/);
  assert.throws(() => parseDataset({ ...data, samples: [sample("1", "x", 599)] }), /page bounds/);
  assert.throws(() => parseDataset({ ...data, samples: [sample("__proto__", "x", 20)] }), /ID/);
});
