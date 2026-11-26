import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auth, setupTestApp } from "../test-helpers.ts";

/** Error envelope mapping for framework errors (found with T-301: oversized bodies used to answer 500). */
let t: Awaited<ReturnType<typeof setupTestApp>>;
let alice: string;
beforeAll(async () => { t = await setupTestApp(); alice = await t.createUser("alice@example.com"); });
afterAll(async () => { await t.teardown(); });

describe("framework errors use the API envelope", () => {
  it("a body over the limit is 413 payload_too_large, not 500", async () => {
    const res = await t.app.inject({ method: "POST", url: "/v1/workspaces", headers: { ...auth(alice), "content-type": "application/json" }, payload: JSON.stringify({ name: "x".repeat(1_100_000) }) });
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toMatchObject({ code: "payload_too_large" });
  });

  it("malformed JSON is 422 validation_failed", async () => {
    const res = await t.app.inject({ method: "POST", url: "/v1/workspaces", headers: { ...auth(alice), "content-type": "application/json" }, payload: "{oops" });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("validation_failed");
  });
});
