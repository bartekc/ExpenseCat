# Correct expense category Implementation Plan

## Overview

Deliver roadmap S-03: a signed-in user corrects one saved expense, optionally remembers a matching keyword rule, sees refreshed categories and current-month totals, and can restore automatic categorization. Preserve private data, the existing matcher, and import identity.

The user approved eight decisions and three phases on 2026-10-12. This document specifies implementation; its unchecked Progress is not evidence of completed work. Planning researched HEAD `572a06bd0e94a63b81dfbc69a854df586f1fdb83`.

## Current State Analysis

- PRD US-01, FR-005–FR-007 and Business Logic require correction, learning, and chart refresh. Roadmap S-02 is complete; S-03 is proposed before this planning update.
- `supabase/migrations/20261005000000_add_expense_category_rules.sql:54` persists owner-scoped rules with a generated normalized keyword and owner/keyword uniqueness. No manual category or edit revision exists.
- `supabase/migrations/20261005000000_add_expense_category_rules.sql:96` computes categories in the security-invoker `expense_review` view. The aggregate reads that view at line 168; the paginated API reads it at `src/pages/api/expenses/index.ts:32`.
- S-02's approved plan explicitly reserves persistent manual precedence for S-03 (`context/archive/2026-10-05-view-monthly-category-breakdown/plan.md:35`). It also establishes live recategorization of existing automatic assignments and no silent duplicate-rule replacement.
- `src/lib/expenses/import.ts:31` inserts transaction fields with duplicate-ignore semantics. Re-import must continue to preserve existing records and corrections.
- Existing expense title constraints are NOT VALID and apply on later updates. A separate correction state avoids updating historical expense rows merely to change their category.
- `src/pages/api/category-rules/[id].ts:6` supplies the session/origin/UUID/RLS mutation pattern. `src/lib/expenses/rules.ts:68` bounds JSON before parsing; existing rule DTOs expose exactly three public fields.
- `src/components/expenses/ExpenseImportReview.tsx:51` suppresses stale reads. Its refresh coordinator at line 203 already refreshes rules, the visible expense page, and summary independently.
- Existing commands are `npm run test:unit`, `npm run lint`, `npx astro sync`, `npx astro check`, `npm run build`, `npm run smoke:storage`, and `npm run smoke`. CI and `.nvmrc` pin Node 22.22.3. Supabase/HTTP gates require local services; they were not run during planning.
- Root `AGENTS.md` forbids test-code authoring and new CI/hook/browser configuration in this lesson. Existing tests remain regression gates; new feature scenarios below require explicit manual evidence. A future risk-first test rollout owns automated expansion. No `context/foundation/test-plan.md` or `lessons.md` exists at planning time.
- Pre-existing modifications to `AGENTS.md` and `context/foundation/roadmap.md` belong to the user. Preserve their content; planning changes only S-03 status and the roadmap date.

## Desired End State

Every complete saved expense can open one inline category editor. Saving creates a persistent manual override, including a deliberate Other choice, with `needs_review=false` and no review reason. Manual overrides win over all rules until explicitly reset. The editor defaults to remembering a rule, but a user can turn that option off for a one-off exception.

| Decision | Agreed contract |
| --- | --- |
| 1. Learning phrase | User types a fragment; after the existing database normalization it must be a nonempty literal substring of the selected expense title. No automatic extraction or prefilled full title. |
| 2. Optional learning | Remember-rule checkbox defaults on for a newly opened editor. When off, save only the override and do not require or submit a keyword. |
| 3. Rule collision | Reuse an existing normalized keyword targeting the same category without changing it. A different category requires explicit confirmation showing old/new categories and historical impact, bound to the observed rule ID and revision. |
| 4. Restore automatic | Clear only the selected override, retain its revision history and all rules. The category may remain identical because the remembered rule still applies. |
| 5. Concurrent correction | A stale editor cannot overwrite a later correction or reset; return a conflict and require a refreshed, explicit decision. |
| 6. Uncertain response | Retain the draft, show that the result is unknown, and check authoritative current expense/rule state before allowing another write. No automatic mutation retry. |
| 7. Editor placement | Inline below the selected transaction; at most one editor open. |
| 8. Impact presentation | Explain the effects on existing/future automatic assignments and longest-phrase matching. Show old/new rule categories on conflict; no impact counts or preview list. |

