---
change_id: correct-expense-category
title: Correct expense category
status: implemented
created: 2026-10-12
updated: 2026-10-13
archived_at: null
---

## Notes

Roadmap S-03. Eight product decisions and the three-phase structure were approved in the planning conversation on 2026-10-12. See plan.md and plan-brief.md for the complete agreed scope.

Phase 1 implementation evidence, 2026-10-12:

- Added `supabase/migrations/20261012000000_add_expense_category_corrections.sql`; applied successfully to the existing local Supabase database without resetting data. Local services use API/DB ports 56321/56322 while config retains 54321/54322, so the migration gate used the pinned Node 22.22.3 Supabase CLI entry point with an explicit localhost DB URL and `sslmode=disable`. `supabase/config.toml` stayed unchanged (SHA-256 B6CD900FE5C5CD943778173B877E54068105B68A679017C34B1EB6F8CC1DDB03).
- Existing storage smoke passed schema/ownership, catalogue/rule/Unicode matching, live recalculation, and uncapped aggregate cases. Existing unit suite passed 7 files / 41 tests. Lint passed; Astro check reported 52 files, zero errors/warnings/hints. Commands ran through the pinned Node 22.22.3 executable; no test files or smoke assertions were modified.
- A transactional synthetic SQL diagnostic observed initial Other/unmatched state, correction plus rule learning, explicit `rule_confirmation_required`, confirmed replacement, reset retaining the rule, stale `expense_conflict`, foreign-owner zero-row visibility and `expense_not_found`. Function metadata confirmed invoker execution and empty search paths; authenticated correction-state DELETE, anonymous state SELECT and sequence UPDATE privileges were absent. The whole fixture transaction was rolled back. This is partial manual diagnostic evidence, not confirmation of every acceptance scenario.
- Mixed-state local benchmark used 100 rules, 10,000 expenses and 5,000 manual overrides. The aggregate returned ten rows / 10,000 expenses / 9,999,999,999,990,000 cents / zero needing review. Observed aggregate wall time was 851.941 ms; authenticated SQL EXPLAIN ANALYZE execution was 1009.753 ms. Owner/date and correction primary-key indexes were used; sorts remained in memory. Fixture transaction was rolled back. These observations are not a production latency guarantee.
- Automated gates 1.1–1.3 passed. The user confirmed successful manual verification of criteria 1.4–1.7 in the implementation conversation on 2026-10-12, including competing writes, direct-DML final-CAS rollback, stale confirmation after rule edit-back/delete-recreate, the permission/input matrix, and benchmark review. All Phase 1 Progress rows are complete and reference the approved phase commit `b75c4ad`.

Phase 2 implementation evidence, 2026-10-12:

- Added browser-safe correction contracts in `src/lib/expenses/corrections.ts` and a separate server-only `corrections-api.ts` route helper (minor adaptation). GET/PATCH category and POST reset/check routes validate inputs/results, preserve session/RLS ownership, enforce same-origin mutations and 16 KiB JSON limits, map known conflicts to 409, and reject malformed database details. The list now includes manual category/revision metadata; README documents the contracts and verification limits.
- Existing unit suite passed 7 files / 41 tests. Lint and Astro checks passed after mechanical boolean-expression and helper-argument-type fixes; Astro checked 57 files with no errors/warnings/hints. Sync and production build passed on Node 22.22.3. The pre-existing missing sitemap `site` warning remains. Storage smoke and the full existing HTTP smoke passed unchanged against local Supabase and the dedicated production preview at `http://127.0.0.1:4341`.
- Authenticated synthetic HTTP observations verified no-store GET state, correction plus rule learning, 409 `rule_confirmation_required`, confirmed replacement, reset retaining the rule and read-only check state. A first diagnostic signin lacked the framework-required Origin header; the corrected request succeeded without changing auth code. The diagnostic expense and learned rule were removed in finally cleanup. These observations do not replace the full manual acceptance matrix.
- Automated Progress 2.1–2.4 is complete. On 2026-10-13 the user confirmed successful manual verification of 2.5–2.7: the auth/ownership/input/body-limit matrix, two-session conflicts and atomic rollback, recovery lookup beyond one rule page, totals/re-import/session persistence. All Phase 2 criteria are complete. No tests, smoke assertions, CI/configuration, importer or dashboard code were changed in this phase.

Phase 3 implementation evidence, 2026-10-13:

- Added the inline category editor with optional rule learning, explicit replacement confirmation, reset and check/review recovery. A stable keyed editor sibling stays mounted when refreshed rows disappear (minor adaptation), retaining drafts. Import, rule mutations and editor requests share a synchronous mutation guard; successful corrections refresh the list, rules and summary independently.
- Existing unit suite passed 7 files / 41 tests. Lint passed on attempt 2 after adding braces to two void callback bodies. Astro sync and check passed; check reported 58 files and no errors/warnings/hints after removing an unused import. Production build passed on Node 22.22.3 with the existing sitemap warning. Storage smoke and the complete existing HTTP smoke passed unchanged against local Supabase and the refreshed production preview on port 4341. No tests or assertions were authored or modified.
- Read-only browser acceptance observed one editor below the selected expense, current category focus, learning enabled by default, an empty phrase blocking Save, learning-off enabling Save, and Cancel removing the editor and restoring focus to its initiating button. No financial records or rules were changed by browser verification. On 2026-10-13 the user confirmed successful manual acceptance of 3.4–3.6: keyboard/narrow layout, save/reset and rule conflicts, category totals and persistence, plus two-tab/network recovery with retained drafts. All Phase 3 criteria are complete.
