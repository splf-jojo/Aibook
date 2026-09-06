import test from "node:test";
import assert from "node:assert/strict";
import { checkDevTransport } from "../lib/handwriting-access.server.ts";
import { readJson } from "../lib/handwriting-http.server.ts";
test("dev transport supports production hosts and rejects cross-origin cookie writes", () => {
  const enabled = process.env.HANDWRITING_REVIEW_ENABLED;
  const nodeEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production"; process.env.HANDWRITING_REVIEW_ENABLED = "0";
    const request = (host, method = "GET", origin) => new Request("http://localhost/dev/datasets", { method,
      headers: { host, "content-type": "application/json", ...(origin ? { origin } : {}) } });
    assert.equal(checkDevTransport(request("localhost")).status, 404);
    process.env.HANDWRITING_REVIEW_ENABLED = "1";
    assert.equal(checkDevTransport(request("example.com")), null);
    assert.equal(checkDevTransport(request("localhost")), null);
    assert.equal(checkDevTransport(request("localhost", "POST", "https://example.com")).status, 403);
    assert.equal(checkDevTransport(request("localhost", "POST", "http://localhost")), null);
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