Inherited rules remain: ten fixed categories; NFC, case-insensitive, accent-preserving literal substring matching with collapsed whitespace; longest normalized phrase wins; equal longest matches across categories yield Other/ambiguous. New learning can affect historical automatic assignments. It never overrides another transaction's manual category. A saved shorter phrase may lose to another longer phrase on future transactions; learning does not promise that every superficially similar title gets the selected category.

An expense outside the current Warsaw month remains editable. Its correction alone does not change this month's totals, but a learned rule can affect current-month automatic assignments. Reset never deletes a learned rule. A successful save followed by a failed summary refresh is presented as a saved correction with a separate refresh failure.

### Key Discoveries:

- One view controls both list and chart, so override precedence belongs there; no second matcher or chart-side category substitution is needed.
- Keeping a reset state row prevents an old editor from becoming current again after correction followed by reset.
- Existing rule PATCH and direct authenticated table writes must advance rule revisions. A database trigger covers both without changing the existing three-field rule API.
- A revision generated across rule inserts and updates also detects deletion/recreation with the same client-supplied rule ID. ID plus a per-row counter restarting at one is insufficient.
- The existing React resource loader hides superseded reads, but editor state must survive those loading cycles to retain conflict/uncertain-result drafts.

## What We're NOT Doing

- Bulk corrections, custom categories, automatic keyword extraction, regex/whole-word matching, priorities, or changing longest-match/tie behavior.
- Rule impact preview counts/lists, historical charts, chart filtering, or historical expense backfills.
- Removing learned rules when resetting, resetting other expenses, automatically resolving conflicts, background retries, or an operation-history/idempotency service.
- Changing transaction fields, import identity, CSV limits, authentication infrastructure, or existing category-rule CRUD duplicate semantics.
- Test-code authoring or edits to existing tests/smoke assertions, a new test framework, hooks/MCP configuration, CI YAML, production migrations, deployment, or archived documents. Automated coverage expansion belongs to the separate quality-contract rollout under `/10x-test-plan`.

## Implementation Approach

Use an additive migration with separate owner-protected correction state, database-assigned revisions, an atomic correction RPC, a reset RPC, and a read-only state-check RPC. Keep security-invoker execution and RLS. Join state into `expense_review`, preserving its existing columns and appending correction metadata; existing summary SQL then uses the effective category automatically.

Expose bounded, authenticated correction endpoints through the existing session client. Keep the base `Expense` and category-rule DTO contracts compatible; introduce stricter correction-aware types and validators in a focused helper. The dashboard uses those for current list/editor responses. Existing tests and old explicit-column API consumers remain valid.

The inline editor owns a draft anchored to an expense ID and observed revision. Successful mutations refresh all three resources, preserve the expense page, and clear confirmation tokens. Conflicts and uncertain outcomes preserve user input and require an authoritative check plus deliberate user action.

## Critical Implementation Details

### Revision lifetime and transaction boundaries

Versions are database-assigned positive bigint tokens transported as decimal strings; absence of correction state is represented by `"0"`. Reset retains the state row. Assign new sequence-derived tokens on every rule/state INSERT and UPDATE, ignore caller-supplied versions, deny correction-state DELETE and changes to its expense identity, and do not permit callers to reset the sequence.

### Atomicity under competing writes

Lock the owned expense without updating it, then validate the submitted revision and rule decision. Conditional final state UPDATE by expected revision, or an INSERT for expected absence, must detect even direct table-write races; a conflict after any rule mutation must raise and roll back the whole operation, never return an ordinary error object that commits partial writes. Use a consistent expense → rule → correction-state order in RPCs; revision triggers must not acquire a reverse parent lock.

### Confirmation and recovery

A rule confirmation authorizes only the exact observed ID/revision for the current submitted phrase/category. Any draft change, rule revision change, deletion/recreation, refreshed conflict, reset, or editor switch invalidates it; even a now-same-category rule cannot make a stale confirmation valid. An unknown transport/response outcome is not a confirmed rollback: checking state reports what exists now, without claiming to prove which request caused it.

## Phase 1: Database and atomic correction contracts

### Overview

Persist manual state and provide owner-safe atomic writes and authoritative reads while leaving existing expense writes and deployed clients compatible.

### Changes Required:

#### 1. Durable correction state and revision generation

