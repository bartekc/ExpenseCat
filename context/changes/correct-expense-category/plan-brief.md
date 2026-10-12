# Correct expense category — Plan Brief

> Full plan: [plan.md](plan.md)

## What & Why

Deliver S-03: correct a saved expense category, refresh the monthly chart, and optionally remember a keyword for future categorization. Preserve manual exceptions even when rules change.

## Starting Point

Private expense storage, CSV import, ten fixed categories, keyword-rule CRUD and a Warsaw current-month chart already work. Categories are derived from current rules; there is no stored manual override or edit revision.

## Desired End State

Open one inline editor below an expense, choose a category and optionally type a matching phrase. Learning defaults on, but can be disabled for a one-off correction. Restore automatic mode without deleting learned rules; conflicts and uncertain saves retain the draft and require a fresh, explicit decision.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Phrase | User types a normalized-matching title fragment | Controls how broadly a rule applies | Plan, Q1 |
| Learning | Optional checkbox, on by default | Supports both learning and exceptions | Plan, Q2 |
| Existing rule | Same category reuses; different category requires explicit ID/revision-bound confirmation | Prevents silent replacement | Plan, Q3 |
| Reset | Clear the override, keep rules and revision history | Returns to automatic matching without changing other expenses | Plan, Q4 |
| Concurrent edits | Reject stale correction/reset versions | Protects newer decisions | Plan, Q5 |
| Lost response | Check current state before another write; no automatic retry | Avoids pretending the first save failed | Plan, Q6 |
| Placement | One inline editor under the selected expense | Keeps transaction context visible | Plan, Q7 |
| Impact | Explain existing/future effects; no preview counts/list | Keeps the MVP bounded | Plan, Q8 |
| Precedence | Manual override wins, including Other | Preserves explicit choices | S-02 plan |
| Automatic matching | Existing longest-phrase and ambiguity rules remain | Maintains established behavior | S-02 plan |

## Scope

**In scope:** durable correction/reset state, atomic optional learning, concurrency detection, authenticated APIs, inline form and coordinated refresh.

**Out of scope:** bulk changes, custom categories, keyword extraction, impact previews, historical charts, automatic retries, new test code/frameworks, CI/hook configuration and deployment.

## Architecture / Approach

A separate owner-protected correction-state table joins the shared classified view used by list and totals. Security-invoker RPCs commit correction and rule together. Database-assigned revisions detect stale forms and confirmations, including reset and rule recreation. The existing importer and monthly aggregate retain their roles.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Database and atomic correction contracts | Durable overrides/reset, revision protection, atomic learning and recovery reads | Isolation, partial writes and concurrency |
| 2. Correction API and conflict handling | Validated save/reset/check endpoints and correction-aware list metadata | Stale confirmations and uncertain outcomes |
| 3. Inline correction and coordinated refresh | One editor, conflict/reset/recovery flows and independent resource refresh | Losing drafts or displaying stale success |

**Prerequisites:** S-02 complete; Node 22.22.3, Docker/local Supabase and configured local production preview for gates. All eight decisions and this structure were approved on 2026-10-12.
**Estimated effort:** Medium multi-layer change across three implementation phases; concurrency and manual acceptance are the largest verification work. No calendar commitment.

## Open Risks & Assumptions

- A saved phrase may lose to a longer matching rule on future expenses; learning does not override the established matcher.
- Learned rules also change historical automatic assignments; manual corrections remain protected. A prior-month correction alone may leave the current-month chart unchanged.
- Reset can leave the displayed category unchanged because the retained rule still applies.
- A lost response cannot prove whether a request committed; recovery shows current state separately from the retained draft.
- Root AGENTS.md prohibits test-code authoring in this lesson. Existing suites are regression gates; new scenarios need manual evidence, with automated expansion reserved for the separate quality-contract rollout.

## Success Criteria (Summary)

- Corrections and optional rules persist privately and atomically; reset and re-import preserve the agreed behavior.
- Stale edits cannot silently replace newer corrections or changed rules; uncertain saves require checking state before another write.
- List, review flags and current-month totals reflect the same classification, with usable keyboard, narrow-screen and error/retry flows.

## References

- [PRD](../../foundation/prd.md), [roadmap](../../foundation/roadmap.md), and [full plan contracts, sources and verification](plan.md#references).
