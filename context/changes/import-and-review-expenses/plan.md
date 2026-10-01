# Import and Review Expenses Implementation Plan

## Overview

Deliver roadmap slice S-01: a signed-in user imports one supported bank CSV, receives actionable import feedback, and reviews their private saved expenses newest first. This builds on the existing owner-scoped `public.expenses` table and does not implement categorization or charts.

## Current State Analysis

The app has Supabase cookie-backed authentication, a protected dashboard shell, and an owner-scoped expense table, but no transaction fields, CSV parser, import route, or expense review UI. The attached bank export was inspected without copying its financial rows into the repository: it has the exact `Data_operacji;Kwota;Tytul` header, 64 data rows, negative dot-decimal amounts, ISO dates, and Windows-1250 encoding. Its three columns are semicolon-delimited, with no quoted rows in this sample.

## Desired End State

A signed-in user can upload a UTF-8 or Windows-1250 CSV with exactly those three headers in order. Valid negative-amount rows become PLN expenses owned by that user. Invalid rows, non-negative rows, and exact repeats are skipped with distinct counts; invalid rows include source row numbers and reasons. A bad header, empty file, unsupported/structurally unrecoverable CSV, or oversized file produces a clear file-level error without inserts. The dashboard lists every complete saved expense through pages of 50, ordered by transaction date descending with a stable tie-breaker. Another user cannot import into or read that owner's records.

### Key Discoveries:

- `supabase/migrations/20260924000000_create_owner_scoped_expenses.sql:1` defines only `id`, `owner_id`, and `created_at`, with owner-only RLS policies.
- `src/middleware.ts:4` protects `/dashboard` but not `/api`; expense API routes therefore need their own authenticated-user checks.
- `src/lib/supabase.ts:1` provides the cookie-backed server client to reuse in the new routes.
- `src/pages/dashboard.astro:4` is currently a welcome/sign-out page, not an expense review.
- `.github/workflows/ci.yml:11` runs lint, Astro checks, and build; its local-Supabase smoke job already exercises expense RLS and the built app.

## What We're NOT Doing

- Categories, keyword matching, category editing, charts, or monthly summaries (S-02/S-03).
- Multiple bank layouts, comma-decimal or positive-expense conventions, bank integrations, or cash entry.
- Import history, transaction editing/deletion UI, or a claim that identical same-day purchases can be distinguished. Under the agreed MVP rule, an exact repeated date, amount, and title is skipped even if it was a genuine second purchase.
- Committing the user's private CSV or transaction titles as test fixtures.

## Implementation Approach

Extend `public.expenses` without disturbing existing owner-only RLS or legacy rows. Parse and validate an upload on the server, using Papa Parse for semicolon CSV syntax and explicit byte decoding; keep amounts as signed decimal strings until validated and persisted as `numeric(12,2)`. Deduplicate complete transactions per owner with a database unique constraint, so re-imports and concurrent submissions cannot create repeats. Expose authenticated import and paginated review endpoints, then add a dashboard interface that uploads, reports results, and refreshes the newest-first list. Use synthetic fixtures for automated tests and the attached private export only for manual acceptance.

## Critical Implementation Details

The attached export is not UTF-8. Decode UTF-8 strictly first, then Windows-1250; never silently replace malformed bytes. The exact three-header contract and strict row validation are the final guard against an unrelated single-byte file being mistaken for this bank format.

The dashboard middleware does not protect `/api`. Each new expense endpoint must independently require a valid `Astro.locals.user`, use the session-scoped Supabase client, and rely on existing RLS rather than a service-role key.

The repository's `.gitignore` ignores `context/`, including this change folder. When committing a phase, explicitly force-add only this change's plan/brief/identity files and the intended implementation paths; do not sweep in unrelated working-tree edits.

## Phase 1: Expense schema and CSV contract

### Overview

Make the storage and parsing contracts explicit before exposing an upload endpoint.

### Changes Required:

#### 1. Expense transaction fields and duplicate key