**File**: `supabase/migrations/<new-timestamp>_add_expense_category_corrections.sql`.

**Intent**: Make corrections durable and detect stale decisions across correction/reset cycles and rule edits without rewriting transaction data.

**Contract**: Add `public.expense_category_corrections(expense_id, category_code, revision)`: one row per expense, cascading expense foreign key, nullable fixed-category foreign key, positive database-assigned revision. Null category means automatic mode after reset. No row also means automatic mode but revision zero. RLS SELECT/INSERT/UPDATE must require an expense owned by `auth.uid()`; update USING and WITH CHECK protect both old/new rows. Expense identity is immutable. Authenticated callers receive only SELECT/INSERT/UPDATE, no DELETE/TRUNCATE; anon/PUBLIC have no access. Parent deletion may cascade normally.

**Contract**: Add a revision column to existing rules and initialize existing rules safely. A database trigger on rule/state INSERT and every UPDATE assigns a fresh sequence-derived bigint, regardless of supplied values; it enforces correction identity immutability. Narrow sequence grants allow allocation, not `setval`. Revisions are opaque equality tokens, not timestamps or consecutive per-expense counters. Existing rule IDs, raw phrases, normalization, constraints, policies, and CRUD payloads remain intact.

#### 2. Atomic correction and automatic reset

**File**: the new migration.

**Intent**: Commit the selected override and optional rule together, or leave both unchanged when validation, confirmation, or concurrency fails.

**Contract**: `public.correct_expense_category(p_expense_id uuid, p_expected_revision text, p_category_code text, p_learn_rule boolean, p_keyword text, p_confirm_rule_id uuid, p_confirm_rule_revision text)` is a volatile security-invoker mutation with empty search path, schema-qualified relations, and authenticated-only EXECUTE. It accepts no owner parameter. Validate auth, an owned complete expense, canonical bounded revision text, category, and legal argument combinations. Both confirmation fields are either present or absent. No learning requires null keyword and null confirmation fields.

**Contract**: Lock the owned expense row using SELECT FOR UPDATE, not a dummy UPDATE. With learning enabled, validate raw/normalized keyword lengths of 1–1,024 UTF-8 bytes, nonblank content, and normalized literal substring membership against the locked title. Reuse the existing database normalizer. Never modify the saved title.

**Contract**: Evaluate every existing candidate rule under a row lock held through the transaction, including same-category reuse. With no confirmation, absent exact-normalized rule creates a rule; an existing same-category rule is reused unchanged; a different category raises a rule-confirmation conflict carrying only the owner's current rule ID/raw keyword/category/revision. With confirmation, require the matching locked rule's exact ID and revision before any mutation, then update only its category. Preserve its raw keyword. A concurrent absent-rule insertion produces a conflict and full rollback, not an implicit upsert or hidden retry. The owner/normalized-key uniqueness constraint remains authoritative.

**Contract**: Complete with a revision-conditional correction-state write, returning the new state metadata and effective expense. On stale revision, failed conditional write, or conflicting initial INSERT, raise an expense conflict and roll back any rule write. Same-category corrections are valid, including turning Other/unmatched into deliberate manual Other. A successful save issues a new state revision even if the manual category text is unchanged.

**Contract**: `public.reset_expense_category(p_expense_id uuid, p_expected_revision text)` follows the same auth, ownership, locking and compare-and-write discipline. Write null category with a fresh revision and keep the state row; never touch rules. Reset of already automatic state is allowed only with the current revision and remains automatic. Missing, foreign-owned and incomplete expenses share a not-found outcome.

#### 3. Shared classified reads and recovery state

**File**: the new migration.

**Intent**: Make list, chart, editor and recovery agree on the effective category and current revision.

**Contract**: Replace `expense_review` without dropping dependent objects: preserve existing column order/types, security_invoker and grants, and append `manual_category_code` and `correction_revision` (decimal text). Non-null override supplies the category and clears review flags; null/no state uses the unchanged matcher. Absent state has revision `"0"`. Exclude incomplete legacy rows as before. `get_expense_category_totals` retains its signature, ten-row order, exact cent totals and owner/date boundaries.

