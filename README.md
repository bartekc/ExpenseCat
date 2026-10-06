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
each row adds `category_code`, `needs_review`, and `review_reason` (`unmatched`,
`ambiguous`, or null). Owner IDs are never returned. Re-imports skip duplicate
transactions without changing stored fields or rules.

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
Rule edits recalculate existing and future expenses on the next read, without
backfills or cached expense categories. Each owner's rules affect only their own
expenses, and rules persist across sign-out/sign-in.

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

## CI

GitHub Actions runs validation on every push and PR to `main`, deploys a preview Worker for same-repository pull requests, and deploys production after a push to `main` once the `production` environment approval is granted:

- **ci** — lint, `astro check` and build without production credentials.
- **smoke** — starts a local Supabase via the Supabase CLI, runs `npm run smoke:storage` to verify expense-record RLS, then builds, serves the production preview on the Cloudflare runtime and runs `npm run smoke`. No secrets required.
- **deploy-preview** — applies pending preview Supabase migrations, then deploys `expensecat-preview` with `npx wrangler deploy --env preview` for same-repository pull requests.
- **deploy-production** — applies pending production Supabase migrations, then deploys `expensecat` with `npx wrangler deploy` after the `production` environment approval.

The GitHub `preview` and `production` environments must define `SUPABASE_URL` and `SUPABASE_KEY` for their respective Supabase projects. They also need `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` so CI can apply pending migrations before deploying the Worker, plus `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Configure the `production` environment with required reviewers before enabling production deploys.

## License

MIT
