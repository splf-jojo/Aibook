// Run against a local Docker stack. Fixtures are isolated and removed by exact IDs.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import sharp from "sharp";

const pool = new pg.Pool({ max: 2 });
const api = process.env.INTERNAL_API_URL ?? "http://api:8000";
const web = process.env.HANDWRITING_TEST_URL ?? "http://127.0.0.1:3000";
const accounts = [];
async function account() {
  const username = `cloud-test-${randomUUID().slice(0, 18)}`;
  const response = await fetch(`${api}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password: randomUUID(), role: "dev" }) });
  assert.equal(response.status, 201);
  const token = (await response.json()).access_token;
  const me = await (await fetch(`${api}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
  assert.equal(me.role, "user", "Registration must not accept a client-provided dev role");
  const result = { ...me, token }; accounts.push(result); return result;
}
async function call(user, path, method = "GET", body, expected = 200) {
  const response = await fetch(`${web}/api/handwriting/${path}`, { method, headers: {
    ...(user ? { Authorization: `Bearer ${user.token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(value).slice(0, 200)}`);
  return value;
}
try {
  const alice = await account(), bob = await account(), dev = await account();
  await pool.query("UPDATE users SET role='dev' WHERE id=$1", [dev.id]);
  const pixels = Buffer.alloc(64 * 64, 255);
  for (let y = 8; y < 56; y++) for (let dx = -2; dx <= 2; dx++) { pixels[y * 64 + y + dx] = 0; pixels[y * 64 + 63 - y + dx] = 0; }
  const png = buffer => sharp(buffer, { raw: { width: 64, height: 64, channels: 1 } }).png().toBuffer();
  const image = `data:image/png;base64,${(await png(pixels)).toString("base64")}`;
  const blank = `data:image/png;base64,${(await png(Buffer.alloc(64 * 64, 255))).toString("base64")}`;
  const data = { schemaVersion: 1, kind: "handwriting-candidates", name: "Cloud integration fixture",
    samples: ["x", "x", "x", "q", "y", "z", "z", "z"].map((latex, i) => ({ id: `s${i}`, latex, image: i === 7 ? blank : image, context: image,
      source: { file: "fixture.pdf", sha256: "a".repeat(64), page: 1, pageWidth: 600, pageHeight: 800, box: [i * 20, 20, 12, 12] } })) };
  await call(null, "datasets", "GET", undefined, 401);
  await call(null, "fonts", "GET", undefined, 401);
  const created = await call(alice, "datasets", "POST", { dataset: data, ownerId: bob.id, role: "dev" });
  const id = created.id;
  const duplicate = await call(alice, "datasets", "POST", { dataset: data });
  assert.equal(id, duplicate.id);
  const bobCopy = await call(bob, "datasets", "POST", { dataset: data });
  assert.notEqual(id, bobCopy.id, "Same source from different owners must have separate reviews");
  for (const suffix of ["", "/source", "/analysis"]) await call(bob, `datasets/${id}${suffix}`, "GET", undefined, 404);
  assert.ok((await call(dev, "datasets")).some(item => item.id === id && item.ownerId === alice.id));
  assert.ok(!(await call(bob, "datasets")).some(item => item.id === id));
  const decision = { type: "decide", sampleId: "s0", latex: "x", status: "accepted", expectedVersion: 0 };
  await call(alice, `datasets/${id}`, "PATCH", decision, 403);
  await call(bob, `datasets/${id}/publish`, "POST", { expectedVersion: 0 }, 403);
  const races = await Promise.all(["accepted", "rejected"].map(status => fetch(`${web}/api/handwriting/datasets/${id}`, {
    method: "PATCH", headers: { Authorization: `Bearer ${dev.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...decision, status }),
  })));
  assert.deepEqual(races.map(response => response.status).sort(), [200, 409]);
  let version = 1;
  for (const sample of data.samples) {
    const saved = await call(dev, `datasets/${id}`, "PATCH", { type: "decide", expectedVersion: version, sampleId: sample.id, status: "accepted", latex: sample.latex === "q" ? "x" : sample.latex });
    version = saved.version;
  }
  assert.equal((await call(alice, "datasets", "POST", { dataset: data })).accepted, 8, "Retry must not reset review");
  const before = await call(alice, `datasets/${id}`);
  await call(dev, `datasets/${id}/analysis`, "POST", { expectedVersion: version }, 409);
  version = (await call(dev, `datasets/${id}`, "PATCH", { type: "approve", expectedVersion: version })).version;
  await call(dev, `datasets/${id}/analysis`, "POST", { expectedVersion: version });
  await call(dev, `datasets/${id}/analysis`, "POST", { expectedVersion: version });
  let result;
  for (let tries = 0; tries < 90; tries++) {
    result = await call(dev, `datasets/${id}/analysis`);
    if (!["running", "queued"].includes(result.status)) break;
    await delay(1000);
  }
  assert.equal(result.status, "partial");
  assert.deepEqual(result.symbols.map(symbol => [symbol.latex, symbol.count]), [["x", 4], ["z", 3]]);
  assert.equal(result.symbols[0].result.status, "complete");
  assert.equal(result.symbols[1].result.status, "failed");
  assert.match(result.symbols[1].result.error, /Sample s7/);
  const publication = await call(dev, `datasets/${id}/publish`, "POST", { expectedVersion: version });
  const font = await call(bob, `fonts/${publication.id}`);
  assert.equal(font.glyphs.length, 1);
  const decoded = await sharp(Buffer.from(font.glyphs[0].image.split(",")[1], "base64")).raw().toBuffer({ resolveWithObject: true });
  assert.equal(decoded.info.channels, 4);
  const alpha = decoded.data.filter((_, index) => index % 4 === 3);
  assert.ok(alpha.includes(0) && alpha.includes(255));
  assert.deepEqual((await call(alice, `datasets/${id}`)).review.decisions, before.review.decisions);
  await call(dev, `datasets/${id}`, "PATCH", { type: "decide", expectedVersion: version, sampleId: "s0", latex: "x", status: "rejected" });
  assert.deepEqual(await call(bob, `fonts/${publication.id}`), font, "Published handwriting must survive changes to its source review");
  assert.equal((await call(alice, `datasets/${id}/analysis`)).approved, false);
  assert.ok((await call(bob, "fonts")).some(item => item.id === publication.id));
  const archive = Buffer.from("PencilKit fixture - opaque bytes");
  const source = { drawing: `data:application/x-pencilkit;base64,${archive.toString("base64")}`, worksheetId: randomUUID(), configuration: { version: 3 }, renderScale: 3, cells: [] };
  const native = { ...data, schemaVersion: 2, samples: data.samples.slice(0, 1).map(sample => ({ ...sample, source: { ...sample.source, kind: "pencilkit", crossesCellBoundary: true, sha256: createHash("sha256").update(archive).digest("hex") } })) };
  const nativeResult = await call(alice, "datasets", "POST", { dataset: native, source });
  assert.deepEqual(await call(alice, `datasets/${nativeResult.id}/source`), source);
  assert.equal((await call(alice, `datasets/${nativeResult.id}`)).dataset.samples[0].source.crossesCellBoundary, true);
  await call(alice, "datasets", "POST", { dataset: native, source: { ...source, drawing: source.drawing + "AA" } }, 400);
  const stored = (await pool.query("SELECT candidates,source FROM handwriting_datasets WHERE id=$1", [nativeResult.id])).rows[0];
  assert.ok(!JSON.stringify(stored).includes("base64,"), "Images and original strokes must be bytea, not JSON Base64");
  console.log("PASS: account isolation, dev role, idempotent native/PDF upload, binary storage, concurrent review, persistent analysis, partial failures, publication and immutable font versions.");
} finally {
  const ids = accounts.map(account => account.id);
  if (ids.length) {
    await pool.query("DELETE FROM handwriting_publications WHERE published_by=ANY($1::text[]) OR dataset_id IN (SELECT id FROM handwriting_datasets WHERE owner_id=ANY($1::text[]))", [ids]);
    await pool.query("DELETE FROM handwriting_datasets WHERE owner_id=ANY($1::text[])", [ids]);
    await pool.query("DELETE FROM users WHERE id=ANY($1::text[])", [ids]);
  }
  await pool.end();
}
