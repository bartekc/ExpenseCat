import React, { useEffect, useState } from "react";

interface InvalidRow {
  row: number;
  reason: string;
}

interface ImportResult {
  imported: number;
  duplicates: number;
  nonExpense: number;
  invalid: number;
  invalidRows: InvalidRow[];
  detailsTruncated: boolean;
}

interface Expense {
  id: string;
  transaction_date: string;
  amount: string | number;
  title: string;
  currency: "PLN";
}

interface ExpensePage {
  expenses: Expense[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseResponse(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function responseError(value: Record<string, unknown> | null, fallback: string): string {
  return typeof value?.error === "string" ? value.error : fallback;
}

function isImportResult(value: Record<string, unknown> | null): value is Record<string, unknown> & ImportResult {
  return (
    value !== null &&
    typeof value.imported === "number" &&
    typeof value.duplicates === "number" &&
    typeof value.nonExpense === "number" &&
    typeof value.invalid === "number" &&
    Array.isArray(value.invalidRows) &&
    value.invalidRows.every(
      (row: unknown) => isRecord(row) && typeof row.row === "number" && typeof row.reason === "string",
    ) &&
    typeof value.detailsTruncated === "boolean"
  );
}

function isExpensePage(value: Record<string, unknown> | null): value is Record<string, unknown> & ExpensePage {
  return (
    value !== null &&
    typeof value.page === "number" &&
    typeof value.pageSize === "number" &&
    typeof value.total === "number" &&
    typeof value.totalPages === "number" &&
    Array.isArray(value.expenses) &&
    value.expenses.every(
      (expense: unknown) =>
        isRecord(expense) &&
        typeof expense.id === "string" &&
        typeof expense.transaction_date === "string" &&
        (typeof expense.amount === "string" || typeof expense.amount === "number") &&
        typeof expense.title === "string" &&
        expense.currency === "PLN",
    )
  );
}

function uploadCsv(file: File, onProgress: (percent: number | null) => void): Promise<ImportResult> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/expenses/import");
    request.upload.onprogress = (event) => {
      onProgress(event.lengthComputable ? Math.round((event.loaded / event.total) * 100) : null);
    };
    request.onerror = () => {
      reject(new Error("Upload failed. Check your connection and try again."));
    };
    request.onload = () => {
      const body = parseResponse(request.responseText);
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(responseError(body, "CSV import failed. Please try again.")));
      } else if (isImportResult(body)) {
        resolve(body);
      } else {
        reject(new Error("The import response could not be read."));
      }
    };
    const form = new FormData();
    form.set("file", file);
    request.send(form);
  });
}

function formatAmount(amount: string | number): string {
  return Number(amount).toFixed(2);
}

