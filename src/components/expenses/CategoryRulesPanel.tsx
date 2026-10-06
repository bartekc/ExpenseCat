import React, { useEffect, useRef, useState } from "react";
import { EXPENSE_CATEGORIES, type ExpenseCategoryCode } from "@/lib/expenses/categories";
import { isRecord } from "@/lib/expenses/contracts";
import { isCategoryRule, isCategoryRuleInput, type CategoryRule, type CategoryRulePage } from "@/lib/expenses/rules";

interface Props {
  rulePage: CategoryRulePage | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onPage: (page: number) => void;
  onSaved: (deleted: boolean) => void;
}

export default function CategoryRulesPanel({ rulePage, loading, error, onRetry, onPage, onSaved }: Props) {
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState<ExpenseCategoryCode>("groceries");
  const [editing, setEditing] = useState<CategoryRule | null>(null);
  const [deleting, setDeleting] = useState<CategoryRule | null>(null);
  const [pending, setPending] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const keywordInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => mutation.current?.abort(), []);
  useEffect(() => {
    if (status && !pending) keywordInput.current?.focus();
  }, [status, pending]);

  function resetForm() {
    setKeyword("");
    setCategory("groceries");
    setEditing(null);
  }

  async function saveRule(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.current) return;
    setMutationError(null);
    setStatus(null);
    const input = { keyword, category_code: category };
    if (!isCategoryRuleInput(input)) {
      setMutationError("Enter a nonblank keyword of at most 1,024 UTF-8 bytes and choose a category.");
      return;
    }
    await mutate(editing ? "PATCH" : "POST", editing?.id, input);
  }

  async function mutate(method: "POST" | "PATCH" | "DELETE", id?: string, input?: object) {
    if (mutation.current) return;
    const controller = new AbortController();
    mutation.current = controller;
    setPending(true);
    setMutationError(null);
    setStatus(null);
    try {
      const response = await fetch(id ? `/api/category-rules/${id}` : "/api/category-rules", {
        method,
        credentials: "same-origin",
        signal: controller.signal,
        ...(input ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) } : {}),
      });
      const text = await response.text();
      let body: unknown = null;
      try {
        body = text ? (JSON.parse(text) as unknown) : null;
      } catch {
        // The fallback error also handles a non-JSON service response.
      }
      if (!response.ok) {
        throw new Error(
          response.status === 409
            ? "A rule with this keyword already exists. Edit the existing rule instead."
            : isRecord(body) && typeof body.error === "string"
              ? body.error
              : "The rule could not be saved. Please try again.",
        );
      }
      if (method === "DELETE" ? response.status !== 204 : !isCategoryRule(body)) {
        throw new Error("The rule response could not be read. Retry the saved-rule list to check its state.");
      }
      if (controller.signal.aborted) return;
      if (method !== "DELETE" || editing?.id === id) resetForm();
      setDeleting(null);
      setStatus(
        `${method === "DELETE" ? "Rule deleted" : method === "PATCH" ? "Rule updated" : "Rule added"}. Current rules apply to all saved expenses. The expense list and monthly summary have their own refresh status.`,
      );
      onSaved(method === "DELETE");
    } catch (failure) {
      if (!controller.signal.aborted)
        setMutationError(failure instanceof Error ? failure.message : "The rule could not be saved. Please try again.");
    } finally {
      if (!controller.signal.aborted) setPending(false);
      if (mutation.current === controller) mutation.current = null;
    }
  }

  return (
    <section
      aria-labelledby="category-rules-heading"
      className="rounded-2xl border border-white/10 bg-white/10 p-5 backdrop-blur-xl sm:p-6"
    >
      <h2 id="category-rules-heading" className="text-xl font-semibold">
        Category rules
      </h2>
      <p id="category-rules-help" className="mt-2 text-sm text-blue-100/70">
        Add your own keyword phrases; no merchant rules are preloaded. Matching uses a case-insensitive literal
        substring with collapsed whitespace; accents matter. The longest matching phrase wins. Changes affect automatic
        assignments across all saved expenses, including earlier dates.
      </p>
      <form onSubmit={(event) => void saveRule(event)} className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor="rule-keyword" className="mb-2 block text-sm font-medium text-blue-100">
            Keyword phrase
          </label>
          <input
            ref={keywordInput}
            id="rule-keyword"
            name="keyword"
            value={keyword}
            onChange={(event) => {
              setKeyword(event.currentTarget.value);
            }}
            disabled={pending}
            required
            aria-describedby="category-rules-help"
            className="expense-rule-input"
          />
        </div>
        <div>
          <label htmlFor="rule-category" className="mb-2 block text-sm font-medium text-blue-100">
            Category
          </label>
          <select
            id="rule-category"
            name="category_code"
            value={category}
            onChange={(event) => {
              setCategory(event.currentTarget.value as ExpenseCategoryCode);
            }}
            disabled={pending}
            className="expense-rule-input"
          >
            {EXPENSE_CATEGORIES.map((entry) => (
              <option key={entry.code} value={entry.code} className="bg-blue-950 text-white">
                {entry.label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={pending} className="expense-primary-button">
          {pending ? "Saving…" : editing ? "Save rule" : "Add rule"}
        </button>
        {editing && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              resetForm();
              setMutationError(null);
            }}
            className="expense-secondary-button"
          >
            Cancel edit
          </button>
        )}
      </form>
      {editing && <p className="mt-3 text-sm text-blue-100/80">Editing rule: {editing.keyword}</p>}
      {status && (
        <p role="status" className="mt-4 text-sm text-emerald-100">
          {status}
        </p>
      )}
      {mutationError && (
        <p role="alert" className="mt-4 rounded-lg border border-red-300/40 bg-red-950/40 p-3 text-sm text-red-100">
          {mutationError}
        </p>
      )}
      <div aria-busy={loading}>
        {loading && (
          <p role="status" className="mt-5 text-sm text-blue-100/80">
            Loading category rules…
          </p>
        )}
        {!loading && error && (
          <div className="mt-5">
            <p role="alert" className="rounded-lg border border-red-300/40 bg-red-950/40 p-3 text-sm text-red-100">
              {error}
            </p>
            <button type="button" onClick={onRetry} disabled={pending} className="expense-secondary-button mt-3">
              Retry category rules
            </button>
          </div>
        )}
        {!loading && !error && rulePage && (
          <>
            <p className="mt-5 text-sm text-blue-100/80">{rulePage.total} saved rules</p>
            {rulePage.total === 0 && (
              <p className="mt-2 text-sm text-blue-100/70">
                No rules yet. Unmatched expenses use Other and need review.
              </p>
            )}
            <ul className="mt-3 divide-y divide-white/10">
              {rulePage.rules.map((rule) => (
                <li key={rule.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium break-words">{rule.keyword}</p>
                      <p className="text-sm text-blue-100/70">
                        {EXPENSE_CATEGORIES.find((entry) => entry.code === rule.category_code)?.label}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={pending}
                        aria-label={`Edit rule ${rule.keyword}`}
                        onClick={() => {
                          setEditing(rule);
                          setKeyword(rule.keyword);
                          setCategory(rule.category_code);
                          setDeleting(null);
                          setMutationError(null);
                          setStatus(null);
                          keywordInput.current?.focus();
                        }}
                        className="expense-secondary-button"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        aria-label={`Delete rule ${rule.keyword}`}
                        onClick={() => {
                          setDeleting(rule);
                          setMutationError(null);
                          setStatus(null);
                        }}
                        className="expense-secondary-button"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  {deleting?.id === rule.id && (
                    <div className="mt-3 rounded-lg border border-red-300/40 p-3">
                      <p className="text-sm text-red-100">
                        Delete “{rule.keyword}”? Its automatic assignments will be recalculated across all saved
                        expenses.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => void mutate("DELETE", rule.id)}
                          className="expense-secondary-button"
                        >
                          Confirm delete
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => {
                            setDeleting(null);
                          }}
                          className="expense-secondary-button"
                        >
                          Cancel delete
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {rulePage.page > 1 || rulePage.totalPages > 1 ? (
              <nav
                aria-label="Category rule pages"
                className="mt-5 flex items-center justify-between gap-3 border-t border-white/10 pt-5"
              >
                <button
                  type="button"
                  disabled={pending || rulePage.page <= 1}
                  onClick={() => {
                    onPage(rulePage.page - 1);
                  }}
                  className="expense-secondary-button"
                >
                  Previous
                </button>
                <span className="text-center text-sm text-blue-100/80">
                  Page {rulePage.page} of {Math.max(1, rulePage.totalPages)}
                </span>
                <button
                  type="button"
                  disabled={pending || rulePage.page >= rulePage.totalPages}
                  onClick={() => {
                    onPage(rulePage.page + 1);
                  }}
                  className="expense-secondary-button"
                >
                  Next
                </button>
              </nav>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
