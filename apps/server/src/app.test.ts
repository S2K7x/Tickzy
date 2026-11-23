import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestApp } from "./test-helpers.ts";

let t: Awaited<ReturnType<typeof setupTestApp>>;
beforeAll(async () => { t = await setupTestApp(); });
afterAll(async () => { await t.teardown(); });

describe("http foundation", () => {
  it("serves liveness and readiness", async () => {
    expect((await t.app.inject({ url: "/healthz" })).json()).toEqual({ status: "ok" });
    expect((await t.app.inject({ url: "/readyz" })).json()).toEqual({ status: "ready" });
  });

  it("returns the error envelope for unknown routes with a request id", async () => {
    const res = await t.app.inject({ url: "/v1/nope" });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe("not_found");
    expect(body.error.request_id).toMatch(/^req_/);
    expect(res.headers["x-request-id"]).toBe(body.error.request_id);
  });

  it("returns 401 envelope when unauthenticated", async () => {
    const res = await t.app.inject({ method: "POST", url: "/v1/workspaces", payload: { name: "A", slug: "acme", issue_prefix: "AC" } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("unauthenticated");
  });

  it("returns 422 envelope with details on validation errors", async () => {
    const user = await t.createUser("val@example.com");
    const res = await t.app.inject({
      method: "POST", url: "/v1/workspaces", headers: { authorization: `Bearer dev_${user}` },
      payload: { name: "", slug: "Bad Slug", issue_prefix: "x" },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(["body.slug"]));
  });

  it("publishes an OpenAPI 3.1 document listing the v1 routes", async () => {
    const doc = (await t.app.inject({ url: "/v1/openapi.json" })).json();
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(["/v1/workspaces", "/v1/workspaces/current", "/v1/me/workspaces"]));
    expect(doc.paths["/healthz"]).toBeUndefined();
    // Contract (T-204): the issues API and its documented filters and sorts.
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(["/v1/issues", "/v1/issues/{ref}", "/v1/issues/{ref}/timeline", "/v1/accounts", "/v1/contacts"]));
    const listParams = (doc.paths["/v1/issues"].get.parameters as { name: string }[]).map((p) => p.name);
    expect(listParams).toEqual(expect.arrayContaining(["status", "assignee", "team", "account", "priority", "channel", "label", "q", "sort", "cursor", "limit"]));
    const sortParam = (doc.paths["/v1/issues"].get.parameters as { name: string; schema: { enum?: string[] } }[]).find((p) => p.name === "sort")!;
    expect(sortParam.schema.enum).toEqual(["updated", "newest", "oldest", "priority"]);
    expect(Object.keys(doc.paths["/v1/issues/{ref}"])).toEqual(expect.arrayContaining(["get", "patch"]));
  });
});
