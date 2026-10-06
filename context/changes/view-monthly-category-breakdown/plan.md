# View monthly category breakdown Implementation Plan

## Overview

Deliver roadmap slice S-02: a signed-in user manages private keyword-to-category rules, sees saved expenses with effective categories, and reads a pie chart of current-month PLN spending. Build on the completed import/review flow rather than changing CSV parsing, ownership, or duplicate semantics.

The user approved an expanded twelve-question interview and the three phases below on 2026-10-05. This plan is an implementation contract, not evidence that implementation or verification has already happened.

## Current State Analysis

- F-01 and S-01 are done; S-02 is ready in `context/foundation/roadmap.md:46`. No active change folder, category schema, matching service, rule editor, or chart existed before this planning session.
- `public.expenses` has owner-scoped CRUD policies (`supabase/migrations/20260924000000_create_owner_scoped_expenses.sql:7`), nullable legacy transaction fields, negative amounts, PLN currency, and an owner/date/amount/title unique key (`supabase/migrations/20260929000000_add_expense_transaction_fields.sql:1`).
- `src/lib/expenses/import.ts:31` builds owner-bound rows and ignores duplicate conflicts. It does not overwrite saved transactions. The parser's 2 MiB, 10,000-row, negative-PLN, encoding, and title bounds remain unchanged.
- `src/pages/api/expenses/index.ts:4` returns 50 all-date rows per page, excludes incomplete legacy rows, and orders by operation date, creation time, then ID descending.
- `src/components/expenses/ExpenseImportReview.tsx:115` owns the React island's import and paginated review state. Requests are abortable; successful imports refresh the list. `src/pages/dashboard.astro:30` mounts this island.
- `src/lib/supabase.ts:5` uses the existing session and anon/publishable API key. New APIs must independently check authentication; dashboard middleware protection does not protect API routes.
- Supabase PostgreSQL is version 17 and its Data API row cap is 1,000 (`supabase/config.toml:18`, `supabase/config.toml:36`). There is no chart or browser-test library installed.
- CI already runs unit, lint, Astro, build, storage-RLS, and HTTP smoke gates on Node 22.22.3 (`.github/workflows/ci.yml:18`, `.github/workflows/ci.yml:38`).
- Pre-existing edits to AGENTS.md and foundation documents are not implementation work for this change. Preserve them; do not stage unrelated paths without explicit inclusion.

## Desired End State

The dashboard retains CSV import and the newest-first, all-dates expense table. It adds a keyword-rule panel, a category and separate review state on each row, and a clearly labelled current-month spending chart for Europe/Warsaw. The legend always lists all ten categories, including zero amounts and percentages; selecting the chart never filters the table.

Rules and transactions persist across sign-out/sign-in. Automatic categories reflect the owner's current rules for both existing and future imports. With no rules, complete expenses appear as Other and need review; configuring rules is not a prerequisite for importing.

| Decision | Agreed contract |
| --- | --- |
| Categories | Groceries, Eating out, Transport, Housing & bills, Household, Health, Clothing, Shopping, Leisure, Other; fixed in this order. |
| Rule setup | A dashboard panel supports adding, editing, and deleting the signed-in user's rules; no pre-seeded merchant associations. |
| Matching | Case-insensitive literal substring; accents remain significant. Trim and collapse whitespace in both keyword and title for matching only. |
| Winner | The longest normalized matching keyword wins, measured in Unicode characters. Ignore shorter matches; never use creation order or ID as a category tiebreak. |
| Equal longest matches | If all longest matches target the same category, use it. If their categories differ, use Other with review reason ambiguous. |
| Existing expenses | Adding, editing, or deleting a rule recalculates automatic assignments across all saved complete expenses, not just the displayed page or current month. |
| Future manual corrections | S-03 owns persisted manual overrides and must give them precedence over automatic rules; no manual override exists or is implemented in this slice. |
| Other | A deliberate rule match to Other is categorized and does not need review. No match uses Other with review reason unmatched. |
| Duplicate rules | A normalized keyword is unique per owner, regardless of category. Reject duplicates and tell the user to edit the existing rule; never replace implicitly. |
| Month | Current calendar month in Europe/Warsaw, selected by transaction_date, with an inclusive first date and exclusive next-month first date. |
| Table period | Retain all saved dates and existing pagination; explicitly distinguish its period from the chart. |
| Chart | Non-interactive pie chart of positive spending magnitudes; all ten legend rows show PLN amounts and percentages, including zeros. |

