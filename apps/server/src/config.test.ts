import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";

describe("config", () => {
  const base = { DATABASE_URL: "postgres://u:p@localhost:5432/db" };
  it("applies defaults", () => {
    const c = loadConfig(base);
    expect(c.PORT).toBe(3000);
    expect(c.AUTH_DEV_MODE).toBe(false);
  });
  it("refuses dev auth in production", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production", AUTH_DEV_MODE: "true" })).toThrow(/AUTH_DEV_MODE/);
  });
  it("requires a database url", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });
});
