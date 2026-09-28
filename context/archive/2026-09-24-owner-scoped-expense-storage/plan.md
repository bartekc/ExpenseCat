# Owner-scoped expense storage Implementation Plan

## Overview

Establish the smallest persistent expense-record contract for authenticated users. The contract is intentionally database-only: it lets later CSV import, categorization, and editing slices persist data without allowing one user to access another user's records.

## Current State Analysis

The application creates a cookie-backed Supabase SSR client in `src/lib/supabase.ts`, and middleware resolves the signed-in user, but the repository has no expense tables or migrations. The local Supabase configuration enables migrations, while the current CI smoke job starts local Supabase but verifies only account access.

## Desired End State

`public.expenses` persists an owner-bound record and enforces owner-only CRUD through RLS policies keyed to `auth.uid()`. Local CI proves that two authenticated users cannot read, create for, update, or delete each other's records; preview and production deployments apply the same migration before their Worker deployment.

### Key Discoveries:

- `src/lib/supabase.ts` creates the SSR client with the request's authenticated cookie session.
- `supabase/config.toml` enables ordered migrations and exposes the `public` schema.
- `.github/workflows/ci.yml` starts local Supabase but has no remote schema-migration step.

## What We're NOT Doing

- CSV fields, parsing, import routes, expense UI, categories, or product-facing API routes.
- History, manual categorization, custom categories, or bank integrations.
- A service-role database client or application-only ownership filters.

## Implementation Approach

Keep the data model to an ID, authenticated owner, and timestamp. Enforce access in PostgreSQL with RLS so every current and future caller using the anon/publishable key must carry a matching Supabase session. Verify the policies against real local sessions, then run the migration through the Supabase CLI in each GitHub deployment environment before publishing a Worker that depends on the schema.

## Critical Implementation Details

The CI migration command must run after static and local-smoke gates have passed but before each `wrangler deploy`; the preview and production GitHub environments provide separate `SUPABASE_PROJECT_REF` values and their own `SUPABASE_ACCESS_TOKEN` secret.

## Phase 1: Establish the storage contract

### Overview

Create the minimum schema and database-level authorization boundary for an expense record.

### Changes Required:

#### 1. Supabase migration

**File**: `supabase/migrations/20260924000000_create_owner_scoped_expenses.sql`

**Intent**: Create a durable owner-scoped record while keeping future CSV transaction attributes out of this foundation.

**Contract**: `public.expenses` has a generated UUID primary key, `owner_id uuid not null default auth.uid()` referencing `auth.users(id)` with cascade deletion, and a UTC `created_at` timestamp. RLS is enabled and authenticated users receive CRUD policies that compare `owner_id` with `auth.uid()`; inserts and updates use `WITH CHECK`, while reads and deletes use `USING`.

### Success Criteria:

#### Automated Verification:

- The local migration resets cleanly: `npx supabase db reset`
- The new table and RLS policies appear in the local database after reset.

---

## Phase 2: Prove owner isolation in CI

### Overview

Add a real-session integration smoke test and make it part of the existing local Supabase CI job.

### Changes Required:

#### 1. Storage smoke script and npm command

**Files**: `scripts/expense-storage-smoke.mjs`, `package.json`

**Intent**: Exercise the RLS boundary with two independent authenticated users rather than trusting migration text alone.

**Contract**: The script accepts `SUPABASE_URL` and `SUPABASE_KEY`, creates unique test users/sessions, inserts a record for each, and asserts owner-only select/insert/update/delete behavior. It exits nonzero on any unexpected authorization result; `npm run smoke:storage` invokes it.

#### 2. Local-Supabase CI wiring

**File**: `.github/workflows/ci.yml`

**Intent**: Run the storage smoke immediately after the local migration-backed Supabase setup, without changing existing auth smoke coverage.

**Contract**: The `smoke` job exports the local API URL and anon key only to the storage smoke command, then proceeds with the existing built-Worker auth smoke.

### Success Criteria:

#### Automated Verification:

- The storage smoke proves owner-only CRUD: `npm run smoke:storage`
- Lint passes: `npm run lint`
- Astro type checking passes: `npx astro check`
- Production build succeeds: `npm run build`

---

## Phase 3: Automate remote schema release

### Overview

Ensure every deployed Worker is preceded by the matching Supabase schema migration.

### Changes Required:

#### 1. Preview and production migration gates

**File**: `.github/workflows/ci.yml`

**Intent**: Apply pending migrations to the correct remote Supabase project before each Worker deployment.

**Contract**: Preview and production deploy jobs run `npx supabase db push --include-all --project-ref "$SUPABASE_PROJECT_REF"` before deploying. Each GitHub environment supplies `SUPABASE_ACCESS_TOKEN` and its own `SUPABASE_PROJECT_REF`; the Worker continues to use `SUPABASE_URL` and `SUPABASE_KEY` runtime secrets.

#### 2. Release documentation

**File**: `README.md`

**Intent**: Replace the obsolete claim that no database migrations are needed and document the required environment-scoped secrets and deployment order.

**Contract**: The Supabase setup and deployment sections name `supabase/migrations/` as the schema source, explain local migration application, and state that CI migrates preview/production before each Worker deployment.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Astro type checking passes: `npx astro check`
- Production build succeeds: `npm run build`

#### Manual Verification:

- A preview deployment log shows the remote migration step completing before Worker deployment.
- A production deployment log shows the remote migration step completing before Worker deployment.

## Testing Strategy

The local integration smoke is the primary regression test. It authenticates two fresh users through Supabase, uses their session access tokens against the `expenses` REST endpoint, and confirms both successful owner operations and failed cross-owner operations. Existing lint, type check, build, and auth smoke checks remain mandatory.

## Migration Notes

The migration is additive and has no existing expense records to backfill. CI deployment environments need `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF`; their runtime Worker secrets remain unchanged.

## References

- `context/foundation/roadmap.md` — F-01 owner-scoped expense storage contract
- `context/foundation/prd.md` — access-control and persistence requirements
- `src/lib/supabase.ts` — request-scoped Supabase SSR client
- `.github/workflows/ci.yml` — local smoke and Worker deployment flow

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Establish the storage contract

#### Automated

- [x] 1.1 Local migration resets cleanly — d5de847
- [x] 1.2 Table and RLS policies are present after reset — d5de847

### Phase 2: Prove owner isolation in CI

#### Automated

- [x] 2.1 Storage smoke proves owner-only CRUD — 7d0a724
- [x] 2.2 Lint passes
- [x] 2.3 Astro type checking passes
- [x] 2.4 Production build succeeds

### Phase 3: Automate remote schema release

#### Automated

- [x] 3.1 Lint passes
- [x] 3.2 Astro type checking passes
- [x] 3.3 Production build succeeds

#### Manual

- [x] 3.4 Preview deployment migrates before Worker deployment — 5e68395
- [x] 3.5 Production deployment migrates before Worker deployment — 5e68395
