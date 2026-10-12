import { isExpenseCategoryCode, type ExpenseCategoryCode } from "./categories";
import { isExpense, isExpensePage, isRecord, isUuid, type Expense, type ExpensePage } from "./contracts";
import { isCategoryRule, isCategoryRuleInput, MAX_RULE_BODY_BYTES, type CategoryRule } from "./rules";

export interface CorrectableExpense extends Expense {
  manual_category_code: ExpenseCategoryCode | null;
  correction_revision: string;
}
export interface CorrectableExpensePage extends ExpensePage {
  expenses: CorrectableExpense[];
}
export interface CorrectionRule extends CategoryRule {
  revision: string;
}
export interface CorrectionState {
  expense: CorrectableExpense;
  rule: CorrectionRule | null;
}
export interface RuleConfirmation {
  id: string;
  revision: string;
}
export type CorrectionInput = {
  category_code: ExpenseCategoryCode;
  expected_revision: string;
} & (
  | { learn_rule: true; keyword: string; rule_confirmation?: RuleConfirmation }
  | { learn_rule: false; keyword?: never; rule_confirmation?: never }
);
export interface ResetCorrectionInput {
  expected_revision: string;
}
export interface CheckCorrectionInput {
  keyword?: string;
}
export type CorrectionConflictCode = "expense_conflict" | "rule_confirmation_required" | "rule_conflict";
export type CorrectionConflict =
  | { error: string; code: "expense_conflict" }
  | { error: string; code: "rule_confirmation_required"; rule: CorrectionRule }
  | { error: string; code: "rule_conflict"; rule: CorrectionRule | null };

function hasOnlyKeys(value: object, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

export function isCorrectionRevision(value: unknown, positive = false): value is string {
  return (
    typeof value === "string" &&
    /^(0|[1-9][0-9]{0,18})$/.exec(value)?.[0] === value &&
    (!positive || value !== "0") &&
    (value.length < 19 || value <= "9223372036854775807")
  );
}

export function isCorrectableExpense(value: unknown): value is CorrectableExpense {
  return (
    isExpense(value) &&
    isRecord(value) &&
    value.id.length === 36 &&
    (value.manual_category_code === null || isExpenseCategoryCode(value.manual_category_code)) &&
    isCorrectionRevision(value.correction_revision) &&
    (value.manual_category_code === null ||
      (value.manual_category_code === value.category_code &&
        !value.needs_review &&
        value.review_reason === null &&
        value.correction_revision !== "0"))
  );
}

export function isCorrectableExpensePage(value: unknown): value is CorrectableExpensePage {
  return isExpensePage(value) && value.expenses.every(isCorrectableExpense);
}

export function isCorrectionRule(value: unknown): value is CorrectionRule {
  return (
    isRecord(value) &&
    Object.keys(value).length === 4 &&
    hasOnlyKeys(value, ["id", "keyword", "category_code", "revision"]) &&
    isCategoryRule({ id: value.id, keyword: value.keyword, category_code: value.category_code }) &&
    typeof value.id === "string" &&
    value.id.length === 36 &&
    isKeyword(value.keyword) &&
    isCorrectionRevision(value.revision, true)
  );
}

export function isCorrectionState(value: unknown): value is CorrectionState {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    hasOnlyKeys(value, ["expense", "rule"]) &&
    isCorrectableExpense(value.expense) &&
    // RPC payloads must not expose private view columns or unexpected data.
    Object.keys(value.expense).length === 10 &&
    hasOnlyKeys(value.expense, [
      "id",
      "transaction_date",
      "amount",
      "title",
      "currency",
      "category_code",
      "needs_review",
      "review_reason",
      "manual_category_code",
      "correction_revision",
    ]) &&
    (value.rule === null || isCorrectionRule(value.rule))
  );
}

function isKeyword(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value) &&
    isCategoryRuleInput({ keyword: value, category_code: "other" })
  );
}

export function isCorrectionInput(value: unknown): value is CorrectionInput {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["category_code", "expected_revision", "learn_rule", "keyword", "rule_confirmation"]) ||
    !isExpenseCategoryCode(value.category_code) ||
    !isCorrectionRevision(value.expected_revision)
  )
    return false;
  if (value.learn_rule === false) return !("keyword" in value) && !("rule_confirmation" in value);
  if (value.learn_rule !== true || !isKeyword(value.keyword)) return false;
  if (!("rule_confirmation" in value)) return true;
  const confirmation = value.rule_confirmation;
  return (
    isRecord(confirmation) &&
    Object.keys(confirmation).length === 2 &&
    hasOnlyKeys(confirmation, ["id", "revision"]) &&
    isUuid(confirmation.id) &&
    confirmation.id.length === 36 &&
    isCorrectionRevision(confirmation.revision, true)
  );
}

export function isResetCorrectionInput(value: unknown): value is ResetCorrectionInput {
  return isRecord(value) && Object.keys(value).length === 1 && isCorrectionRevision(value.expected_revision);
}

export function isCheckCorrectionInput(value: unknown): value is CheckCorrectionInput {
  return isRecord(value) && hasOnlyKeys(value, ["keyword"]) && (!("keyword" in value) || isKeyword(value.keyword));
}

export type CorrectionBodyResult<T> = { input: T } | { error: string; status: number };

export async function readCorrectionBody<T>(
  request: Request,
  validate: (value: unknown) => value is T,
): Promise<CorrectionBodyResult<T>> {
  const reader = request.body?.getReader();
  if (!reader) return { error: "Provide a JSON body", status: 400 };
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RULE_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { error: "Correction request exceeds 16 KiB", status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    return { error: "Invalid JSON body", status: 400 };
  } finally {
    reader.releaseLock();
  }
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
    if (!validate(value)) return { error: "Invalid correction input", status: 400 };
    return { input: value };
  } catch {
    return { error: "Invalid JSON body", status: 400 };
  }
}

export function correctionDatabaseError(error: { code: string; message: string; details: string }): {
  body: { error: string } | CorrectionConflict;
  status: number;
} {
  if (error.code === "42501" && error.message === "Authentication required") {
    return { body: { error: "Authentication required" }, status: 401 };
  }
  if (error.code === "22023") return { body: { error: "Invalid correction input" }, status: 400 };
  if (error.code === "P0002" && error.message === "expense_not_found") {
    return { body: { error: "Expense not found" }, status: 404 };
  }
  if (error.code === "P0001") {
    if (error.message === "expense_conflict") {
      return {
        body: { error: "Expense changed. Check current state before saving again.", code: "expense_conflict" },
        status: 409,
      };
    }
    if (error.message === "rule_confirmation_required" || error.message === "rule_conflict") {
      try {
        const details: unknown = JSON.parse(error.details);
        if (isRecord(details) && Object.keys(details).length === 1 && "rule" in details) {
          if (error.message === "rule_confirmation_required" && isCorrectionRule(details.rule)) {
            return {
              body: {
                error: "Confirm replacement of the existing rule",
                code: "rule_confirmation_required",
                rule: details.rule,
              },
              status: 409,
            };
          }
          if (error.message === "rule_conflict" && (details.rule === null || isCorrectionRule(details.rule))) {
            return {
              body: {
                error: "Rule changed. Check current state before saving again.",
                code: "rule_conflict",
                rule: details.rule,
              },
              status: 409,
            };
          }
        }
      } catch {
        /* Malformed database details must not become trusted conflicts. */
      }
    }
  }
  return { body: { error: "Expense category request failed" }, status: 500 };
}