**File**: `supabase/migrations/<new timestamp>_add_expense_transaction_fields.sql`

**Intent**: Add the fields needed for the bank source while preserving existing rows and the F-01 RLS contract. Prevent complete duplicates for the same owner at the database boundary.

**Contract**: Add nullable `transaction_date date`, `amount numeric(12,2)`, and `title text`; add `currency text not null default 'PLN'` constrained to PLN for this MVP. Enforce negative amounts and nonblank titles when present. Add a unique constraint on `(owner_id, transaction_date, amount, title)`; nullable legacy rows remain possible and unaffected. Do not rewrite the original migration or change ownership policies.

#### 2. Decoder, parser, and row classifier

**Files**: `src/lib/expenses/parse-csv.ts`, `package.json`, `package-lock.json`

**Intent**: Establish one reusable, deterministic import contract for the supplied bank format. Classify records before database writes and keep source row positions for feedback.

**Contract**: Accept CSV bytes up to 2 MiB and at most 10,000 data rows. Decode strict UTF-8 (with optional BOM) or Windows-1250, then parse semicolon-delimited CSV with an exact ordered header of `Data_operacji;Kwota;Tytul`. Support normal CSV quoting and CRLF/LF. For each data row, require a real `YYYY-MM-DD` calendar date in years 0001–9999, a finite dot-decimal amount with exactly two fractional digits and magnitude at most 9,999,999,999.99, and a nonblank title; trim surrounding field whitespace while preserving title content and case. Accept only amounts `< 0`; classify zero/positive rows as `nonExpense`, malformed values as `invalid` with source row number and reason, and valid rows as PLN candidates. A malformed row is excluded without discarding valid rows; unrecoverable CSV structure is a file-level error. Do not log or echo titles in errors.

#### 3. Synthetic parser and schema tests

**Files**: `src/lib/expenses/parse-csv.test.ts`, `scripts/expense-storage-smoke.mjs`, `package.json`, `package-lock.json`

**Intent**: Lock down the agreed format and protect the prior storage contract. Avoid using the private bank file in automated tests.

**Contract**: Add a `test:unit` script using Vitest. Synthetic fixtures cover UTF-8/Windows-1250 Polish letters, BOM, quoted semicolons, CRLF/LF, wrong header/order, empty and oversized files, malformed date/amount/title, non-negative skips, duplicate candidate keys, and row numbering. Extend the local Supabase smoke to assert new field types, PLN default, unique-key behavior, and unchanged owner-only RLS, including legacy empty rows.

### Success Criteria:

#### Automated Verification:

- `npm run test:unit` passes the synthetic encoding, parsing, classification, and limit cases.
- With local Supabase running, `npm run smoke:storage` passes schema, uniqueness, and owner-isolation checks.
- `npm run lint`, `npx astro check`, and `npm run build` pass.

#### Manual Verification:

- A local parser-only check of the private attached export identifies 64 valid negative PLN candidates and readable Polish characters without persisting or committing the source file.

**Implementation Note**: Pause after automated verification for human confirmation of the manual check before proceeding to Phase 2.

---

## Phase 2: Authenticated import and review APIs

### Overview

Persist valid candidates once per owner and expose stable, paginated private review data.

### Changes Required:

#### 1. Import endpoint and persistence

**Files**: `src/pages/api/expenses/import.ts`, `src/lib/expenses/import.ts`

**Intent**: Turn the parser result into a bounded, owner-scoped database write and useful feedback. Make retrying the same file safe.

**Contract**: `POST /api/expenses/import` accepts one multipart `file` field and returns JSON with `imported`, `duplicates`, `nonExpense`, `invalid`, and the first 100 invalid-row details (`row`, `reason`) plus a `detailsTruncated` flag. Require authentication and an origin-safe browser request. Reject missing, empty, oversized, wrong-header, and unrecoverably malformed files before any write. Deduplicate candidates within the file, then use a single batch insert that ignores the database unique-key conflict; inserted-row results determine the duplicate count, including prior imports. Unexpected database failure must return an error rather than claim success or log transaction titles.

