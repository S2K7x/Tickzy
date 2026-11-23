import { describe, expect, it } from "vitest";
import { isEmptySearch, parseSearch } from "./search.ts";

const f = (over: Partial<Record<string, string[]>> = {}) => ({ from: [], account: [], status: [], is: [], channel: [], priority: [], ...over });

describe("search query parser (FR-3.8)", () => {
  it("plain text and phrases go to full text", () => {
    expect(parseSearch("webhook timeout")).toEqual({ text: "webhook timeout", filters: f() });
    expect(parseSearch('"signature mismatch" stripe')).toEqual({ text: '"signature mismatch" stripe', filters: f() });
    expect(parseSearch("export -csv")).toEqual({ text: "export -csv", filters: f() });
  });

  it("extracts operators, including quoted values, case-insensitively", () => {
    expect(parseSearch('from:hank@globex.com account:"Globex Corp" status:Resolved channel:EMAIL priority:high is:mine refund'))
      .toEqual({ text: "refund", filters: f({ from: ["hank@globex.com"], account: ["Globex Corp"], status: ["resolved"], channel: ["email"], priority: ["high"], is: ["mine"] }) });
  });

  it("normalises status spellings; status:open means is:open", () => {
    expect(parseSearch("status:waiting-on-us status:open").filters).toEqual(f({ status: ["waiting_on_us"], is: ["open"] }));
  });

  it("keeps unknown operators and invalid values as text (nothing typed is lost)", () => {
    expect(parseSearch("http://example.com label:billing status:nope")).toEqual({ text: "http://example.com label:billing status:nope", filters: f() });
  });

  it("dedupes, ignores empty values, tolerates an unterminated quote", () => {
    expect(parseSearch("channel:slack channel:slack account: ")).toEqual({ text: "", filters: f({ channel: ["slack"] }) });
    expect(parseSearch('account:"Glob').filters.account).toEqual(["Glob"]);
    expect(isEmptySearch(parseSearch("   "))).toBe(true);
    expect(isEmptySearch(parseSearch("is:open"))).toBe(false);
  });
});
