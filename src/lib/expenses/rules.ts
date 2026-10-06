import { EXPENSE_CATEGORIES, isExpenseCategoryCode, type ExpenseCategoryCode } from "./categories";
import { EXPENSE_PAGE_SIZE, isRecord, isSafeCount, isUuid, parsePage } from "./contracts";

export const MAX_RULE_BODY_BYTES = 16 * 1024;
export const MAX_RULE_KEYWORD_BYTES = 1024;
const whitespaceOnly = /^[\p{White_Space}\uFEFF]*$/u;

export interface CategoryRule {
  id: string;
  keyword: string;
  category_code: ExpenseCategoryCode;
}
export interface CategoryRuleInput {
  keyword: string;
  category_code: ExpenseCategoryCode;
}
export interface CategoryRulePage {
  rules: CategoryRule[];
  categories: typeof EXPENSE_CATEGORIES;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function isCategoryRuleInput(value: unknown): value is CategoryRuleInput {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    Object.keys(value).every((key) => key === "keyword" || key === "category_code") &&
    typeof value.keyword === "string" &&
    !value.keyword.includes("\u0000") &&
    !whitespaceOnly.test(value.keyword) &&
    new TextEncoder().encode(value.keyword).byteLength <= MAX_RULE_KEYWORD_BYTES &&
    isExpenseCategoryCode(value.category_code)
  );
}

export function isCategoryRule(value: unknown): value is CategoryRule {
  if (!isRecord(value) || !isUuid(value.id) || Object.keys(value).length !== 3) return false;
  return isCategoryRuleInput({ keyword: value.keyword, category_code: value.category_code });
}

export function isCategoryRulePage(value: unknown): value is CategoryRulePage {
  return (
    isRecord(value) &&
    typeof value.page === "number" &&
    parsePage(String(value.page)) !== null &&
    value.pageSize === EXPENSE_PAGE_SIZE &&
    isSafeCount(value.total) &&
    value.totalPages === Math.ceil(value.total / EXPENSE_PAGE_SIZE) &&
    Array.isArray(value.rules) &&
    value.rules.length <= EXPENSE_PAGE_SIZE &&
    value.rules.every(isCategoryRule) &&
    Array.isArray(value.categories) &&
    value.categories.length === EXPENSE_CATEGORIES.length &&
    value.categories.every(
      (category: unknown, index: number) =>
        isRecord(category) &&
        category.code === EXPENSE_CATEGORIES[index].code &&
        category.label === EXPENSE_CATEGORIES[index].label,
    )
  );
}

export type RuleBodyResult = { input: CategoryRuleInput } | { error: string; status: number };

export async function readRuleBody(request: Request): Promise<RuleBodyResult> {
  const reader = request.body?.getReader();
  if (!reader) return { error: "Provide a keyword and category", status: 400 };
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RULE_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { error: "Rule request exceeds 16 KiB", status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    return { error: "Invalid JSON body", status: 400 };
  } finally {
    reader.releaseLock();
  }
  if (size === 0) return { error: "Provide a keyword and category", status: 400 };
  if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return { error: "Expected application/json", status: 400 };
  }
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!isCategoryRuleInput(value))
      return { error: "Provide only a nonblank keyword of at most 1024 UTF-8 bytes and a known category", status: 400 };
    return { input: value };
  } catch {
    return { error: "Invalid JSON body", status: 400 };
  }
}

export function ruleDatabaseError(code: string): { error: string; status: number } {
  // PostgreSQL's generated normalized key is authoritative, including concurrent writes.
  if (code === "23505")
    return { error: "A rule with this keyword already exists. Edit the existing rule instead.", status: 409 };
  if (["23514", "23503", "22021", "22P02"].includes(code)) {
    return { error: "Invalid keyword or category", status: 400 };
  }
  return { error: "Category rule could not be saved", status: 500 };
}