#### 2. Review endpoint

**File**: `src/pages/api/expenses/index.ts`

**Intent**: Let the dashboard retrieve all complete saved transactions over multiple pages without leaking another account's records.

**Contract**: `GET /api/expenses?page=<positive integer>` returns at most 50 complete records and pagination metadata. Select only `id`, `transaction_date`, `amount`, `title`, and `currency`; sort by `transaction_date DESC`, then `created_at DESC`, then `id DESC`. Omit legacy placeholder rows with missing transaction fields. Require authentication; owner filtering is enforced by the session's RLS context.

#### 3. API smoke coverage and CI wiring

**Files**: `scripts/smoke.mjs`, `.github/workflows/ci.yml`, `package.json`

**Intent**: Exercise the built Cloudflare preview app against local Supabase, including the authorization boundary and repeat-import behavior.

**Contract**: Add synthetic CSV smoke cases for anonymous API denial, a mixed valid/invalid/non-expense file, re-import duplicate counts, two-user isolation, stable newest-first results, and invalid-file no-write behavior. Run `test:unit` in CI and retain the existing lint/check/build/storage smoke gates.

### Success Criteria:

#### Automated Verification:

- `npm run test:unit` and the expanded `npm run smoke` pass against the built app and local Supabase.
- `npm run smoke:storage` still passes, including owner-only CRUD and duplicate constraints.
- `npm run lint`, `npx astro check`, and `npm run build` pass.

#### Manual Verification:

- As one signed-in user, importing the same synthetic file twice reports zero new rows on the second import; another signed-in user cannot see those rows and can import their own copy.

**Implementation Note**: Pause after automated verification for human confirmation of the manual check before proceeding to Phase 3.

---

## Phase 3: Dashboard upload and newest-first review

### Overview

Complete the user-facing import and review journey on the protected dashboard.

### Changes Required:

#### 1. Import and review interface

**Files**: `src/pages/dashboard.astro`, `src/components/expenses/ExpenseImportReview.tsx`

**Intent**: Replace the placeholder dashboard body with a simple upload, import summary, and readable expense list while retaining sign-out and account context.

**Contract**: The page accepts one `.csv`, indicates upload progress, disables repeat submission while importing, and shows file-level errors separately from per-row skips. Display counts for imported, duplicates, non-expenses, and invalid rows; show source row numbers and reasons for invalid rows without exposing sensitive titles in error messages. Refresh page 1 after import. Render date, signed amount, title as escaped text, and PLN; show an empty state, loading/error states, and page navigation so every complete saved transaction remains reachable newest first.

#### 2. UI and accessibility verification

**Files**: `src/components/expenses/ExpenseImportReview.tsx`, `scripts/smoke.mjs`

**Intent**: Make the flow usable for the actual bank export and preserve basic keyboard and error-feedback behavior.

**Contract**: Use labeled file input and submit control, announced status/error feedback, keyboard-operable pagination, and no unsafe HTML rendering of titles. Extend smoke checks for authenticated dashboard rendering and import/list states that can be asserted without committing the private CSV.

### Success Criteria:

#### Automated Verification:

- `npm run test:unit` and the expanded `npm run smoke` pass.
- `npm run lint`, `npx astro check`, and `npm run build` pass.

#### Manual Verification:

- Importing the attached private export through the dashboard shows 64 newly saved expenses on a fresh account, Polish titles render correctly, and the list is newest first across pages.
- Re-importing that file reports 0 imported and 64 duplicates; invalid and non-negative synthetic rows show the agreed skip feedback without removing valid rows.
- A second account cannot review the first account's expenses; upload errors, empty state, keyboard controls, and narrow-screen layout are usable.

**Implementation Note**: Pause after automated verification for human confirmation of the manual checks before marking this phase complete.

---

## Testing Strategy

### Unit Tests:

- Synthetic parser inputs cover both encodings, exact header, quoting, date/amount validity, positive/zero skips, file limits, and source row numbering.
- Import service tests cover in-file repeats, database repeats, duplicate counts, and database failure reporting.

### Integration Tests:

- Local Supabase storage smoke proves the migrated schema, unique key, and existing RLS.
- Built-app smoke proves anonymous denial, signed-in import/re-import, invalid-file no-write, private paginated review, and sort order.

### Manual Testing Steps:

1. Use the private supplied Windows-1250 file locally; do not copy it into the repository.
2. On a fresh account, import and verify 64 expenses, Polish characters, negative amounts, and newest-first paging.
3. Re-import and verify 64 duplicates with no new records; test a mixed synthetic file and a wrong-header file.
4. Sign in as a different account and verify no first-account records are visible.

## Performance Considerations

Bound files at 2 MiB/10,000 data rows, deduplicate in memory, and use one database batch write rather than one request per transaction. Fetch at most 50 review rows per page. The database unique constraint must remain the final protection against concurrent duplicate imports.

## Migration Notes

Add a new forward-only migration; do not edit the already deployed F-01 migration. New transaction columns stay nullable so any existing ID/owner-only rows and the prior storage smoke survive. The review endpoint excludes those legacy placeholders. Existing RLS policies remain in force; rollback of the UI/API must not require deleting saved transactions. Production deployment must apply the migration before serving the new endpoints.

## References

- Roadmap slice: `context/foundation/roadmap.md:77`; PRD import and feedback: `context/foundation/prd.md:66`.
- Prior owner-scoped storage contract: `context/archive/2026-09-24-owner-scoped-expense-storage/plan.md`.
- Existing auth and smoke patterns: `src/lib/supabase.ts:1`, `src/middleware.ts:4`, `scripts/smoke.mjs:1`, `scripts/expense-storage-smoke.mjs:1`.
- Parser behavior: [Papa Parse documentation](https://www.papaparse.com/docs); test runner: [Vitest guide](https://vitest.dev/guide/).
- Private sample: `Zestawienie operacji za 29.08.2026 - 28.09.2026.csv` (inspected locally; not a repository fixture).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Expense schema and CSV contract

#### Automated

- [x] 1.1 `npm run test:unit` passes the synthetic encoding, parsing, classification, and limit cases. — b646f59
- [x] 1.2 With local Supabase running, `npm run smoke:storage` passes schema, uniqueness, and owner-isolation checks. — b646f59
- [x] 1.3 `npm run lint`, `npx astro check`, and `npm run build` pass. — b646f59

#### Manual

- [x] 1.4 A local parser-only check of the private attached export identifies 64 valid negative PLN candidates and readable Polish characters without persisting or committing the source file. — b646f59

### Phase 2: Authenticated import and review APIs

#### Automated

- [x] 2.1 `npm run test:unit` and the expanded `npm run smoke` pass against the built app and local Supabase.
- [x] 2.2 `npm run smoke:storage` still passes, including owner-only CRUD and duplicate constraints.
- [x] 2.3 `npm run lint`, `npx astro check`, and `npm run build` pass.

#### Manual

- [x] 2.4 As one signed-in user, importing the same synthetic file twice reports zero new rows on the second import; another signed-in user cannot see those rows and can import their own copy.

### Phase 3: Dashboard upload and newest-first review

#### Automated

- [ ] 3.1 `npm run test:unit` and the expanded `npm run smoke` pass.
- [ ] 3.2 `npm run lint`, `npx astro check`, and `npm run build` pass.

#### Manual

- [ ] 3.3 Importing the attached private export through the dashboard shows 64 newly saved expenses on a fresh account, Polish titles render correctly, and the list is newest first across pages.
- [ ] 3.4 Re-importing that file reports 0 imported and 64 duplicates; invalid and non-negative synthetic rows show the agreed skip feedback without removing valid rows.
- [ ] 3.5 A second account cannot review the first account's expenses; upload errors, empty state, keyboard controls, and narrow-screen layout are usable.
