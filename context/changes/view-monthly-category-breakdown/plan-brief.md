# View monthly category breakdown — Plan Brief

> Full plan: [plan.md](plan.md)

## What & Why

Turn imported expenses into a useful current-month spending breakdown. This is roadmap S-02, delivering automatic categories and the MVP's primary chart outcome.

## Starting Point

Private expense storage, bounded CSV import, and newest-first all-date review are implemented. Categories, user keyword rules, and monthly totals are absent.

## Desired End State

The dashboard adds rule management, expense category/review badges, and a clearly labelled Europe/Warsaw current-month pie chart. The all-date table remains unchanged in scope; the legend shows all ten categories, including zeros.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Categories | Groceries, Eating out, Transport, Housing & bills, Household, Health, Clothing, Shopping, Leisure, Other | User chose the detailed fixed list. |
| Setup | Dashboard rule panel; no merchant seeds | Users configure their own associations. |
| Matching | Case-insensitive literal substring; preserve accents | Predictable matching without regex. |
| Whitespace | Trim and collapse for matching only | Formatting differences should not block matches. |
| Winner | Longest normalized keyword; cross-category longest ties → Other + review | Specificity wins, not insertion order. |
| Existing expenses | Recalculate automatic assignments after rule CRUD | Current rules apply to old and new records. |
| Other | Explicit match is categorized; unmatched/ambiguous needs review | Category and review state are separate. |
| Duplicate rules | Reject same-owner normalized duplicates; direct editing | Never replace silently. |
| Month | Warsaw calendar month by operation date | Device/import timezone cannot change totals. |
| Table | All dates; existing pagination | Preserve import review. |
| Chart | No filtering; all ten legend rows | Complete, focused overview. |
| Architecture | Shared invoker read model; database aggregation | Avoid backfills and capped totals. |

## Scope

**In scope:**

- Fixed catalogue, private keyword-rule CRUD, and effective categories.
- Current-month totals, dashboard panel, badges, pie, and complete legend.

**Out of scope:**

- S-03 manual corrections/learning, custom categories, priorities, and AI.
- Historical charts, chart drill-down, expense filters, or import redesign.

## Architecture / Approach

Persist rules, not automatic category snapshots. Both table and totals use one owner-safe database matcher, so rule changes affect existing records without rewriting transactions. Preserve exact integer-cent totals through API and display; render a static SVG with textual values and no new chart dependency. S-03 will add manual-override precedence at this shared seam.

## Phases at a Glance

| Phase | Deliverable | Key risk |
| --- | --- | --- |
| 1. Database | Catalogue, rules, matcher, aggregate, storage tests | Owner isolation and deterministic ties |
| 2. APIs | Rule CRUD, categorized review, Warsaw summary | Precision, boundaries, and body limits |
| 3. Dashboard | Rule panel, badges, static chart | Refresh correctness and accessibility |

**Prerequisites:** S-01 complete; Node 22.22.3 and Docker/local Supabase available for implementation gates. Each phase includes automated and human verification.

## Open Risks & Assumptions

- SQL matching must preserve Polish accents and normalize whitespace consistently.
- Summary totals must cover every row, beyond 50-row pages and the 1,000-row API cap.
- Read-time matching needs representative local performance checks; no historical backfill.
- Manual overrides are future work, not an implemented guarantee.

## Success Criteria (Summary)

- Rules and expenses stay private and persist across sign-out/sign-in.
- Current rules classify old/new expenses; fallback and deliberate Other remain distinct.
- Warsaw current-month spending is exact; all ten legend entries are readable.

## References

- Requirements: [PRD](../../foundation/prd.md); [S-02 roadmap](../../foundation/roadmap.md).
- Contracts, test gates, and primary technical sources: [full plan](plan.md#references).
