import { useEffect, useRef, useState } from "react";
import { EXPENSE_CATEGORIES, type ExpenseCategoryCode } from "@/lib/expenses/categories";
import { isRecord } from "@/lib/expenses/contracts";
import {
  isCheckCorrectionInput,
  isCorrectionInput,
  isCorrectionRule,
  isCorrectionState,
  type CorrectableExpense,
  type CorrectionRule,
  type CorrectionState,
} from "@/lib/expenses/corrections";

interface Props {
  expense: CorrectableExpense;
  mutationPending: boolean;
  beginMutation: () => boolean;
  endMutation: () => void;
  onRefresh: () => void;
  onClose: () => void;
}

const label = (code: ExpenseCategoryCode) => EXPENSE_CATEGORIES.find((entry) => entry.code === code)?.label ?? code;

async function readStateResponse(response: Response): Promise<unknown> {
  try {
    return JSON.parse(await response.text()) as unknown;
  } catch {
    return null;
  }
}

export default function ExpenseCategoryEditor({
  expense,
  mutationPending,
  beginMutation,
  endMutation,
  onRefresh,
  onClose,
}: Props) {
  const [observed, setObserved] = useState<CorrectionState | null>(null);
  const [category, setCategory] = useState<ExpenseCategoryCode>(expense.category_code);
  const [learn, setLearn] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [collision, setCollision] = useState<CorrectionRule | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [checked, setChecked] = useState<CorrectionState | null>(null);
  const [checkedKeyword, setCheckedKeyword] = useState<string | null>(null);
  const requestPending = useRef(false);
  const categoryInput = useRef<HTMLSelectElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const endpoint = `/api/expenses/${expense.id}/category`;

  useEffect(() => {
    const controller = new AbortController();
    heading.current?.focus();
    void (async () => {
      try {
        const response = await fetch(endpoint, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await readStateResponse(response);
        if (!response.ok || !isCorrectionState(body) || body.expense.id !== expense.id) {
          throw new Error("Current expense could not be loaded. Check current state to try again.");
        }
        if (controller.signal.aborted) return;
        setObserved(body);
        setCategory(body.expense.category_code);
        setLoading(false);
      } catch (failure) {
        if (controller.signal.aborted) return;
        setError(failure instanceof Error ? failure.message : "Current expense could not be loaded.");
        setLoading(false);
        setBlocked(true);
        setRecovery(true);
      }
    })();
    return () => {
      controller.abort();
    };
  }, [endpoint, expense.id]);

  useEffect(() => {
    if (!loading) categoryInput.current?.focus();
  }, [loading]);

  const locked = loading || busy || mutationPending;
  const validKeyword = isCheckCorrectionInput({ keyword });
  const input = observed
    ? {
        category_code: category,
        expected_revision: observed.expense.correction_revision,
        ...(learn ? { learn_rule: true, keyword } : { learn_rule: false }),
      }
    : null;
  const needsRuleCheck = recovery && learn && (!validKeyword || checkedKeyword !== keyword);
  const canSave = !locked && !blocked && observed !== null && isCorrectionInput(input) && !needsRuleCheck;

  function changeDraft() {
    setCollision(null);
    setError(null);
    setStatus(null);
  }

  async function checkCurrent() {
    if (requestPending.current || loading || !beginMutation()) return;
    requestPending.current = true;
    setBusy(true);
    setError(null);
    setStatus(null);
    setCollision(null);
    setBlocked(true);
    setRecovery(true);
    setChecked(null);
    setCheckedKeyword(null);
    try {
      const includeKeyword = learn && validKeyword;
      const response = await fetch(`${endpoint}/check`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(includeKeyword ? { keyword } : {}),
      });
      const body = await readStateResponse(response);
      if (!response.ok || !isCorrectionState(body) || body.expense.id !== expense.id) {
        throw new Error(
          isRecord(body) && typeof body.error === "string" ? body.error : "Current state could not be checked.",
        );
      }
      setChecked(body);
      setCheckedKeyword(includeKeyword ? keyword : null);
      setStatus("Current persisted state checked. Review it below before using its revision for another decision.");
      onRefresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Current state could not be checked.");
    } finally {
      requestPending.current = false;
      setBusy(false);
      endMutation();
    }
  }

  async function mutate(reset: boolean, confirm = false) {
    if (requestPending.current || locked || blocked || !observed) return;
    if (!reset && !canSave) return;
    if (reset && observed.expense.manual_category_code === null) return;
    if (confirm && !collision) return;
    if (!beginMutation()) return;
    requestPending.current = true;
    setBusy(true);
    setError(null);
    setStatus(null);
    const payload = reset
      ? { expected_revision: observed.expense.correction_revision }
      : {
          ...input,
          ...(confirm && collision ? { rule_confirmation: { id: collision.id, revision: collision.revision } } : {}),
        };
    setCollision(null);
    try {
      const response = await fetch(reset ? `${endpoint}/reset` : endpoint, {
        method: reset ? "POST" : "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await readStateResponse(response);
      if (response.status >= 500) throw new Error("The result is unknown. Check current state before another write.");
      if (!response.ok) {
        if (response.status === 409) {
          if (isRecord(body) && body.code === "rule_confirmation_required" && isCorrectionRule(body.rule)) {
            setCollision(body.rule);
            return;
          }
          setBlocked(true);
          setRecovery(true);
          setChecked(null);
          setCheckedKeyword(null);
          setError("The expense or rule changed. Check current state and explicitly review it before saving again.");
          return;
        }
        setError(
          isRecord(body) && typeof body.error === "string"
            ? body.error
            : "The category request was rejected. Review your input before trying again.",
        );
        return;
      }
      if (!isCorrectionState(body) || body.expense.id !== expense.id) {
        throw new Error("The response could not be read. The result is unknown; check current state.");
      }
      setObserved(body);
      setChecked(null);
      setCheckedKeyword(null);
      setRecovery(false);
      setStatus(
        reset
          ? "Automatic assignment restored. Rules were retained, so the category may stay the same. Each dashboard resource has its own refresh status."
          : "Category correction saved. Each dashboard resource has its own refresh status.",
      );
      onRefresh();
    } catch {
      setBlocked(true);
      setRecovery(true);
      setChecked(null);
      setCheckedKeyword(null);
      setError(
        "The write result is unknown. Check current state before another write. No write will be retried automatically.",
      );
    } finally {
      requestPending.current = false;
      setBusy(false);
      endMutation();
    }
  }

  const displayed = observed?.expense ?? expense;
  return (
    <section
      aria-labelledby="expense-editor-heading"
      aria-busy={loading || busy}
      className="my-3 rounded-xl border border-blue-200/30 bg-blue-950/40 p-4 sm:p-5"
    >
      <h3
        ref={heading}
        id="expense-editor-heading"
        tabIndex={-1}
        className="font-semibold focus-visible:outline-2 focus-visible:outline-white"
      >
        Correct expense category
      </h3>
      <p className="mt-2 break-words">{displayed.title}</p>
      <p className="mt-1 text-sm text-blue-100/80">
        {displayed.transaction_date} · {Number(displayed.amount).toFixed(2)} {displayed.currency} ·{" "}
        {displayed.manual_category_code === null ? "Automatic assignment" : "Manual correction"}
      </p>
      {loading && (
        <p role="status" className="mt-3 text-sm">
          Loading current expense…
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void mutate(false);
        }}
        className="mt-4 space-y-4"
      >
        <div>
          <label htmlFor="correction-category" className="mb-2 block text-sm font-medium text-blue-100">
            Draft category
          </label>
          <select
            ref={categoryInput}
            id="correction-category"
            className="expense-rule-input"
            value={category}
            disabled={locked}
            onChange={(event) => {
              changeDraft();
              setCategory(event.currentTarget.value as ExpenseCategoryCode);
            }}
          >
            {EXPENSE_CATEGORIES.map((entry) => (
              <option key={entry.code} value={entry.code} className="bg-blue-950 text-white">
                {entry.label}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-start gap-2 text-sm text-blue-100">
          <input
            type="checkbox"
            checked={learn}
            disabled={locked}
            onChange={(event) => {
              changeDraft();
              setLearn(event.currentTarget.checked);
            }}
            className="mt-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          />
          Remember a keyword rule for automatic assignments
        </label>
        {learn && (
          <div>
            <label htmlFor="correction-keyword" className="mb-2 block text-sm font-medium text-blue-100">
              Keyword phrase from this title
            </label>
            <input
              id="correction-keyword"
              value={keyword}
              disabled={locked}
              aria-describedby="correction-help"
              className="expense-rule-input"
              onChange={(event) => {
                changeDraft();
                setKeyword(event.currentTarget.value);
              }}
            />
            <p id="correction-help" className="mt-2 text-sm text-blue-100/70">
              Enter a nonblank literal title fragment, at most 1,024 UTF-8 bytes. Matching ignores case and collapses
              whitespace; accents matter. Rules affect earlier and future automatic assignments. Manual corrections take
              precedence. The longest phrase wins; equal longest phrases in different categories produce Other.
            </p>
          </div>
        )}
        <p className="text-sm text-blue-100/70">
          Correcting an earlier month may leave this month’s chart unchanged. Learning can still change this month’s
          automatic totals. Restore automatic retains all rules and may keep the same category.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={!canSave || collision !== null} className="expense-primary-button">
            {busy ? "Working…" : "Save category"}
          </button>
          <button
            type="button"
            disabled={busy || mutationPending}
            onClick={onClose}
            className="expense-secondary-button"
          >
            Cancel / discard draft
          </button>
          {observed?.expense.manual_category_code !== null && observed && (
            <button
              type="button"
              disabled={locked || blocked}
              onClick={() => void mutate(true)}
              className="expense-secondary-button"
            >
              Restore automatic
            </button>
          )}
        </div>
      </form>
      {collision && (
        <div role="alert" className="mt-4 rounded-lg border border-amber-200/40 p-3 text-sm text-amber-100">
          <p className="break-words">
            Rule “{collision.keyword}” currently assigns {label(collision.category_code)}. Your draft requests{" "}
            {label(category)}. Replacing it changes earlier and future automatic assignments; manual corrections remain
            protected. Longest-phrase and tie behavior still apply.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!canSave}
              onClick={() => void mutate(false, true)}
              className="expense-primary-button"
            >
              Confirm replacement
            </button>
            <button
              type="button"
              disabled={locked}
              onClick={() => {
                setCollision(null);
                categoryInput.current?.focus();
              }}
              className="expense-secondary-button"
            >
              Back
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-red-300/40 bg-red-950/40 p-3 text-sm text-red-100">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="mt-4 text-sm text-emerald-100">
          {status}
        </p>
      )}
      {recovery && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-blue-100/80">
            Your draft is retained. Checking reports what is persisted now; matching categories do not prove which
            request committed.{" "}
            {learn && !validKeyword
              ? "This invalid phrase stays editable. The next check reads the expense only; fix the phrase and check again before saving with learning."
              : needsRuleCheck
                ? "Check the current draft phrase before saving with learning."
                : ""}
          </p>
          <button
            type="button"
            disabled={locked}
            onClick={() => void checkCurrent()}
            className="expense-secondary-button"
          >
            Check current state
          </button>
          {checked && (
            <div className="rounded-lg border border-white/20 p-3 text-sm">
              <h4 className="font-semibold">Current persisted values (separate from your draft)</h4>
              <p className="mt-2">
                Category: {label(checked.expense.category_code)} ·{" "}
                {checked.expense.manual_category_code === null ? "Automatic" : "Manual"} · revision{" "}
                {checked.expense.correction_revision}
              </p>
              <p className="mt-2 break-words">
                {checkedKeyword !== null
                  ? checked.rule
                    ? `Rule “${checked.rule.keyword}”: ${label(checked.rule.category_code)} (revision ${checked.rule.revision})`
                    : "No exact matching rule exists for the checked phrase."
                  : "Draft rule was not checked."}
              </p>
              {blocked && (
                <button
                  type="button"
                  disabled={locked}
                  className="expense-secondary-button mt-3"
                  onClick={() => {
                    setObserved(checked);
                    setBlocked(false);
                    setCollision(null);
                    setError(null);
                    setStatus(
                      "Current revision accepted after review. Your draft is unchanged; choose Save to submit a new decision.",
                    );
                    categoryInput.current?.focus();
                  }}
                >
                  I reviewed current state — use this revision
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