### Key Discoveries:

- Rule-based classifications can be derived at read time, satisfying recalculation without historical category backfills or import rewrites.
- Existing title constraints are NOT VALID but apply to updates (`supabase/migrations/20261002000000_limit_expense_title_bytes.sql:1`, `supabase/migrations/20261002000001_reject_whitespace_only_expense_titles.sql:1`). A blanket category update could fail on older records; this design never updates their transaction fields.
- PostgreSQL invoker views/functions can retain callers' base-table permissions and RLS. An ordinary owner-privileged view is not an acceptable substitute.
- Database aggregation is necessary: summing the visible table or fetching one capped Data API response would omit expenses.
- The existing React island, status/alert patterns, and CI smoke scripts can be extended. Pure helpers can use Vitest without introducing a DOM-test framework.

## What We're NOT Doing

- Manual per-expense correction, keyword learning from corrections, or a working correction button: these belong to S-03.
- Custom categories, rule priorities, regex/whole-word matching, accent removal, AI classification, or seeded bank/merchant rules.
- Historical charts, selecting another month, month comparisons, chart drill-down, or expense-table period/category filters.
- Changing CSV formats, positive-amount handling, currency, duplicate identity, transaction titles, upload limits, or import result counters.
- Authentication redesign, service-role access, production migrations during implementation, deployment/secret cleanup, or rewriting archived changes.
- A chart dependency, new browser-test framework, background recategorization jobs, execution-state sidecars, or speculative manual-override columns.

## Implementation Approach

Persist a read-only fixed category catalogue and owner-scoped keyword rules in Supabase. Expose effective automatic classification through one shared, non-materialized, security-invoker expense review view. Both the paginated review API and the aggregate RPC read that same classification, preventing matcher drift.

Rule mutations change only rules. The next read immediately recalculates categories for all existing and new expenses, so no backfill, import-time category cache, or reclassification job is required. Keep this view as S-03's future override-precedence seam; do not claim manual correction is already supported.

The API derives the Warsaw month once per summary request and calls a security-invoker SQL aggregate with date bounds, never an owner supplied by the client. SQL sums numeric amounts exactly and returns positive integer-cent totals as decimal strings. The UI uses integer-safe money formatting and bounded numeric ratios only for percentage/geometry presentation.

Use the existing dashboard island as the refresh coordinator and extract focused rule-panel/chart components. A static SVG pie plus a complete textual legend meets the chosen scope without another dependency.

## Critical Implementation Details

### Ownership and privileges

Every new exposed table needs explicit grants and RLS; catalogue reads are authenticated and its writes are migration-only. The review view must use security_invoker=true; functions must be SECURITY INVOKER with schema-qualified relations and restricted execution grants. Revoke inherited PUBLIC/anon access rather than assuming a missing policy protects functions.

### Normalization is not transaction identity

The database normalizer is authoritative for matching and rule uniqueness. Use NFC canonical normalization without accent folding, case normalization that covers Polish letters, and an explicit whitespace set covering ordinary spaces, tabs/newlines, non-breaking spaces, Unicode White_Space, and U+FEFF; collapse runs to one ASCII space and trim. Do not apply this to saved titles, amount canonicalization, or the existing transaction duplicate key.

### Recalculation and refresh

A successful rule mutation is committed before refreshing the table and summary. An aborted or superseded response must not replace newer data. These are fresh reads rather than a cross-request snapshot; show loading/retry states instead of presenting stale results as the completed refresh.

## Phase 1: Database and classification contracts

