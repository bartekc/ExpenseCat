# 10x Astro Starter

![](./public/template.png)

A modern, opinionated starter template for building fast, accessible web applications.

## Tech Stack

- [Astro](https://astro.build/) v7 - Modern web framework with server-first rendering
- [React](https://react.dev/) v19 - UI library for interactive components
- [TypeScript](https://www.typescriptlang.org/) v6 - Type-safe JavaScript
- [Tailwind CSS](https://tailwindcss.com/) v4 - Utility-first CSS framework
- [Supabase](https://supabase.com/) - Authentication and backend-as-a-service
- [Cloudflare Workers](https://workers.cloudflare.com/) - Edge deployment runtime

## Prerequisites

- Node.js v22.14.0 (as specified in `.nvmrc`)
- npm (comes with Node.js)

## Getting Started

1. Clone the repository:

```bash
git clone https://github.com/przeprogramowani/10x-astro-starter.git
cd 10x-astro-starter
```

2. Install dependencies:

```bash
npm install
```

3. Set up Supabase and configure environment variables — see [Supabase Configuration](#supabase-configuration) below.

4. Create a `.dev.vars` file for local Cloudflare dev secrets:

```bash
cp .env.example .dev.vars
```

5. Run the development server:

```bash
npm run dev
```

## Available Scripts

- `npm run dev` - Start development server (Cloudflare workerd runtime)
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint with type-checked rules
- `npm run lint:fix` - Auto-fix ESLint issues
- `npm run format` - Run Prettier
- `npm run smoke` - Smoke test the auth flow against a running server (`BASE_URL`, defaults to `http://localhost:4321`)

## Project Structure

```md
.
├── src/
│ ├── layouts/ # Astro layouts
│ ├── pages/ # Astro pages
│ │ └── api/ # API endpoints
│ ├── components/ # UI components (Astro & React)
│ └── assets/ # Static assets
├── public/ # Public assets
├── wrangler.jsonc # Cloudflare Workers config
```

## Supabase Configuration

This project uses [Supabase](https://supabase.com/) for authentication. Environment variables are declared via Astro's `astro:env` schema and are treated as **server-only secrets** — they are never exposed to the client.

### First-time setup (local, no cloud project needed)

Requires [Docker](https://www.docker.com/) and ~7 GB RAM.

1. Create your `.env` file:

```bash
cp .env.example .env
```

2. Initialize the local Supabase project (creates a `supabase/` config folder):

```bash
npx supabase init
```

3. Start the local stack (downloads Docker images on first run):

```bash
npx supabase start
```

4. Copy the credentials printed by the CLI into your `.env` and `.dev.vars`:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon key from CLI output>
```

5. To stop the stack when done:

```bash
npx supabase stop
```

The local Studio UI is available at `http://localhost:54323`.

Project database changes live in `supabase/migrations/`. Local Supabase applies pending migrations during `npx supabase start`; run `npx supabase db reset` to recreate the local database and reapply them from scratch.

### Using a cloud Supabase project instead

If you prefer to use a hosted Supabase project, add these variables to your `.env` and `.dev.vars` files:

| Variable       | Description                                                |
| -------------- | ---------------------------------------------------------- |
| `SUPABASE_URL` | Project URL from Supabase dashboard → Settings → API       |
| `SUPABASE_KEY` | `anon` public key from Supabase dashboard → Settings → API |

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_KEY=<anon-key>
```

### Email confirmation in local development

By default Supabase requires email confirmation before a user can sign in. To skip this during local development:

1. Open the Supabase dashboard for your project
2. Go to **Authentication → Email → Confirm email**
3. Toggle it **off**

Users can then sign in immediately after sign-up without clicking a confirmation link.

### Auth routes

| Route                 | Description                                                             |
| --------------------- | ----------------------------------------------------------------------- |
| `/auth/signin`        | Email/password sign-in form                                             |
| `/auth/signup`        | Email/password sign-up form                                             |
| `/auth/confirm-email` | Post-signup "check your inbox" page                                     |
| `/dashboard`          | Example protected page (redirects to `/auth/signin` if unauthenticated) |

Route protection is handled in `src/middleware.ts`. Add paths to the `PROTECTED_ROUTES` array there to require authentication.

## Deployment

This project deploys to [Cloudflare Workers](https://workers.cloudflare.com/).

1. Build the project:

```bash
npm run build
```

2. Deploy with Wrangler:

```bash
npx wrangler deploy
```

The production Worker is named `expensecat`. The preview environment is a separate
Worker named `expensecat-preview` and uses the Workers environment flag:

```bash
npx wrangler deploy --env preview
```

This is a Workers deployment. Do not use `wrangler pages deploy` for this project.

Set `SUPABASE_URL` and `SUPABASE_KEY` as secrets in your Cloudflare dashboard or via `npx wrangler secret put`.

Configure production secrets with:

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_KEY
```

Configure preview secrets with:

```bash
npx wrangler secret put SUPABASE_URL --env preview
npx wrangler secret put SUPABASE_KEY --env preview
```

## Smoke test

`scripts/smoke.mjs` is a dependency-free Node script that walks the whole auth flow (sign-up, sign-in, protected page, sign-out) over HTTP. Run it against the dev server or the production preview after dependency upgrades:

```bash
npm run dev            # or: npm run build && npm run preview
BASE_URL=http://localhost:4321 npm run smoke
```

It needs a reachable Supabase instance (local or cloud) with email confirmation disabled.

> **Note:** this script exists primarily to guard the development of the starter itself — it is a fast sanity check that dependency upgrades did not break the build, the Cloudflare adapter or the Supabase auth flow. It is **not** a substitute for a real test suite. Once you build your own product on top of this starter, add proper tests (unit, integration, end-to-end) suited to your application.

## Category rules and monthly API

Signed-in users can read categorized expenses using `GET /api/expenses?page=N`.
The existing all-date newest-first list and 50-row pagination remain unchanged;
each row includes `category_code`, `needs_review`, and `review_reason` (`unmatched`,
`ambiguous`, or null), plus `manual_category_code` (a fixed category or null) and
`correction_revision` (a decimal string). Owner IDs are never returned. Re-imports
skip duplicate transactions without changing stored fields, rules or manual corrections.

`GET /api/category-rules?page=N` returns private rules, all ten fixed category
descriptors, and `page`, `pageSize` (50), `total`, and `totalPages`. Rules sort by
normalized keyword, then ID. Create with `POST /api/category-rules`, update with
`PATCH /api/category-rules/:id`, and delete with `DELETE /api/category-rules/:id`.
POST/PATCH accept only `{ "keyword": "merchant phrase", "category_code": "groceries" }`.
Send same-origin `Origin` and `Content-Type: application/json`; the body limit is
16 KiB and the raw and database-normalized keyword limits are 1,024 UTF-8 bytes.
DELETE accepts no body. Malformed inputs return 400, oversized bodies 413,
origin denials 403, and normalized duplicates 409 with guidance to edit the
existing rule. Missing and foreign-owned IDs both return 404. All responses are
`Cache-Control: no-store`.

Matching is a case-insensitive literal substring after NFC normalization and
whitespace collapsing; accents stay significant. The longest normalized keyword
wins. Equal longest matches for different categories produce Other/ambiguous;
no match produces Other/unmatched. A deliberate Other rule has no review flag.
Database constraints enforce duplicate rules, including concurrent requests.
Rule edits recalculate existing and future automatic assignments on the next read,
without backfills or cached expense categories. Manual corrections take precedence
and survive rule creation, editing, deletion and re-import. Each owner's rules
affect only their own expenses, and rules persist across sign-out/sign-in.

`GET /api/expenses/summary` takes no filters. It derives the current calendar
month in **Europe/Warsaw** from the current instant and aggregates by transaction
date, from `period.startDate` inclusive to `period.endDateExclusive` exclusive.
The response includes `period` (`month`, both bounds, `timeZone`), `currency: PLN`,
`totalCents`, `expenseCount`, `needsReviewCount`, and ten ordered category totals
with `code`, `label`, `totalCents`, `expenseCount`, and `needsReviewCount`.
Cent totals are exact non-negative decimal strings, including above JavaScript's
safe integer limit. Database aggregation covers the entire month, not just the
visible expense page. Empty months return valid zero totals; malformed service
results are errors, not fabricated empty data. Authentication/unavailable
service/query failures follow 401/503/500 respectively.

The dashboard includes a labelled keyword/category form, a paginated saved-rule
list, edit/cancel controls and explicit delete confirmation. Duplicate errors
direct you to edit the existing rule; failed writes preserve the form. Rule
changes refresh the rules, visible all-date expense page and monthly summary.
Imports retain their result counters and reset expense review to page one while
refreshing the summary. Each read has independent loading, error and retry
states; superseded requests cannot display stale refresh results.

Each saved expense offers an inline category correction. Opening it reads fresh
state, preselects the current category, starts with an empty phrase and defaults
learning on. Turn learning off for a one-off correction, including deliberate
Other or the same displayed category. Manual assignments have a visible marker.
Only one draft is open; Cancel or switching to another expense explicitly
discards it and returns focus. List/rule refreshes and pagination retain its
input, revision and confirmation. All dashboard writes share a synchronous
pending guard, disabling competing writes, row switches and pagination.

A conflicting rule shows its phrase and old/requested categories before explicit
replacement. Any field change clears that confirmation. Stale decisions and
uncertain results retain input and block writes. Check current state displays
persisted values separately from the draft; explicitly review and accept the
current revision before another save. An invalid phrase can remain editable
while an expense-only check runs, but another learning decision needs a valid
phrase and its own successful rule check. Checks never retry writes or prove
which earlier request committed. Restore automatic keeps rules, so the category
can stay the same. Confirmed save/reset and successful checks refresh rules,
the current expense page and summary independently without resetting the page.
Corrections outside this month may leave the chart unchanged; learning can still
alter this month's automatic totals.

The current Warsaw month and total positive spending appear above a static SVG
pie and a complete ten-category textual legend with exact PLN amounts and
one-decimal shares. Zero months show an empty state and ten zero rows; a single
category draws a complete circle. Tiny positive shares retain subpixel wedges;
the legend provides exact values. The chart does not filter the all-date list,
and pagination never calculates summary totals from visible rows. Restoring
browser focus or visibility refreshes the summary and adopts the current
Warsaw month.

The HTTP smoke gate retains existing auth/import/pagination assertions and adds
isolated synthetic sessions for category CRUD, owner isolation, mutation/body
limits, duplicates/races, live recalculation and persistence. New expense dates
come from the reported current Warsaw period, including neighboring-month
exclusions and more than one review/rule page. Unit tests independently check
UTC/Warsaw month boundaries, leap years and integer-safe money presentation.
The same gates also cover zero/single/multiple-category pie geometry and SSR
rule/summary landmarks with loading states. Human verification remains necessary
for hydration, keyboard add/edit/delete and duplicate handling, error/retry
states, narrow/desktop layout, and chart/legend readability without color.

### Expense category correction API

These endpoints use the signed-in session and return `Cache-Control: no-store`.
IDs must be UUIDs; missing, foreign-owned and incomplete expenses all return 404.
POST/PATCH require an exact same-origin `Origin`, `Content-Type: application/json`
and a JSON object of at most 16 KiB. Unknown fields, arrays, malformed UTF-8, NUL,
invalid revisions and invalid argument combinations return 400; oversized bodies
return 413. Authentication, origin, unavailable-client and unexpected failures
return 401, 403, 503 and generic 500 respectively. No endpoint accepts an owner ID.

| Endpoint                                | Request                                    | Result                                                                       |
| --------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------- |
| `GET /api/expenses/:id/category`        | No body                                    | Current expense and null rule                                                |
| `PATCH /api/expenses/:id/category`      | Correction below                           | Committed manual expense and learned rule, or null rule when learning is off |
| `POST /api/expenses/:id/category/reset` | `{ "expected_revision": "123" }`           | Current automatic expense and null rule                                      |
| `POST /api/expenses/:id/category/check` | `{}` or `{ "keyword": "merchant phrase" }` | Current expense and exact normalized matching rule, or null                  |

All successful responses are 200 with exactly `{ "expense": ..., "rule": ... }`.
The expense contains the public list fields including both correction metadata
fields. A non-null manual category equals the effective category and clears
review flags, including deliberate manual Other. A rule snapshot contains exactly
`id`, raw `keyword`, `category_code` and `revision`; regular category-rule CRUD
continues returning its original three-field DTO. Check is read-only and searches
the exact normalized phrase across all rules, independently of rule pagination.

Example learning correction:

```json
{
  "category_code": "groceries",
  "expected_revision": "0",
  "learn_rule": true,
  "keyword": "merchant phrase"
}
```

Callers should default learning on when opening a new editor, but must always
submit the explicit `learn_rule` boolean. With learning on, a nonblank phrase of
at most 1,024 UTF-8 bytes is required, and its database-normalized form must also
fit that bound and be a literal normalized title fragment. The user supplies the
phrase. With learning off, omit both `keyword` and `rule_confirmation`; only the
selected expense receives an override. Learning and the correction commit in one
RPC transaction. Learned rules affect existing and future automatic assignments,
subject to longest-phrase/tie matching; manual overrides stay protected.

Revisions are opaque equality tokens, transported as canonical decimal strings
in `0`–`9223372036854775807`, never JavaScript numbers. `"0"` means no correction
state yet. Rule revisions are strictly positive. Every correction/reset gets a
fresh revision, even when the effective category stays the same. Use the observed
expense revision as `expected_revision`.

A 409 response has an `error` and one of these `code` values:

- `expense_conflict`: the observed expense revision is stale; check current state
  before deliberately submitting a revised decision.
- `rule_confirmation_required`: the exact phrase already targets another category.
  The response includes its current four-field `rule` snapshot. Show its phrase,
  old/new categories and effects on existing/future automatic assignments, then
  obtain explicit user confirmation. Resubmit the unchanged correction with
  `"rule_confirmation": { "id": "observed-rule-uuid", "revision": "456" }`.
- `rule_conflict`: a competing rule write or stale confirmation invalidated the
  decision. The response includes the current `rule` snapshot or null. Check and
  review again; stale tokens never authorize replacement, even if categories now agree.

Same-category rules are reused without changing their raw phrase or revision.
Changing the draft phrase/category invalidates confirmation. Reset clears only
the selected manual override, retaining revision history and all learned rules;
its category can remain identical because a retained rule still applies. A
prior-month correction alone may leave current-month totals unchanged, while
learning can alter current-month automatic totals. The summary format stays unchanged.

After a lost response, unexpected 5xx or malformed success, retain the draft and
block further writes until check succeeds. Never automatically retry a mutation.
An expense-only check can recover state when the draft phrase is invalid; resolve
the phrase and check its matching rule before another learning decision. Checking
reports current persisted state, not causal proof that a particular request
committed. Refresh the list, rules and summary after a confirmed save/reset or
successful recovery check; a refresh failure is separate from mutation success.

Regression gates remain `npm run test:unit`, `npm run lint`, `npx astro sync`,
`npx astro check`, `npm run build` on Node 22.22.3, `npm run smoke:storage` and
`npm run smoke` against local Supabase and the production preview. No new automated
correction coverage was added. Manual acceptance must exercise owned/foreign/missing
IDs, authentication/origin denials, exact fields/revision bounds/keyword bounds,
invalid UTF-8 and oversized bodies; two sessions must verify stale correction and
rule tokens, explicit replacement, same-category reuse, nonmatching phrases and
atomic rollback. Also verify owner isolation, recovery beyond the first rule page,
all-date pagination, totals, re-import and sign-out/sign-in persistence. Obtain
human confirmation of these API cases before considering this phase complete;
unchanged HTTP smoke is regression evidence only.

Human acceptance of the hydrated editor also covers keyboard and narrow/desktop
layout, save with/without learning, replacement confirmation, explicit draft
discard, reset, manual Other/markers, retained pagination, unchanged total
spending and the complete ten-row legend. Use two tabs and interrupted responses
to verify stale corrections/confirmations, uncertain-result checks, retained
drafts and independent resource failures. These new flows have no added automated
coverage; existing smoke checks cover regressions and SSR/API paths only.

## CI

GitHub Actions runs validation on every push and PR to `main`, deploys a preview Worker for same-repository pull requests, and deploys production after a push to `main` once the `production` environment approval is granted:

- **ci** — lint, `astro check` and build without production credentials.
- **smoke** — starts a local Supabase via the Supabase CLI, runs `npm run smoke:storage` to verify expense-record RLS, then builds, serves the production preview on the Cloudflare runtime and runs `npm run smoke`. No secrets required.
- **deploy-preview** — applies pending preview Supabase migrations, then deploys `expensecat-preview` with `npx wrangler deploy --env preview` for same-repository pull requests.
- **deploy-production** — applies pending production Supabase migrations, then deploys `expensecat` with `npx wrangler deploy` after the `production` environment approval.

The GitHub `preview` and `production` environments must define `SUPABASE_URL` and `SUPABASE_KEY` for their respective Supabase projects. They also need `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` so CI can apply pending migrations before deploying the Worker, plus `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Configure the `production` environment with required reviewers before enabling production deploys.

## License

MIT
