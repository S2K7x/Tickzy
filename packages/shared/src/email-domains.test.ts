import { describe, expect, it } from "vitest";
import { companyDomainOf, normalizeDomain } from "./email-domains.ts";

describe("email domains (FR-4.2)", () => {
  it("normalises pasted domains and URLs", () => {
    expect(normalizeDomain(" Globex.COM ")).toBe("globex.com");
    expect(normalizeDomain("https://www.globex.com/pricing")).toBe("globex.com");
    expect(normalizeDomain("eu.app.globex.io")).toBe("eu.app.globex.io");
    for (const bad of ["globex", "-globex.com", "glo bex.com", "globex..com", ""]) expect(normalizeDomain(bad)).toBeNull();
  });
  it("only company domains identify an account", () => {
    expect(companyDomainOf("Hank@Globex.com")).toBe("globex.com");
    expect(companyDomainOf("someone@gmail.com")).toBeNull();
    expect(companyDomainOf("someone@Outlook.com")).toBeNull();
    expect(companyDomainOf("not-an-email")).toBeNull();
  });
});