### Overview

Establish the fixed category vocabulary, private rules, shared automatic classification, and uncapped period aggregation without changing existing expense writes.

### Changes Required:

#### 1. Fixed categories and private keyword rules

**Files**: `supabase/migrations/<new-timestamp>_add_expense_category_rules.sql`, `src/lib/expenses/categories.ts`, `src/lib/expenses/categories.test.ts`.

**Intent**: Define a stable vocabulary and durable user-authored rules. Enforce privacy and duplicate semantics in the database, including requests that bypass the application API.

**Contract**: `public.expense_categories(code, label, sort_order)` contains exactly these code/label pairs in order: groceries/Groceries, eating_out/Eating out, transport/Transport, housing_bills/Housing & bills, household/Household, health/Health, clothing/Clothing, shopping/Shopping, leisure/Leisure, other/Other. Authenticated users can read but cannot mutate this catalogue; anon has no access.

**Contract**: `public.expense_category_rules(id, owner_id, keyword, normalized_keyword, category_code, created_at)` uses a UUID ID, session-derived owner default, cascading auth-user ownership, a category foreign key, and database-generated normalized keyword. Owner-only SELECT/INSERT/UPDATE/DELETE policies include both USING and WITH CHECK for updates. Unique `(owner_id, normalized_keyword)` rejects same-owner duplicates but allows another owner the same phrase. Raw and normalized keyword must contain content and each fit 1,024 UTF-8 bytes; reject U+0000.

**Contract**: The TypeScript catalogue mirrors stable codes, labels, and display order. Test parity against the persisted catalogue; catalogue lookup is not a second categorization implementation.

#### 2. Authoritative normalizer and effective expense review

**File**: `supabase/migrations/<new-timestamp>_add_expense_category_rules.sql`.

**Intent**: Apply one deterministic matcher to both old and newly imported records, keeping display data and duplicate identity intact.

**Contract**: An immutable text normalizer supplies the generated unique key and literal substring matching. Use literal position/substring comparison, not an unescaped LIKE/ILIKE pattern or user regex. Normalized Unicode-character length determines specificity.

**Contract**: A read-only `public.expense_review` invoker view returns complete expense records and their existing sortable fields, plus `category_code`, `needs_review`, and `review_reason` (`unmatched`, `ambiguous`, or null). It considers only that expense owner's visible rules. A winning category, including an explicit Other match, has `needs_review=false`; unmatched/cross-category longest ties have Other and `needs_review=true`. Incomplete legacy records remain excluded exactly as in S-01.

#### 3. Exact period aggregation

**File**: `supabase/migrations/<new-timestamp>_add_expense_category_rules.sql`.

**Intent**: Calculate complete category totals before Data API limits apply, using the review view's classification.

**Contract**: `public.get_expense_category_totals(p_start_date date, p_end_date date)` is a read-only security-invoker RPC with no owner parameter. For a valid increasing, non-null date interval it returns exactly ten catalogue-ordered rows: `category_code`, `total_cents` (non-negative integer decimal text), `expense_count`, and `needs_review_count`. Filter `transaction_date >= start AND transaction_date < end`; compute spending from negative numeric amounts, coalesce empty sums to zero, and count each expense once. Reject invalid bounds. Revoke PUBLIC/anon EXECUTE and grant authenticated execution only.

#### 4. Persisted-contract verification

**Files**: `scripts/expense-storage-smoke.mjs`, `src/lib/expenses/categories.test.ts`.

**Intent**: Extend the existing real-database gate, rather than trusting mocked categorization alone.

**Contract**: Two authenticated users and anonymous requests exercise catalogue grants, owner-only rule CRUD/ownership transfer denial, same-owner normalized duplicate rejection, cross-owner keyword independence, matching and tie cases, legacy exclusion, current-rule recalculation, and exact aggregates. Verify 1,001 same-period expenses are all counted, out-of-period/foreign-owner rows are excluded, and rule changes do not alter stored transaction fields. Keep the existing expense schema/title/uniqueness assertions and fixture-owned cleanup.

