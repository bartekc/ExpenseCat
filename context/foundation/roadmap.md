---
project: ExpenseCat
version: 1
status: draft
created: 2026-09-23
updated: 2026-09-28
prd_version: 1
main_goal: speed
top_blocker: time
milestone_id: first-monthly-expense-review
milestone_seq: 1
milestone_status: open
---

# Roadmap: ExpenseCat

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Milestone

**M-1: First monthly expense review** — Status: open

- **Intent:** Deliver the first complete monthly expense review from one CSV source, with private, persistent transactions, useful categories, and a current-month spending chart.
- **Source materials:** `context/foundation/prd.md` (v1)
- **Done when:** every F-NN and S-NN below is `done`.
- **Scope anchors:** US-01, FR-001–FR-007.

## Vision recap

The project owner spends too much time combining account and card transactions with cash-expense notes at month end. The initial product reduces that bookkeeping effort by importing one CSV source, categorizing transactions, and showing spending split by category.

## North star

**S-02: See this month’s expense distribution by category.** This is the earliest slice that delivers the PRD’s primary success criterion and gives the selected speed goal a meaningful end-to-end result.

> Here, “north star” means the earliest end-to-end user outcome whose success shows that the core expense-review flow works.

## At a glance

| ID | Change ID | Outcome (user can …) | Prerequisites | PRD refs | Status |
| --- | --- | --- | --- | --- | --- |
| F-01 | owner-scoped-expense-storage | establish the smallest verified contract for persisting expense records so each signed-in user can access only their own records across sessions | — | Access Control; Non-Functional Requirements (financial-data isolation and persistence across sign-in sessions) | done |
| S-01 | import-and-review-expenses | A signed-in user can import a supported CSV and review the saved transactions, with clear feedback when a file cannot be processed. | F-01 | US-01, FR-001, FR-002, FR-003, FR-004 | blocked |
| S-02 | view-monthly-category-breakdown | A signed-in user can see imported transactions with assigned categories and a pie chart showing each category’s share of current-month expenses. | S-01 | US-01, FR-005, FR-007, Non-Functional Requirements (chart readability) | blocked |
| S-03 | correct-expense-category | A signed-in user can change a transaction’s category, see the current-month chart update, and have the corrected keyword/category association used on future imports. | S-02 | US-01, FR-005, FR-006, FR-007 | proposed |

## Baseline

What's already in place in the codebase as of `2026-09-23` (auto-researched and user-confirmed). Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** partial — Astro landing, signup/sign-in, and protected dashboard exist (`src/pages/index.astro`, `src/pages/auth/`, `src/pages/dashboard.astro`); CSV review and chart UI are absent.
- **Backend / API:** partial — Supabase server client, auth routes, and dashboard protection exist (`src/lib/supabase.ts`, `src/pages/api/auth/`, `src/middleware.ts`); expense import and transaction routes are absent.
- **Data:** absent for expenses — Supabase is used for auth, but no expense schema, migrations, or expense queries were found.
- **Auth:** present — signup, sign-in, sign-out, and protected dashboard flows exist (`src/pages/api/auth/`, `src/middleware.ts`).
- **Deploy / infra:** present — Wrangler config and GitHub Actions configure Cloudflare Workers preview and production deployment (`wrangler.jsonc`, `.github/workflows/ci.yml`). `tech-stack.md` says Pages, which conflicts with the repository’s Workers configuration; the configured repository path is Workers.
- **Observability:** partial — Wrangler Workers observability is enabled (`wrangler.jsonc`); no app-level telemetry or operations runbook was found.

## Foundations

### F-01: Owner-scoped expense storage contract

- **Outcome:** (foundation) establish the smallest verified contract for persisting expense records so each signed-in user can access only their own records across sessions.
- **Change ID:** owner-scoped-expense-storage
- **PRD refs:** Access Control; Non-Functional Requirements (financial-data isolation and persistence across sign-in sessions)
- **Unlocks:** S-01, S-02, and S-03 can persist and read expense data without weakening the PRD’s privacy and persistence guarantees.
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Establish only the ownership and persistence contract here; each user-facing slice must still integrate and exercise it end to end.
- **Status:** done

## Slices

### S-01: Import and review expenses

- **Outcome:** A signed-in user can import a supported CSV and review the saved transactions, with clear feedback when a file cannot be processed.
- **Change ID:** import-and-review-expenses
- **PRD refs:** US-01, FR-001, FR-002, FR-003, FR-004
- **Prerequisites:** F-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Which CSV headers and date/amount conventions define the single supported source? — Owner: user. Block: yes.
- **Risk:** No sample or format is specified, so a parser could appear complete while failing on the user’s actual export; existing account access should be reused, not rebuilt.
- **Status:** blocked

### S-02: View monthly category breakdown

- **Outcome:** A signed-in user can see imported transactions with assigned categories and a pie chart showing each category’s share of current-month expenses.
- **Change ID:** view-monthly-category-breakdown
- **PRD refs:** US-01, FR-005, FR-007, Non-Functional Requirements (chart readability)
- **Prerequisites:** S-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - For an unmatched transaction, should the displayed and charted category be “Other” as FR-005 says, or “not found” as the Business Logic section says? — Owner: user. Block: yes.
- **Risk:** Category assignment drives both the transaction table and chart; choosing one conflicting label without resolving the PRD would make the result ambiguous.
- **Status:** blocked

### S-03: Correct an expense category

- **Outcome:** A signed-in user can change a transaction’s category, see the current-month chart update, and have the corrected keyword/category association used on future imports.
- **Change ID:** correct-expense-category
- **PRD refs:** US-01, FR-005, FR-006, FR-007
- **Prerequisites:** S-02
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** A correction must persist both for the selected transaction and for later matching; otherwise the promised improvement to future imports is lost.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID | Suggested issue title | Ready for `/10x-plan` | Notes |
| --- | --- | --- | --- | --- |
| F-01 | owner-scoped-expense-storage | Establish private, persistent expense storage | yes | Run `/10x-plan owner-scoped-expense-storage` |
| S-01 | import-and-review-expenses | Import and review one CSV source | no | Resolve the supported CSV format first. |
| S-02 | view-monthly-category-breakdown | Show the current-month category breakdown | no | Resolve the unmatched-category behavior first. |
| S-03 | correct-expense-category | Correct a transaction category | no | Depends on S-02. |

## Open Roadmap Questions

None remain in the PRD (`## Open Questions` says “None”). Planning questions that affect only one slice are recorded under that slice’s Unknowns.

## Parked

- **Multiple CSV sources or bank integrations** — Why parked: the MVP is limited to one CSV source.
- **Cash-expense entry** — Why parked: excluded from this first monthly review.
- **History or comparisons between months** — Why parked: the MVP focuses on the current month.
- **Custom categories** — Why parked: excluded from the initial classification scope; reconsider if “Other” becomes too large.
- **Language-model-assisted categorization** — Why parked: the MVP uses keyword-based rules.
- **Mobile version** — Why parked: the MVP is a web application.

## Milestone History

None — this is the first milestone.

## Done

- **F-01: (foundation) establish the smallest verified contract for persisting expense records so each signed-in user can access only their own records across sessions.** — Archived 2026-09-28 → `context/archive/2026-09-24-owner-scoped-expense-storage/`. Lesson: —.
