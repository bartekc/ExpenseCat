<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Import and review expenses

- **Plan**: `context/changes/import-and-review-expenses/plan.md`
- **Scope**: Full plan (phases 1–3)
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-02
- **Verdict**: APPROVED
- **Initial review verdict**: NEEDS ATTENTION; all findings were fixed during triage
- **Findings**: 0 critical, 2 warnings, 1 observation
- **Implementation range**: `39f6ff5..HEAD`

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — The upload limit is enforced after the multipart body is consumed

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/pages/api/expenses/import.ts:23`
- **Detail**: `request.formData()` consumes the multipart body before the file's 2 MiB size check at line 35. An authenticated oversized request can therefore consume far more than the intended limit and may fail before the endpoint can return its planned 413 response. Cloudflare allows request bodies of at least 100 MB while a Worker isolate has a 128 MB memory limit ([Cloudflare limits](https://developers.cloudflare.com/workers/platform/limits/)). The exact failure threshold has not been measured.
- **Fix**: Bound the total request stream before multipart parsing, with a small explicit allowance for multipart overhead; keep the file-size check. An early `Content-Length` rejection can be an optimization, not the sole control.
  - Strength: Makes the enforced memory bound match the planned 2 MiB upload contract even when the length header is absent or inaccurate.
  - Tradeoff: Requires a bounded body reader and a documented overhead allowance; some unusually large multipart metadata will be rejected.
  - Confidence: HIGH — the size check visibly follows the full-body parse.
  - Blind spot: Worker memory use under a maximal multipart request has not been load-tested.
- **Decision**: FIXED — bounded the multipart request stream to 2 MiB plus 16 KiB before parsing; retained the 2 MiB file check; added oversized-file and no-Content-Length streamed-upload smoke coverage. Verified by unit tests, lint, Astro check/build, and built-app smoke on 2026-10-02.

### F2 — A long title can abort the whole import batch

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260929000000_add_expense_transaction_fields.sql:11`
- **Detail**: The unique B-tree key includes unrestricted `title text`; `src/lib/expenses/parse-csv.ts:74` accepts any nonblank title within the 2 MiB file limit. PostgreSQL B-tree index tuples have a roughly 2.7 KB size ceiling ([Supabase troubleshooting](https://supabase.com/docs/guides/troubleshooting/error-index-row-size-exceeds-btree-version-4-maximum-for-index-LMmoeU)). A single incompressible multi-KB title can make the batch upsert fail, rejecting other valid rows instead of classifying that row as invalid. The exact threshold depends on the whole composite key and storage details.
- **Fix**: Enforce a conservative UTF-8 byte-length limit for titles in both CSV classification and the database, and add a boundary test that expects an overlong title to be skipped without losing other rows.
  - Strength: Preserves the current owner/date/amount/title deduplication rule and row-level skip behavior.
  - Tradeoff: Extremely long legitimate descriptions become invalid; the safe byte budget must account for the other indexed columns.
  - Confidence: HIGH — the parser has no title-length bound and the unique key indexes the full text.
  - Blind spot: A representative overlong title has not been exercised against the local database in this review.
- **Decision**: FIXED — added a 1,024 UTF-8-byte parser limit and an additive `expenses_title_max_bytes` database check; overlong CSV rows are skipped while valid rows import. Unit, storage, lint, Astro check/build, and built-app smoke passed on 2026-10-02. The new check is `NOT VALID` for pre-existing rows; its later audit/validation is tracked in `follow-ups/review-fixes.md`.

### F3 — The database accepts whitespace-only titles rejected by the parser

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260929000000_add_expense_transaction_fields.sql:9`
- **Detail**: `btrim(title)` removes ordinary spaces by default, so a direct authenticated table write containing only tabs or line breaks passes the database's nonblank check; the CSV parser's JavaScript `trim()` rejects it. This affects direct writes, not the current CSV route ([PostgreSQL string functions](https://www.postgresql.org/docs/18/functions-string.html)).
- **Fix**: Align the database check with the intended nonblank policy for at least common whitespace characters, and cover it in the storage smoke test.
- **Decision**: FIXED — added an additive `expenses_title_has_content` database check for whitespace-only titles, including U+FEFF, and direct-write storage smoke cases for tabs/newlines and non-breaking space/BOM. The migration is `NOT VALID` for pre-existing rows; its later audit/validation is tracked in `follow-ups/review-fixes.md`. Local migration, storage smoke, unit tests, lint, Astro check/build, and built-app smoke passed on 2026-10-02.

## Verification

| Check | Result |
|-------|--------|
| `npm run test:unit` | PASS — 2 files, 15 tests |
| `npm run smoke:storage` against local Supabase | PASS — F2 title-byte boundaries and F3 whitespace-only direct-write rejections |
| `npm run lint` | PASS |
| Astro check with Node 22 | PASS — 37 files, 0 errors/warnings/hints |
| Astro build with Node 22 | PASS |
| `npm run smoke` against the built app and local Supabase | PASS — all smoke steps, including F1's two 413 cases and F2's mixed valid/overlong title case |
| Windows-1250 `TextDecoder` in installed Miniflare/workerd at the configured compatibility date | PASS — supported |

The plan's manual checkboxes are marked complete, and the user previously confirmed the phase-3 checks. The private bank export was not reopened during this review; it is not part of the implementation diff.

## Triage outcome

F1, F2, and F3 were each selected for **fix now** and are **FIXED**. No review findings remain open. Both additive constraints were applied to local Supabase and verified there; production deployment and audits of pre-existing rows remain follow-up work before validating the constraints in deployed databases.