**Contract**: `public.get_expense_correction_state(p_expense_id uuid, p_keyword text default null)` is a stable security-invoker read RPC. In one read statement return the owned effective expense with correction metadata and, when a bounded valid keyword is supplied, the owner's exact-normalized rule or null. This lookup must not search only one paginated rules page. Return no owner IDs or foreign data. It creates no state and changes no rule. Invalid keywords fail validation; a missing/foreign/incomplete expense is not found. Conflict/read payloads must cast bigint revisions to text before JSON serialization.

### Success Criteria:

#### Automated Verification:

- Additive migration applies to local Supabase without resetting existing data: `npx supabase migration up --local`.
- Existing storage regression gate passes unchanged: `npm run smoke:storage`.
- Existing unit regression gate passes unchanged: `npm run test:unit`.

#### Manual Verification:

- Using two authenticated synthetic users and anon, verify correction-state/RPC isolation, denied delete/identity transfer/revision spoofing, owned complete-expense checks, and unchanged transaction fields.
- Verify correction-only, new rule, same-category reuse, confirmed different-category replacement, literal normalized title validation, deliberate Other, manual precedence, reset retaining rules, and matching list/aggregate results.
- Exercise concurrent correction/reset, stale rule confirmation including edit-back and delete/recreate, and a concurrent new-rule collision; rejected operations leave neither a partial rule change nor a partial correction.
- Check representative local 10,000-expense/100-rule reads with mixed manual/automatic state; record runtime, complete counts and exact totals, and verify old explicit-column reads/import writes remain compatible.

**Implementation Note**: Existing suites cover regressions, not the new concurrency/security contracts. Record new-scenario manual evidence in change.md notes and obtain human confirmation before completing the phase.

---

## Phase 2: Correction API and conflict handling

### Overview

Expose the database contract through bounded session-authenticated endpoints with validated results and explicit conflict/recovery semantics.

### Changes Required:

#### 1. Correction-aware contracts

**File**: `src/lib/expenses/corrections.ts` (new); reuse `contracts.ts`, `categories.ts`, `rules.ts` without weakening their existing validators.

**Intent**: Share precise mutation, read and error shapes between routes and UI while preserving existing DTOs.

**Contract**: Define `CorrectableExpense` as the existing Expense plus `manual_category_code` (known code or null) and `correction_revision` (canonical nonnegative bigint decimal text). A non-null manual category must equal the effective category and imply no review flag. Correction-aware page validation composes the current page validator and validates every metadata pair; do not make old unit fixtures or base Expense consumers require new fields. The new list route/UI use the stricter validator.

**Contract**: Correction input is exactly `{category_code, expected_revision, learn_rule, keyword?, rule_confirmation?}`. The revision is canonical decimal text in PostgreSQL bigint range, not a JavaScript number. Learning true requires a nonblank bounded keyword; false forbids keyword/confirmation. Confirmation contains exactly `{id, revision}` with a UUID and positive revision. Reset input is exactly `{expected_revision}`; check input is `{keyword?}`. Reject unknown fields, arrays, malformed UTF-8, NUL and invalid combinations. Read at most 16 KiB before JSON parsing; JSON content type is required.

**Contract**: State response is `{expense: CorrectableExpense, rule: {id, keyword, category_code, revision} | null}`. A check without keyword returns null rule. Correction success returns the committed expense and created/reused/updated rule, or null with learning off; reset success returns the automatic expense and null rule, without implying that learned rules were deleted. Map validated database conflicts to 409 codes `expense_conflict`, `rule_confirmation_required`, `rule_conflict`; validation and not-found outcomes map to 400 and 404. Unknown/malformed database details remain generic failures, never trusted success.

#### 2. Authenticated routes and categorized list

**Files**: `src/pages/api/expenses/[id]/category.ts` (new), `src/pages/api/expenses/[id]/category/reset.ts` (new), `src/pages/api/expenses/[id]/category/check.ts` (new), `src/pages/api/expenses/index.ts`.

**Intent**: Supply editor initialization, atomic save, automatic reset and explicit recovery without spreading a logical save across HTTP writes.

**Contract**: GET `/api/expenses/:id/category` loads state without a keyword. PATCH on the same URL corrects and optionally learns. POST `/api/expenses/:id/category/reset` restores automatic mode. POST `/api/expenses/:id/category/check` is read-only, but accepts an optional phrase in a bounded JSON body so it need not be placed in a URL. All endpoints authenticate, validate UUIDs, use the existing session client and return no-store. POST/PATCH require exact same-origin Origin; do not accept owner IDs or use a service-role client.