### Success Criteria:

#### Automated Verification:

- New additive migrations apply locally without resetting data: `npx supabase migration up --local`.
- Expanded `npm run smoke:storage` passes catalogue, owner-isolation, normalized-rule uniqueness, matcher, recalculation, and 1,001-row aggregate cases.
- `npm run test:unit` passes fixed-catalogue checks and all existing parser/import tests.

#### Manual Verification:

- Review the migration and synthetic classification results against the agreed ten labels, tie behavior, and no-expense-backfill contract.
- Inspect a representative local 10,000-expense/100-rule query plan and record its observed runtime and result counts.

**Implementation Note**: After automated gates pass, obtain the human's manual confirmation before beginning phase 2. Record completion only in the canonical Progress section.

---

## Phase 2: Authenticated APIs and monthly summary

### Overview

Expose rule management and categorized reads while retaining S-01's import/review contract and the existing session-bound Supabase client.

### Changes Required:

#### 1. Shared API contracts and period/money helpers

**Files**: `src/lib/expenses/contracts.ts`, `src/lib/expenses/contracts.test.ts`, `src/lib/expenses/rules.ts`, `src/lib/expenses/rules.test.ts`, `src/lib/expenses/monthly.ts`, `src/lib/expenses/monthly.test.ts`.

**Intent**: Give routes and the island consistent validated shapes, input bounds, Warsaw date calculations, and precision-safe summary formatting.

**Contract**: Expense responses retain existing fields and add `category_code`, `needs_review`, and `review_reason`. Validate known category codes and the status/reason relationship. Category-rule payloads expose `id, keyword, category_code`; mutation inputs accept only keyword/category_code, not owner, normalized key, timestamps, or arbitrary extra fields.

**Contract**: A deterministic month helper accepts an instant for testing and returns `month` (YYYY-MM), `startDate`, `endDateExclusive`, and `timeZone: Europe/Warsaw`. Production supplies the current instant once per request. Use timezone-aware calendar parts, not the host timezone, browser timezone, import timestamp, or most recently imported month.

**Contract**: Keep total cents as decimal strings at JSON boundaries and integer values internally. Format PLN without converting arbitrary totals to imprecise floating-point amounts. Display shares rounded to one decimal place, allowing rounding not to sum to exactly 100%; convert only bounded ratios for chart geometry.

#### 2. Owner-scoped rule endpoints

**Files**: `src/pages/api/category-rules/index.ts`, `src/pages/api/category-rules/[id].ts`.

**Intent**: Provide the dashboard's add/edit/delete flow and prevent silent truncation of a growing rule list.

**Contract**: GET `/api/category-rules?page=N` returns `rules, categories, page, pageSize, total, totalPages`, with 50 rules per page, normalized-keyword/ID ascending order, and all ten category descriptors. Reuse S-01's positive/safe page and offset validation. POST accepts `{keyword, category_code}` and returns the created rule with 201; PATCH by UUID returns the updated rule with 200; DELETE by UUID returns 204. A missing or foreign-owned ID is the same 404.

**Contract**: Every endpoint checks authentication and uses the existing session-bound client. Mutations require same-origin Origin, application/json for non-empty bodies, and bounded reading before parsing (16 KiB maximum for POST/PATCH); reject invalid JSON/fields, blank/oversized keywords, unknown categories, and malformed IDs with 400, oversized bodies with 413, duplicate normalized keywords with 409 and an edit-existing-rule message, and origin violations with 403. Validate the normalized database constraint authoritatively, including races; do not silently upsert duplicates. Use no-store responses, generic service errors, and no transaction-title/body logging. DELETE does not accept an owner or replacement rule in a body.

#### 3. Categorized review and current-month summary

**Files**: `src/pages/api/expenses/index.ts`, `src/pages/api/expenses/summary.ts`; regression verification of `src/lib/expenses/import.ts` and `src/pages/api/expenses/import.ts`.