export default function ExpenseImportReview() {
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [expensePage, setExpensePage] = useState<ExpensePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch(`/api/expenses?page=${page}`, {
          credentials: "same-origin",
          signal: controller.signal,
        });
        const body = parseResponse(await response.text());
        if (!response.ok) throw new Error(responseError(body, "Expenses could not be loaded."));
        if (!isExpensePage(body)) throw new Error("The expense list could not be read.");
        if (!controller.signal.aborted) setExpensePage(body);
      } catch (error) {
        if (!controller.signal.aborted) {
          setListError(error instanceof Error ? error.message : "Expenses could not be loaded.");
          setExpensePage(null);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [page, revision]);

  async function handleImport(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (importing) return;
    setFileError(null);
    setResult(null);

    if (!file) {
      setFileError("Choose one CSV file to import.");
      return;
    }
    if (!/\.csv$/i.test(file.name)) {
      setFileError("Choose a .csv file.");
      return;
    }

    setImporting(true);
    setProgress(0);
    try {
      const imported = await uploadCsv(file, setProgress);
      setResult(imported);
      setLoading(true);
      setListError(null);
      setPage(1);
      setRevision((current) => current + 1);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "CSV import failed. Please try again.");
    } finally {
      setImporting(false);
      setProgress(null);
    }
  }

  function showPage(nextPage: number) {
    setLoading(true);
    setListError(null);
    setPage(nextPage);
  }

  return (
    <div className="space-y-6">
      <section
        aria-labelledby="import-heading"
        className="rounded-2xl border border-white/10 bg-white/10 p-5 backdrop-blur-xl sm:p-6"
      >
        <h2 id="import-heading" className="text-xl font-semibold text-white">
          Import CSV
        </h2>
        <p className="mt-2 text-sm text-blue-100/70">
          Choose a bank export with Data_operacji, Kwota, and Tytul columns. Expenses are saved in PLN.
        </p>
        <form
          onSubmit={(event) => void handleImport(event)}
          className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-end"
        >
          <div className="min-w-0 flex-1">
            <label htmlFor="expense-csv" className="mb-2 block text-sm font-medium text-blue-100">
              CSV file
            </label>
            <input
              id="expense-csv"
              name="file"
              type="file"
              accept=".csv,text/csv"
              disabled={importing}
              onChange={(event) => {
                setFile(event.currentTarget.files?.[0] ?? null);
              }}
              className="block w-full min-w-0 rounded-lg border border-white/20 bg-white/10 p-2 text-sm text-white file:mr-3 file:rounded-md file:border-0 file:bg-blue-100 file:px-3 file:py-1 file:text-blue-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-60"
            />
          </div>
          <button
            type="submit"
            disabled={importing}
            className="rounded-lg bg-blue-200 px-5 py-2.5 text-sm font-semibold text-blue-950 transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {importing ? "Importing…" : "Import expenses"}
          </button>
        </form>

        {importing && (
          <div className="mt-4" role="status" aria-live="polite">
            <p className="text-sm text-blue-100">
              {progress === null || progress === 100 ? "Processing CSV…" : `Uploading… ${progress}%`}
            </p>
            <progress
              value={progress ?? undefined}
              max={100}
              aria-label="CSV upload progress"
              className="mt-2 w-full"
            />
          </div>
        )}
        {fileError && (
          <p role="alert" className="mt-4 rounded-lg border border-red-300/40 bg-red-950/40 p-3 text-sm text-red-100">
            {fileError}
          </p>
        )}
        {result && (
          <div
            className="mt-5 rounded-lg border border-emerald-300/30 bg-emerald-950/30 p-4"
            role="status"
            aria-live="polite"
          >
            <h3 className="font-semibold text-emerald-100">Import complete</h3>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-blue-100/70">Imported</dt>
                <dd className="text-lg font-semibold">{result.imported}</dd>
              </div>
              <div>
                <dt className="text-blue-100/70">Duplicates</dt>
                <dd className="text-lg font-semibold">{result.duplicates}</dd>
              </div>
              <div>
                <dt className="text-blue-100/70">Non-expenses</dt>
                <dd className="text-lg font-semibold">{result.nonExpense}</dd>
              </div>
              <div>
                <dt className="text-blue-100/70">Invalid rows</dt>
                <dd className="text-lg font-semibold">{result.invalid}</dd>
              </div>
            </dl>
            {result.invalidRows.length > 0 && (
              <div className="mt-4 border-t border-white/10 pt-4">
                <h4 className="text-sm font-semibold">Skipped invalid rows</h4>
                <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-blue-100/80">
                  {result.invalidRows.map(({ row, reason }) => (
                    <li key={row}>
                      Row {row}: {reason}
                    </li>
                  ))}
                </ul>
                {result.detailsTruncated && (
                  <p className="mt-2 text-sm text-blue-100/70">Showing the first 100 invalid rows.</p>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      <section
        aria-labelledby="expenses-heading"
        className="rounded-2xl border border-white/10 bg-white/10 p-5 backdrop-blur-xl sm:p-6"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="expenses-heading" className="text-xl font-semibold">
            Saved expenses
          </h2>
          {expensePage && <p className="text-sm text-blue-100/70">{expensePage.total} total</p>}
        </div>
        {loading && (
          <p role="status" className="mt-5 text-sm text-blue-100/80">
            Loading expenses…
          </p>
        )}
        {!loading && listError && (
          <p role="alert" className="mt-5 rounded-lg border border-red-300/40 bg-red-950/40 p-3 text-sm text-red-100">
            {listError}
          </p>
        )}
        {!loading && !listError && expensePage?.total === 0 && (
          <p className="mt-5 text-sm text-blue-100/80">No expenses yet. Import a CSV to get started.</p>
        )}
        {!loading && !listError && expensePage && expensePage.expenses.length > 0 && (
          <>
            <ol className="mt-5 divide-y divide-white/10">
              {expensePage.expenses.map((expense) => (
                <li
                  key={expense.id}
                  className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-5"
                >
                  <div className="min-w-0">
                    <p className="font-medium break-words text-white">{expense.title}</p>
                    <time dateTime={expense.transaction_date} className="text-sm text-blue-100/65">
                      {expense.transaction_date}
                    </time>
                  </div>
                  <p className="shrink-0 font-semibold text-blue-100 tabular-nums">
                    {formatAmount(expense.amount)} {expense.currency}
                  </p>
                </li>
              ))}
            </ol>
            {expensePage.totalPages > 1 && (
              <nav
                aria-label="Expense pages"
                className="mt-5 flex items-center justify-between gap-3 border-t border-white/10 pt-5"
              >
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => {
                    showPage(page - 1);
                  }}
                  className="rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="text-center text-sm text-blue-100/80">
                  Page {expensePage.page} of {expensePage.totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= expensePage.totalPages}
                  onClick={() => {
                    showPage(page + 1);
                  }}
                  className="rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
              </nav>
            )}
          </>
        )}
      </section>
    </div>
  );
}