**Contract**: Success is 200 with validated state. Errors retain 401 auth, 403 origin, 400 input, 404 absent/foreign/incomplete expense, 409 conflict, 413 oversized body, 503 unavailable client, and generic 500 unexpected failure. A rule confirmation conflict includes the current rule snapshot, not hidden normalized keys or unrelated data. Stale tokens never authorize replacement. Routes must not perform independent rule and state writes; use one mutation RPC.

**Contract**: GET `/api/expenses?page=N` adds the two view metadata fields and validates correction-aware rows. Keep the existing envelope, all-date ordering, page size, privacy and duplicate-import behavior. Summary API needs no new format or browser-side recomputation. Category-rule CRUD responses stay three-field and continue rejecting duplicates as before.

#### 3. Developer guidance

**File**: `README.md`.

**Intent**: Describe the new endpoint contracts, default learning, explicit confirmation, revision handling, reset and recovery so callers can use them correctly.

**Contract**: Document that learned rules apply to existing and future automatic assignments, manual overrides survive rule CRUD/re-import, and checking state after a lost response does not establish causal proof of a particular request. Identify existing regression gates and the new manual acceptance cases; do not claim automated coverage that was not added.

### Success Criteria:

#### Automated Verification:

- Existing unit suite passes without altered expectations or test edits: `npm run test:unit`.
- Lint and type checks pass: `npm run lint`, `npx astro sync`, and `npx astro check`.
- Production build passes on Node 22.22.3: `npm run build`.
- Existing storage and HTTP regression gates pass against local Supabase and production preview: `npm run smoke:storage` and `npm run smoke`.

#### Manual Verification:

- Exercise GET/PATCH/reset/check with owned, foreign and missing IDs; invalid fields/revisions/keywords, absent auth, wrong Origin, invalid UTF-8 and bodies above 16 KiB return the documented results without leaking data.
- In two sessions of one user, verify 409 correction conflicts and confirmation tokens, same-category reuse, keyword mismatch rejection, and full rollback; a second owner cannot read or mutate that state.
- Verify check-after-uncertain-save returns current expense and exact matching rule beyond the first rule page; totals, all-date pagination, re-import and sign-out/sign-in preserve the agreed results.

**Implementation Note**: Obtain human confirmation of the API cases before marking the phase complete. Do not treat unchanged HTTP smoke as proof of the new endpoints.

---

## Phase 3: Inline correction and coordinated refresh

### Overview

Deliver the complete dashboard flow with one inline draft, explicit confirmation, reset and recovery, and truthful independent refresh states.

### Changes Required:

#### 1. Focused inline editor

**Files**: `src/components/expenses/ExpenseCategoryEditor.tsx` (new), `src/components/expenses/ExpenseImportReview.tsx`.

**Intent**: Let the user correct an expense in context, using existing labels, buttons, alerts and focus conventions.

**Contract**: Each expense has an accessible correction action. Open exactly one editor below the selected row, initialize from a fresh GET state, preselect its current category, default learning on, and start with an empty phrase. Show title/date/amount and whether the category is manual. Provide labelled fixed-category select, checkbox, conditional phrase input, Save and Cancel; offer Restore automatic only for a manual override. Manual Other and saving the same displayed category are valid.

**Contract**: Store draft/selection independently of fetched list visibility so refreshes do not discard input. Prevent duplicate submissions synchronously and disable competing row switches, pagination and same-island mutations while a write is pending. Cancel/editor switch is an explicit draft discard, with focus returned to the initiating control; aborting a request is never described as undoing a server write. Preserve input on known validation failures.

**Contract**: A rule collision displays its phrase, old and requested category and impact explanation, with Confirm replacement and Back actions. Confirmation is valid only for the unchanged draft and observed tokens. Any field change clears it. A stale correction/rule conflict blocks Save until a successful check shows current state; preserve the draft and require explicit review before using the fresh revision. Never silently rebase and resubmit.

#### 2. Reset and uncertain-result recovery

**Files**: the editor and `src/lib/expenses/corrections.ts` as needed for shared state validation.

**Intent**: Make reset predictable and prevent misleading retries after a response is lost.

**Contract**: Restore automatic submits the observed revision, does not learn/delete a rule, and explains that the effective category may stay the same. On network failure, unexpected 5xx or malformed success response, preserve the draft in an uncertain-result state, clear confirmation and block further writes until Check current state succeeds. Do not automatically retry mutations. A failed check keeps writes blocked while allowing another check or leaving the editor.

