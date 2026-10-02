# Import and Review Expenses — Plan Brief

> Full plan: `context/changes/import-and-review-expenses/plan.md`

## What & Why

Deliver S-01 of the first monthly expense review: a signed-in user uploads one supported bank CSV, receives clear feedback, and reviews private saved expenses. The supplied real export settled the source format and exposed a necessary Windows-1250 decoding requirement.

## Starting Point

The app already has Supabase sign-in, a protected dashboard shell, and owner-only RLS on `public.expenses`. That table has no transaction fields, and the app has no CSV import or expense list.

## Desired End State

The dashboard accepts the agreed three-column CSV in UTF-8 or Windows-1250, saves valid negative amounts as PLN, and distinguishes imported, repeated, non-expense, and invalid rows. Every complete saved expense is reachable in a newest-first paginated list, visible only to its owner.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Supported source | Exact ordered `Data_operacji;Kwota;Tytul` header; semicolon CSV | Matches the owner's export; one source is the MVP scope. |
| Encoding | Strict UTF-8 or Windows-1250 | The attached 64-row export is not valid UTF-8 and contains Polish characters. |
| Date and amount | Real `YYYY-MM-DD` date; negative dot-decimal amount with two digits | Matches the corrected sample and actual export. |
| Currency | Default and constrain to PLN | The source has no currency column; PLN is the MVP decision. |
| Invalid row | Skip that row; report its row number and reason (first 100 details, plus total count) | Valid rows should still import without unbounded feedback. |
| Zero/positive row | Skip as `nonExpense` | These are not expenses under the agreed source convention. |
| Repeat | Skip exact owner + date + amount + trimmed title | Safe re-import; identical same-day purchases may be skipped in this MVP. |
| Review order | All complete saved expenses, newest transaction date first, 50 per page | Keeps review usable while retaining access to the full list. |
| File error | Reject before writes for bad header, empty/oversized file, or unrecoverable syntax | Users need clear feedback without partial ambiguity. |

## Scope

**In scope:** New expense transaction fields and unique key; strict CSV decoding/parsing; authenticated import and review APIs; dashboard upload, feedback, and paginated list; synthetic automated tests and private-file manual acceptance.

**Out of scope:** Categorization, charts, category edits, other bank layouts, cash entry, import history, transaction editing, and committing the user's CSV.

## Architecture / Approach

Upload bytes are decoded and parsed server-side, then valid candidates are inserted once through the existing session-scoped Supabase client. The database unique key and RLS enforce duplicate and owner boundaries. The dashboard uses authenticated JSON endpoints for import results and paginated review; no service-role access is needed.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Expense schema and CSV contract | Forward-only migration, parser, and synthetic tests | Preserve legacy rows and decode the real bank export correctly. |
| 2. Authenticated import and review APIs | Owner-scoped import, dedupe, feedback, pagination, smoke tests | `/api` is not protected by dashboard middleware; each route must check auth. |
| 3. Dashboard upload and newest-first review | Complete browser flow and private-file acceptance | Keep errors understandable and all records reachable across pages. |

**Prerequisites:** Existing F-01 storage/RLS; local Supabase for smoke checks; the private CSV available only for manual validation.

**Estimated effort:** About 2–3 focused implementation sessions across three independently verified phases.

## Open Risks & Assumptions

- Exact repeat matching can suppress a legitimate second identical purchase on the same day; the owner accepted this MVP tradeoff.
- New transaction fields stay nullable for pre-existing owner-only placeholder rows; the review list excludes incomplete rows.
- The supplied export validates Windows-1250 handling, but automated tests must use synthetic data to avoid exposing financial details.

## Success Criteria (Summary)

- A fresh account imports the supplied 64-row export with readable Polish text and sees all 64 negative PLN expenses newest first.
- Re-import reports 64 duplicates and creates no new records; malformed and non-negative rows are skipped with distinct feedback.
- Another account cannot read or alter those expenses, and automated lint/check/build/unit/smoke gates pass.
