import { describe, expect, it } from "vitest";
import { EXPENSE_CATEGORIES } from "./categories";
import {
  isCategoryRule,
  isCategoryRuleInput,
  isCategoryRulePage,
  MAX_RULE_BODY_BYTES,
  readRuleBody,
  ruleDatabaseError,
} from "./rules";

const input = { keyword: "Synthetic ŁÓDŹ", category_code: "transport" };
const rule = { id: "00000000-0000-0000-0000-000000000001", ...input };
const request = (body: string, type = "application/json") =>
  new Request("https://expense.example/api/category-rules", {
    method: "POST",
    headers: { "Content-Type": type },
    body,
  });

describe("category rule contracts", () => {
  it("accepts only keyword/category fields and never rewrites raw text", async () => {
    const raw = { ...input, keyword: "  ŁÓDŹ\u00a0\tTest  " };
    expect(isCategoryRuleInput(raw)).toBe(true);
    expect(await readRuleBody(request(JSON.stringify(raw)))).toEqual({ input: raw });
    for (const field of ["owner_id", "normalized_keyword", "created_at", "id", "extra"]) {
      expect(isCategoryRuleInput({ ...input, [field]: "value" })).toBe(false);
    }
    for (const value of [null, [], {}, { keyword: "Synthetic" }, { ...input, category_code: "custom" }])
      expect(isCategoryRuleInput(value)).toBe(false);
  });
  it("bounds UTF-8 bytes and rejects blank and NUL keywords", () => {
    expect(isCategoryRuleInput({ ...input, keyword: "ż".repeat(512) })).toBe(true);
    expect(isCategoryRuleInput({ ...input, keyword: "ż".repeat(513) })).toBe(false);
    for (const keyword of ["", " \t\r\n\u0085\u00a0\u2003\ufeff", "Synthetic\u0000", "x".repeat(1025)]) {
      expect(isCategoryRuleInput({ ...input, keyword })).toBe(false);
    }
  });
  it("checks public rule and paginated catalogue shapes", () => {
    expect(isCategoryRule(rule)).toBe(true);
    expect(isCategoryRule({ ...rule, owner_id: "owner" })).toBe(false);
    const page = { rules: [rule], categories: EXPENSE_CATEGORIES, page: 1, pageSize: 50, total: 1, totalPages: 1 };
    expect(isCategoryRulePage(page)).toBe(true);
    for (const patch of [
      { categories: EXPENSE_CATEGORIES.slice(1) },
      { total: Number.MAX_SAFE_INTEGER + 1 },
      { totalPages: 0 },
      { page: 0 },
    ]) {
      expect(isCategoryRulePage({ ...page, ...patch })).toBe(false);
    }
  });
  it("rejects invalid/empty JSON and non-JSON bodies", async () => {
    for (const body of ["", "{", "null", "[]", JSON.stringify({ ...input, owner_id: "owner" })]) {
      expect(await readRuleBody(request(body))).toMatchObject({ status: 400 });
    }
    expect(await readRuleBody(request(JSON.stringify(input), "text/plain"))).toMatchObject({ status: 400 });
    expect(await readRuleBody(request(JSON.stringify(input), "Application/JSON; charset=utf-8"))).toEqual({ input });
  });
  it("limits bytes before parsing, including streamed bodies without a length header", async () => {
    const body = JSON.stringify(input);
    const exact = body + " ".repeat(MAX_RULE_BODY_BYTES - new TextEncoder().encode(body).byteLength);
    expect(await readRuleBody(request(exact))).toEqual({ input });
    expect(await readRuleBody(request(exact + " "))).toMatchObject({ status: 413 });
    let pulls = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(8193));
      },
      cancel() {
        cancelled = true;
      },
    });
    const streamed = new Request("https://expense.example", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect(await readRuleBody(streamed)).toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThanOrEqual(3);
  });
  it("rejects malformed UTF-8 before JSON parsing", async () => {
    const invalid = new Request("https://expense.example", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: new Uint8Array([0xff]),
    });
    expect(await readRuleBody(invalid)).toMatchObject({ status: 400 });
  });
  it("uses database constraints for normalized expansion and duplicate races", () => {
    expect(isCategoryRuleInput({ ...input, keyword: "Ⱥ".repeat(512) })).toBe(true);
    expect(ruleDatabaseError("23514").status).toBe(400);
    expect(ruleDatabaseError("23505")).toEqual({
      status: 409,
      error: "A rule with this keyword already exists. Edit the existing rule instead.",
    });
    expect(ruleDatabaseError("unknown")).toEqual({ status: 500, error: "Category rule could not be saved" });
  });
});