**Contract**: Check reads the current expense plus exact-normalized rule when the draft requests learning, displays current persisted values separately from the draft, and refreshes the three resources. Invalid keyword input must remain editable; an expense-only check can refresh state, but saving learning remains disabled until the draft is valid and its current rule state is checked. Do not infer that the original request succeeded solely because categories match; communicate observed current state. The user can close when satisfied or explicitly submit a revised decision from the refreshed revision.

#### 3. Dashboard refresh and copy

**Files**: `src/components/expenses/ExpenseImportReview.tsx`, `src/components/expenses/CategoryRulesPanel.tsx`, `README.md`; reuse existing `MonthlyCategoryBreakdown.tsx` and shared CSS classes.

**Intent**: Show the persisted result consistently without rewriting the chart or losing the user's place.

**Contract**: Confirmed correction/reset refreshes rules, the current expense page, and summary without resetting the expense page. Keep mutation success separate from each resource's loading/error/retry. Successful recovery checks also refresh resources. Preserve the existing import page-one behavior and stale-response suppression. List items show a manual marker when metadata is non-null; the chart remains non-interactive and driven by the complete database aggregate.

**Contract**: Update existing copy that says rules apply to every expense: rules affect automatic assignments, while manual corrections have precedence. Explain historical/future rule effects and longest-phrase/tie behavior, without impact counts. An old-date correction may leave this month's chart unchanged; learning may still alter current-month automatic totals. Rule-panel CRUD can refresh while a draft exists, but cannot silently replace its draft/revision/confirmation; the server arbitrates conflicts.

### Success Criteria:

#### Automated Verification:

- Existing unit, lint and type gates pass: `npm run test:unit`, `npm run lint`, `npx astro sync`, and `npx astro check`.
- Production build passes on Node 22.22.3: `npm run build`.
- Existing storage and HTTP regression gates pass against the local production preview: `npm run smoke:storage` and `npm run smoke`.

#### Manual Verification:

- By keyboard at narrow and desktop widths, open one inline editor, save with/without learning, confirm a conflicting rule, cancel and restore automatic; labels, focus, pending controls and announcements remain usable.
- With synthetic current/prior-month data, verify manual markers, deliberate Other, longest-rule and tie behavior after reset, unchanged total spending, correct category redistribution, all ten legend rows, retained pagination and persistence across re-import/sign-out/sign-in.
- Use two tabs plus network interruption to verify stale corrections and confirmations, uncertain save/check/retry, retained drafts and independent refresh failures; no automatic retry, stale-response overwrite or partial-write success is presented.

**Implementation Note**: Human confirmation of hydrated behavior is required; existing smoke checks only regressions and SSR/API paths already covered before this change.

## Testing Strategy

### Unit Tests:

Run the existing expense suite unchanged. The base Expense/rule contracts and helpers retain compatibility. New correction-aware validators must be exercised manually for the exact field combinations, revision bounds and manual/automatic invariants above; no new test files or assertion edits are authorized under the current lesson boundary. Capture these scenarios as inputs to the later `/10x-test-plan` quality rollout rather than claiming unit coverage now.

### Integration Tests:

Run existing storage/HTTP smoke against isolated local synthetic data. New acceptance verification covers owner A/B and anon; manual precedence in list and aggregate; correction-only rule immutability; new/reused/replaced rule outcomes; normalized accented/whitespace/literal punctuation fragments; invalid fragments and byte limits; reset with retained rule; stale state after correct/reset; stale rule after edit-back/delete-recreate; concurrent missing-rule insertion; direct owner writes advancing revision; rollback of rule writes when final correction CAS loses; totals beyond one page; prior-month exclusion and duplicate re-import.

These new cases are a manual verification specification, not automated test code. Record actual results and unrun cases honestly in change.md notes. Do not configure CI or add a browser runner; the existing CI gates remain available. A deliberate-break test is not applicable to this change because it authors no tests.

### Manual Testing Steps:

1. Import synthetic current/prior-month expenses with two owners. Record transaction IDs, original fields and initial category totals.
2. Correct an unmatched expense with learning off: only its manual category changes. Correct another with an explicit matching phrase: a rule appears and other automatic matches follow existing precedence.
3. Reuse a same-category phrase; then choose a conflicting category. Verify no write occurs before confirmation, cancellation writes nothing, confirmation updates the existing rule, and manual overrides remain protected.
4. Reject a nonmatching phrase; accept normalized whitespace/case variants while preserving accents and treating percent/underscore as literal characters. Validate deliberate manual Other without a review flag.
5. Reset an override and verify the rule remains. An older editor opened before correction/reset must conflict even when the effective category returns to its original value.
6. Race two saves and separately mutate/delete/recreate a confirmed rule. Verify conflicts and atomic rollback, including rule work preceding a failed final state write.
7. Interrupt the save response, then restore connectivity and check state. Distinguish current persisted state from draft; require explicit action to save again. Separately fail a summary refresh after a successful save.
8. Verify current-month totals and all-date reachability, persistence after sign-in, duplicate re-import, keyboard/focus behavior and narrow layout. Clean up only the synthetic data created for verification.

## Performance Considerations

Keep a one-to-one correction join indexed by expense ID and an indexed owner/normalized-key rule lookup. The aggregate continues to count the entire date interval in the database; never fetch a whole month into the browser or issue per-row state requests for all displayed rows. Load detailed editor state only for the selected expense. Sequence tokens may have gaps; do not add sequential-number repair or audit-history tables.

Use short transaction-scoped locks; never hold a transaction while awaiting the user's confirmation. A confirmation is a new request with expected tokens. The phase-1 representative query inspection establishes observed performance without inventing a production latency guarantee.

## Migration Notes

- Use a new timestamp after `20261005000000`. Do not edit old migrations or reset a populated database. Add correction state and initialize rule revisions; do not backfill or update expense transaction fields.
- Preserve the old view columns, grants and dependencies when appending metadata. Old Worker explicit selects and three-field rule responses must work after the migration and before the new Worker arrives.
- Functions use caller privileges with explicit grants/RLS; correction state is not RPC-only because security-invoker writes need underlying privileges. Direct owner DML may bypass UI compare-and-write, but must preserve ownership/identity and advance revision so application writes cannot miss the change.
- Run local gates on Node 22.22.3. The previously verified Windows binary is `C:/Users/Bartek/AppData/Roaming/nvm/v22.22.3/node64.exe`; verify it still exists before using it. Start local Supabase only with Docker available and preserve existing config/credentials. Use `npm run preview -- --port 4321` plus matching `BASE_URL` for HTTP smoke. Missing services are unrun gates, not passes.
- On rollback, roll back application code first and retain additive state/rules/revisions. Do not discard user corrections or reset revision sequences. Production migration/deployment is outside this plan's implementation run.
- Context artifacts are ignored by the repository. First implementation staging must explicitly include this change folder as required by the implementation skill, without sweeping in unrelated files. The roadmap had pre-existing edits; preserve them and follow its dirty-file staging rule.

## References