**Intent**: Give the table and chart the same classification while keeping imports and all-date review compatible.

**Contract**: GET `/api/expenses?page=N` reads/counts the invoker view, keeps pageSize 50, all-date reachability, existing sort, and existing envelope. Select only the existing public transaction fields plus the three classification fields; never expose owner IDs. Re-import remains duplicate-skip and never updates transaction fields or rules; no category cache is written by the importer.

**Contract**: GET `/api/expenses/summary` checks authentication, derives the current Warsaw period, and invokes the date-bounded aggregate with the caller's session. Return `period, currency: PLN, totalCents, expenseCount, needsReviewCount, categories`; each ordered category contains `code, label, totalCents, expenseCount, needsReviewCount`. All cent totals are decimal strings. It accepts no selectable month/owner/category filter, sums all ten returned category totals exactly, and rejects malformed database results rather than returning fabricated zeros. Empty valid data is 200; authentication, unavailable client, and query failures follow the existing 401/503/500 pattern with no-store.

#### 4. HTTP smoke extensions and developer guidance

**Files**: `scripts/smoke.mjs`, `README.md`.

**Intent**: Exercise the public workflow under real sessions and document the new API/rule behavior without breaking existing fixtures.

**Contract**: Add isolated synthetic rule/summary scenarios alongside existing S-01 assertions. Generate new current-month dates from the reported period instead of reusing fixed September 2026 fixtures; unit tests independently verify the timezone boundary. Cover empty/all-Other data, explicit Other, conflicts, CRUD recalculation, duplicate 409, foreign-ID 404, invalid/oversized bodies, auth/origin denials, persistence, and aggregates beyond one table page. Keep unconfigured-service behavior and all existing import/count/pagination assertions.

### Success Criteria:

#### Automated Verification:

- `npm run test:unit` passes API-shape/input, Warsaw month-boundary/leap-year, precision-above-MAX_SAFE_INTEGER, and existing import regression tests.
- `npm run lint` and `npx astro check` pass.
- `npm run build` passes on Node 22.22.3.
- `npm run smoke` against the configured local production preview passes rule CRUD, authentication/origin/body limits, categorized review, recalculation, period totals, and existing S-01 cases.

#### Manual Verification:

- Inspect two signed-in sessions' rule/review/summary responses: private rules, correct Warsaw period, complete category totals, and distinct deliberate-Other versus needs-review outcomes.

**Implementation Note**: After automated gates pass, obtain the human's manual confirmation before beginning phase 3. Record completion only in the canonical Progress section.

---

## Phase 3: Dashboard rule panel and monthly chart

### Overview

Finish the end-to-end outcome in the existing island, with independent loading/error states, truthful refresh behavior, and accessible category totals.

### Changes Required:

#### 1. Dashboard rule-management panel

**Files**: `src/components/expenses/CategoryRulesPanel.tsx`, `src/components/expenses/ExpenseImportReview.tsx`.

**Intent**: Let users maintain their own keyword phrases and fixed-category targets without leaving the dashboard.

**Contract**: Provide labelled keyword/category inputs, a paginated saved-rule list, edit/cancel controls, explicit delete confirmation, disabled pending actions, and readable success/error status. Start with no merchant rules; explain substring matching and that changes affect existing automatic assignments. A duplicate never replaces another rule and the error directs editing it. A failed mutation preserves the form and does not trigger a success refresh.

#### 2. Categorized expense review and coordinated refresh

**File**: `src/components/expenses/ExpenseImportReview.tsx`.

**Intent**: Show classifications while preserving the all-date import-review experience.

**Contract**: Each existing expense row shows the category label and a separate needs-review indicator, distinguishing unmatched and ambiguous reasons without offering manual correction. Keep original titles, negative amounts, ordering, pagination, and import-result feedback. Label the list as all dates.

