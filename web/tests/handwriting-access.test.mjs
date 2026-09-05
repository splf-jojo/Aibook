import test from "node:test";
import assert from "node:assert/strict";
import { authenticateDev, checkDevRequest, devSessionToken, DEV_SESSION_COOKIE } from "../lib/handwriting-access.server.ts";

test("dev pages and APIs require a backend-verified dev session", async (t) => {
  const originalFetch = globalThis.fetch, enabled = process.env.HANDWRITING_REVIEW_ENABLED;
  const request = (token, extra = {}) => new Request("http://localhost/dev/datasets", { headers: {
    host: "localhost", ...(token ? { cookie: `${DEV_SESSION_COOKIE}=${encodeURIComponent(token)}` } : {}), ...extra,
  } });
  process.env.HANDWRITING_REVIEW_ENABLED = "1";
  try {
    await t.test("missing or malformed cookies cannot be replaced by a client username or bearer header", async () => {
      globalThis.fetch = () => { throw new Error("Must not contact API without a token"); };
      assert.equal((await checkDevRequest(request())).status, 401);
      assert.equal((await checkDevRequest(request(undefined, { authorization: "Bearer fake", cookie: "username=dev" }))).status, 401);
      assert.equal(devSessionToken(new Headers({ cookie: `${DEV_SESSION_COOKIE}=%invalid` })), "");
      assert.equal((await authenticateDev("x\nAuthorization: forged")).status, 401);
      assert.equal((await authenticateDev("x".repeat(4097))).status, 401);
    });
    await t.test("an expired or forged token is rejected by the auth backend", async () => {
      globalThis.fetch = async () => Response.json({ detail: "Invalid credentials" }, { status: 401 });
      assert.equal((await checkDevRequest(request("forged"))).status, 401);
    });
    await t.test("a valid ordinary account does not grant dev access", async () => {
      globalThis.fetch = async () => Response.json({ id: "ordinary-id", username: "ordinary" });
      const result = await checkDevRequest(request("ordinary-token"));
      assert.equal(result.status, 403);
      assert.equal(result.headers.get("cache-control"), "no-store");
    });
    await t.test("the validated dev identity grants access without caching or following redirects", async () => {
      let calls = 0;
      globalThis.fetch = async (url, init) => {
        calls++;
        assert.equal(url.pathname, "/api/auth/me");
        assert.equal(init.headers.Authorization, "Bearer dev-test-token");
        assert.equal(init.cache, "no-store");
        assert.equal(init.redirect, "error");
        return Response.json({ id: "dev-id", username: "dev" });
      };
      assert.equal(await checkDevRequest(request("dev-test-token")), null);
      assert.equal(calls, 1);
    });
    await t.test("backend errors and malformed identities fail closed", async () => {
      for (const response of [Response.json({}, { status: 500 }), Response.json({ username: "dev" }), new Response("invalid JSON")]) {
        globalThis.fetch = async () => response;
        assert.equal((await checkDevRequest(request("dev-test-token"))).status, 503);
      }
      globalThis.fetch = async () => { throw new TypeError("Network unavailable"); };
      assert.equal((await checkDevRequest(request("dev-test-token"))).status, 503);
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (enabled === undefined) delete process.env.HANDWRITING_REVIEW_ENABLED; else process.env.HANDWRITING_REVIEW_ENABLED = enabled;
  }
});
