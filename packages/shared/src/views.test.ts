import { describe, expect, it } from "vitest";
import { SYSTEM_VIEWS, viewListQuery } from "./views.ts";

describe("views", () => {
  it("maps system views to list queries", () => {
    expect(viewListQuery("mine")).toEqual({ status: ["triage", "waiting_on_us", "waiting_on_customer", "blocked"], assignee: "me" });
    expect(viewListQuery("done")).toEqual({ status: ["resolved", "closed"] });
  });
  it("adds only the filters that are set; an unknown base falls back to All open", () => {
    expect(viewListQuery("on-us", { priority: "urgent,high", label: undefined, q: "sso" })).toEqual({ status: ["triage", "waiting_on_us"], priority: "urgent,high", q: "sso" });
    expect(viewListQuery("nope" as never).status).toEqual(SYSTEM_VIEWS[0].status);
  });
});