**Contract**: Successful import refreshes the list and summary, retaining S-01's page-one reset. Successful rule CRUD refreshes rules, the visible expense page, and the summary without pretending only visible expenses were reclassified. Independent abortable requests ignore superseded responses; show loading/errors and retry controls instead of stale success. Load the current summary on mount, relevant successful actions, and browser focus/visibility restoration; the next refresh adopts a new Warsaw month. Changing the list or rules page never recalculates the summary from those page rows.

#### 3. Static pie and complete legend

**Files**: `src/components/expenses/MonthlyCategoryBreakdown.tsx`, `src/lib/expenses/chart.ts`, `src/lib/expenses/chart.test.ts`, `src/styles/global.css`.

**Intent**: Make current-month spending understandable visually and textually without adding interaction or a chart dependency.

**Contract**: Display the Warsaw month, total positive spending, a non-interactive SVG pie for nonzero category totals, and all ten ordered legend entries with stable category colors, labels, exact PLN amounts, and one-decimal percentage shares. Zero categories retain legend rows but no pie wedges. Zero total shows a truthful current-month empty state and ten zero rows, never a full-circle Other slice. A single nonzero category renders a complete circle without invalid arc geometry.

**Contract**: Use an accessible figure with a chart title/description and adjacent semantic legend; amounts and labels must communicate the result without relying on color, hover, or pointer use. Keep the existing visual style, adding chart color tokens only as needed for ten categories. Show summary loading/failure distinctly from valid zero data. Pure geometry helpers are unit-tested; no filtering, tooltips required for essential information, or selection controls.

#### 4. End-to-end verification integration

**Files**: `scripts/smoke.mjs`, `README.md`; existing `.github/workflows/ci.yml` gates remain the integration path.

**Intent**: Make UI/SSR presence and regression checks part of the existing workflow, while reserving hydration/accessibility inspection for humans.

**Contract**: Add stable SSR assertions for rule-panel and monthly-summary landmarks/loading states without dropping import/review assertions. Existing CI commands pick up new unit and smoke cases; do not add unrelated deployment fixes or a new testing platform.

### Success Criteria:

#### Automated Verification:

- `npm run test:unit`, `npm run lint`, and `npx astro check` pass, including zero/single/multiple-category geometry and large-cent formatting cases.
- `npm run build` passes on Node 22.22.3.
- `npm run smoke:storage` and `npm run smoke` against the configured local production preview pass all existing and new cases, including dashboard SSR landmarks.

#### Manual Verification:

- Using the keyboard, add/edit/delete rules, handle a duplicate, and verify loading/error/retry states plus category refresh on existing expenses.
- Verify the Warsaw month label, all ten legend rows, readable zero/single/multiple-category charts, exact PLN totals, and usable layout at narrow and desktop widths without relying on color.
- Import current- and prior-month synthetic expenses, re-import duplicates, paginate the all-date table, and sign out/in: table reachability, current-only totals, rule persistence, Other review states, and non-filtering chart behavior remain correct.

**Implementation Note**: Complete manual confirmation before marking this change implemented. Then run the repository's implementation-review chain and triage; do not treat this plan as review approval.

## Testing Strategy

### Unit Tests:

- Catalogue has the exact ten code/label pairs in agreed order, no duplicate codes, and known-code guards reject arbitrary values.
- Date examples: 2026-09-30T22:30:00Z is October in Warsaw; 2026-12-31T23:30:00Z is January 2027. Cover leap February and both DST seasons independently of the host/browser timezone.
- API validators reject inconsistent category/review states, unknown fields/categories, invalid pages/IDs, malformed summaries, and unsafe numeric counts. Bounds respect UTF-8 bytes rather than JavaScript string length.
- Integer-cent formatting/percentage helpers cover 0.10 + 0.20 = 30 cents, zero denominators, rounding, and totals above Number.MAX_SAFE_INTEGER. Geometry covers zero, a single full circle, and multiple positive slices.

### Integration Tests:

- Real database matcher cases: paliw matches PALIWA; lodz does not match ŁÓDŹ; łódź matches ŁÓDŹ; LEROY MERLIN matches repeated spaces/tabs/NBSP; canonically equivalent accents match; percent/underscore/backslash are literal characters.
- LEROY MERLIN/Household beats MERLIN/Shopping. Equally long STACJA/Transport and KRAKOW/Shopping in one title produce Other/ambiguous. Equal-length matches for the same category resolve normally. Reverse insertion order and verify identical outcomes.
- Rule edits/deletes recategorize existing records, including fallback to shorter remaining matches. Deliberate Other has no review flag; no-rule/no-match has unmatched; normalized duplicates are rejected under concurrent creation too.
- Owner A and B can store the same normalized keyword with different categories but cannot access, transfer, edit, delete, or influence each other's rules, classified records, or totals. Anonymous access is denied.
- At least 1,001 complete same-period expenses all contribute to SQL totals; first/last dates are included and the next month's first date is excluded. Legacy incomplete rows, foreign owners, and other periods do not contribute.
- Public HTTP tests exercise CRUD/status/body/origin/auth behavior and the unchanged import/dedup/all-date pagination flow. Use synthetic data only; never commit the user's bank export.

### Manual Testing Steps:

1. Create an account or use an isolated test account, import synthetic old/current-month records, and verify the no-rules Other state.
2. Configure keyword rules, including a deliberate Other rule, and verify both the existing table and current-month chart update.
3. Edit/delete a rule, provoke normalized duplication and an equal-length cross-category tie, then verify the distinct outcomes and persistent records.
4. Confirm all ten legend values against known sums; test empty, one-category, and multi-category months at desktop/narrow widths.
5. Check keyboard focus, field labels, announcements, errors/retry, chart text alternatives, pagination, re-import, and sign-out/sign-in. Restoring browser focus reloads the current summary.

## Performance Considerations

The database filters by owner/date and aggregates before returning ten rows, never downloading the whole month to the Worker/browser. Reuse the existing owner/date unique-index prefix and rule-owner/normalized-key index; inspect the plan for accidental per-expense API calls or needless scans outside the requested period.

Read-time matching scales with owned expenses and rules. During verification inspect a representative local 10,000-expense/100-rule query plan and record observed performance; do not invent a latency guarantee or add a materialized category cache without revisiting the recalculation contract. The rule list is paginated rather than silently capped, and only one expense page plus ten totals are rendered.

## Migration Notes

- Use a new, additive migration timestamp later than existing migrations. Do not edit historical migration files or reset a populated local/remote database to test this change.
- Start local Supabase only when Docker is available; apply pending local migrations and use the existing anon-key/session smoke setup. Missing Docker blocks those gates, not unrelated code work; report it without marking unrun tests complete.
- Preserve all expense records, title constraints, RLS, duplicate identity, and the unchanged import write path. Automatic categories require no backfill and become visible on the next classified read.
- CI applies migrations before Worker deployment. New objects must leave the old Worker compatible during that interval; verify old-style expense inserts/selects still work.
- Roll back application code first if needed; leave additive objects and user-authored rules intact. Removing rule data or migrations is a separate explicitly authorized operation.
- Use Node 22.22.3 as in CI; on this Windows machine the verified runtime is C:/Users/Bartek/AppData/Roaming/nvm/v22.22.3/node64.exe if the default Node differs.
- S-03 must add persisted manual overrides with precedence at the shared read-model seam. This slice does not implement, test, or claim a working manual override.
- Planning documents are under the repository's ignored context/ tree. Later staging must explicitly include these three change files and the tracked roadmap; preserve other edits and request separate inclusion when needed.

## References

