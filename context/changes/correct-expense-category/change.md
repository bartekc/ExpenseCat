---
change_id: correct-expense-category
title: Correct expense category
status: implementing
created: 2026-10-12
updated: 2026-10-12
archived_at: null
---

## Notes

Roadmap S-03. Eight product decisions and the three-phase structure were approved in the planning conversation on 2026-10-12. See plan.md and plan-brief.md for the complete agreed scope.

Phase 1 implementation evidence, 2026-10-12:

- Added `supabase/migrations/20261012000000_add_expense_category_corrections.sql`; applied successfully to the existing local Supabase database without resetting data. Local services use API/DB ports 56321/56322 while config retains 54321/54322, so the migration gate used the pinned Node 22.22.3 Supabase CLI entry point with an explicit localhost DB URL and `sslmode=disable`. `supabase/config.toml` stayed unchanged (SHA-256 B6CD900FE5C5CD943778173B877E54068105B68A679017C34B1EB6F8CC1DDB03).
- Existing storage smoke passed schema/ownership, catalogue/rule/Unicode matching, live recalculation, and uncapped aggregate cases. Existing unit suite passed 7 files / 41 tests. Lint passed; Astro check reported 52 files, zero errors/warnings/hints. Commands ran through the pinned Node 22.22.3 executable; no test files or smoke assertions were modified.
- A transactional synthetic SQL diagnostic observed initial Other/unmatched state, correction plus rule learning, explicit `rule_confirmation_required`, confirmed replacement, reset retaining the rule, stale `expense_conflict`, foreign-owner zero-row visibility and `expense_not_found`. Function metadata confirmed invoker execution and empty search paths; authenticated correction-state DELETE, anonymous state SELECT and sequence UPDATE privileges were absent. The whole fixture transaction was rolled back. This is partial manual diagnostic evidence, not confirmation of every acceptance scenario.
- Mixed-state local benchmark used 100 rules, 10,000 expenses and 5,000 manual overrides. The aggregate returned ten rows / 10,000 expenses / 9,999,999,999,990,000 cents / zero needing review. Observed aggregate wall time was 851.941 ms; authenticated SQL EXPLAIN ANALYZE execution was 1009.753 ms. Owner/date and correction primary-key indexes were used; sorts remained in memory. Fixture transaction was rolled back. These observations are not a production latency guarantee.
- Automated gates 1.1–1.3 passed. The user confirmed successful manual verification of criteria 1.4–1.7 in the implementation conversation on 2026-10-12, including competing writes, direct-DML final-CAS rollback, stale confirmation after rule edit-back/delete-recreate, the permission/input matrix, and benchmark review. All Phase 1 Progress rows are complete; the phase commit is awaiting message approval.