- Requirements: `context/foundation/prd.md` (US-01, FR-005–FR-007, Business Logic, Access Control); `context/foundation/roadmap.md` (S-03).
- Inherited decisions: `context/archive/2026-10-05-view-monthly-category-breakdown/plan.md:35`; prior verification limits: its `reviews/impl-review.md`.
- Database: `supabase/migrations/20261005000000_add_expense_category_rules.sql:54`, `:96`, `:138`; legacy update constraints: `20261002000000_limit_expense_title_bytes.sql` and `20261002000001_reject_whitespace_only_expense_titles.sql` in the same directory.
- Application contracts: `src/lib/expenses/contracts.ts:28`, `src/lib/expenses/rules.ts:68`, `src/pages/api/category-rules/[id].ts:6`, `src/pages/api/expenses/index.ts:32`, `src/lib/expenses/import.ts:31`.
- UI integration: `src/components/expenses/ExpenseImportReview.tsx:51`, `:203`, `src/components/expenses/CategoryRulesPanel.tsx`, `src/components/expenses/MonthlyCategoryBreakdown.tsx`.
- Gates and lesson boundary: `package.json`, `.github/workflows/ci.yml`, `.nvmrc`, root `AGENTS.md`.
- [PostgreSQL 17 explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html): transaction-scoped row locks and consistent lock order.
- [PostgreSQL 17 trigger behavior](https://www.postgresql.org/docs/17/trigger-definition.html): database-assigned write metadata and rollback on trigger failure.
- [PostgreSQL 17 CREATE VIEW](https://www.postgresql.org/docs/17/sql-createview.html): caller-permission views and compatible replacement.
- [Supabase database functions](https://supabase.com/docs/guides/database/functions): security-invoker execution, fixed search paths and explicit function privileges. Primary documentation checked 2026-10-12.

## Progress

> Convention: unchecked means pending; checked means verified. Append the closing commit SHA when a step lands. Do not rename step titles.

### Phase 1: Database and atomic correction contracts

#### Automated

- [x] 1.1 Additive migration applies to local Supabase without resetting existing data: `npx supabase migration up --local`. — b75c4ad
- [x] 1.2 Existing storage regression gate passes unchanged: `npm run smoke:storage`. — b75c4ad
- [x] 1.3 Existing unit regression gate passes unchanged: `npm run test:unit`. — b75c4ad

#### Manual

- [x] 1.4 Using two authenticated synthetic users and anon, verify correction-state/RPC isolation, denied delete/identity transfer/revision spoofing, owned complete-expense checks, and unchanged transaction fields. — b75c4ad
- [x] 1.5 Verify correction-only, new rule, same-category reuse, confirmed different-category replacement, literal normalized title validation, deliberate Other, manual precedence, reset retaining rules, and matching list/aggregate results. — b75c4ad
- [x] 1.6 Exercise concurrent correction/reset, stale rule confirmation including edit-back and delete/recreate, and a concurrent new-rule collision; rejected operations leave neither a partial rule change nor a partial correction. — b75c4ad
- [x] 1.7 Check representative local 10,000-expense/100-rule reads with mixed manual/automatic state; record runtime, complete counts and exact totals, and verify old explicit-column reads/import writes remain compatible. — b75c4ad

### Phase 2: Correction API and conflict handling

#### Automated

- [x] 2.1 Existing unit suite passes without altered expectations or test edits: `npm run test:unit`. — 9cc3f64
- [x] 2.2 Lint and type checks pass: `npm run lint`, `npx astro sync`, and `npx astro check`. — 9cc3f64
- [x] 2.3 Production build passes on Node 22.22.3: `npm run build`. — 9cc3f64
- [x] 2.4 Existing storage and HTTP regression gates pass against local Supabase and production preview: `npm run smoke:storage` and `npm run smoke`. — 9cc3f64

#### Manual

- [x] 2.5 Exercise GET/PATCH/reset/check with owned, foreign and missing IDs; invalid fields/revisions/keywords, absent auth, wrong Origin, invalid UTF-8 and bodies above 16 KiB return the documented results without leaking data. — 9cc3f64
- [x] 2.6 In two sessions of one user, verify 409 correction conflicts and confirmation tokens, same-category reuse, keyword mismatch rejection, and full rollback; a second owner cannot read or mutate that state. — 9cc3f64
- [x] 2.7 Verify check-after-uncertain-save returns current expense and exact matching rule beyond the first rule page; totals, all-date pagination, re-import and sign-out/sign-in preserve the agreed results. — 9cc3f64

### Phase 3: Inline correction and coordinated refresh

#### Automated

- [x] 3.1 Existing unit, lint and type gates pass: `npm run test:unit`, `npm run lint`, `npx astro sync`, and `npx astro check`. — 68a75d9
- [x] 3.2 Production build passes on Node 22.22.3: `npm run build`. — 68a75d9
- [x] 3.3 Existing storage and HTTP regression gates pass against the local production preview: `npm run smoke:storage` and `npm run smoke`. — 68a75d9

#### Manual

- [x] 3.4 By keyboard at narrow and desktop widths, open one inline editor, save with/without learning, confirm a conflicting rule, cancel and restore automatic; labels, focus, pending controls and announcements remain usable. — 68a75d9
- [x] 3.5 With synthetic current/prior-month data, verify manual markers, deliberate Other, longest-rule and tie behavior after reset, unchanged total spending, correct category redistribution, all ten legend rows, retained pagination and persistence across re-import/sign-out/sign-in. — 68a75d9
- [x] 3.6 Use two tabs plus network interruption to verify stale corrections and confirmations, uncertain save/check/retry, retained drafts and independent refresh failures; no automatic retry, stale-response overwrite or partial-write success is presented. — 68a75d9