- Requirements: `context/foundation/prd.md:70` (FR-005), `context/foundation/prd.md:93` (Other and separate review state); roadmap: `context/foundation/roadmap.md:90` (S-02).
- Prior implementation, read-only: `context/archive/2026-09-28-import-and-review-expenses/plan.md`.
- Existing contracts: `src/lib/expenses/import.ts:38`, `src/pages/api/expenses/index.ts:24`, `src/pages/api/expenses/import.ts:38`, `src/components/expenses/ExpenseImportReview.tsx:127`.
- Verification: `scripts/expense-storage-smoke.mjs:72`, `scripts/smoke.mjs:65`, `.github/workflows/ci.yml:18`.
- [PostgreSQL 17 invoker-view permissions and RLS](https://www.postgresql.org/docs/17/sql-createview.html): use caller permissions for classified reads, rather than view-owner access.
- [Supabase database functions](https://supabase.com/docs/guides/database/functions): database-side processing, invoker security, and explicit execution grants.
- [PostgreSQL string functions](https://www.postgresql.org/docs/17/functions-string.html): NFC normalization, locale-aware case normalization, character length, and literal position.
- [PostgreSQL aggregates](https://www.postgresql.org/docs/17/functions-aggregate.html): numeric SUM preserves numeric arithmetic; coalesce empty totals explicitly.
- [Intl calendar parts](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/formatToParts): derive explicit-timezone month parts without parsing a locale-formatted date.
- [W3C complex-image guidance](https://www.w3.org/WAI/tutorials/images/complex/), [SVG path specification](https://www.w3.org/TR/SVG2/paths.html): accessible textual chart information and bounded static pie geometry.

## Progress

> Convention: - [ ] pending, - [x] done. Append — <commit sha> when a step lands. Do not rename step titles.

### Phase 1: Database and classification contracts

#### Automated

- [x] 1.1 New additive migrations apply locally without resetting data: `npx supabase migration up --local`. — 40e6011
- [x] 1.2 Expanded `npm run smoke:storage` passes catalogue, owner-isolation, normalized-rule uniqueness, matcher, recalculation, and 1,001-row aggregate cases. — 40e6011
- [x] 1.3 `npm run test:unit` passes fixed-catalogue checks and all existing parser/import tests. — 40e6011

#### Manual

- [x] 1.4 Review the migration and synthetic classification results against the agreed ten labels, tie behavior, and no-expense-backfill contract. — 40e6011
- [x] 1.5 Inspect a representative local 10,000-expense/100-rule query plan and record its observed runtime and result counts. — 40e6011

### Phase 2: Authenticated APIs and monthly summary

#### Automated

- [x] 2.1 `npm run test:unit` passes API-shape/input, Warsaw month-boundary/leap-year, precision-above-MAX_SAFE_INTEGER, and existing import regression tests. — aaffa92
- [x] 2.2 `npm run lint` and `npx astro check` pass. — aaffa92
- [x] 2.3 `npm run build` passes on Node 22.22.3. — aaffa92
- [x] 2.4 `npm run smoke` against the configured local production preview passes rule CRUD, authentication/origin/body limits, categorized review, recalculation, period totals, and existing S-01 cases. — aaffa92

#### Manual

- [x] 2.5 Inspect two signed-in sessions' rule/review/summary responses: private rules, correct Warsaw period, complete category totals, and distinct deliberate-Other versus needs-review outcomes. — aaffa92

### Phase 3: Dashboard rule panel and monthly chart

#### Automated

- [ ] 3.1 `npm run test:unit`, `npm run lint`, and `npx astro check` pass, including zero/single/multiple-category geometry and large-cent formatting cases.
- [ ] 3.2 `npm run build` passes on Node 22.22.3.
- [ ] 3.3 `npm run smoke:storage` and `npm run smoke` against the configured local production preview pass all existing and new cases, including dashboard SSR landmarks.

#### Manual

- [ ] 3.4 Using the keyboard, add/edit/delete rules, handle a duplicate, and verify loading/error/retry states plus category refresh on existing expenses.
- [ ] 3.5 Verify the Warsaw month label, all ten legend rows, readable zero/single/multiple-category charts, exact PLN totals, and usable layout at narrow and desktop widths without relying on color.
- [ ] 3.6 Import current- and prior-month synthetic expenses, re-import duplicates, paginate the all-date table, and sign out/in: table reachability, current-only totals, rule persistence, Other review states, and non-filtering chart behavior remain correct.
