# Workspace Pilot Execution Plan

This document turns the nonprofit pilot direction into an engineer-facing build sequence.

Goal:

- one organization owns the data boundary
- one email maps to one workspace identity
- Firebase auth and RTDB access are automatic in the normal case
- setup is only visible when it needs attention
- existing `firebase_uid`-keyed data remains readable during the transition

Non-goals for this phase:

- paid tier AI drafting
- browser extension autofill
- broad new grant-source expansion
- redesigning the app shell from scratch

## Product decisions to lock first

Before more implementation, make these decisions explicit:

1. Join model:
   - Invite code
   - Domain-based join
   - Admin-created workspace
2. Workspace ownership:
   - one organization per workspace
   - one workspace may have many writers
3. Identity mapping:
   - `firebase_uid` identifies the human session
   - `organization_uid` identifies the data boundary
4. Compatibility policy:
   - existing `firebase_uid` data stays readable
   - writes should target the new workspace model
5. Security policy:
   - application enforces the model
   - RTDB rules should also scope data by organization

Recommended choice for the pilot:

- start with admin-created workspace plus optional invite code
- avoid domain auto-join until the membership path is stable
- keep one-org-per-workspace to avoid merge complexity

## Pass 0: Flow sketch and API contract

Purpose:

- define the three screens the user actually sees
- freeze the data model before deep UI work

Files:

- `README.md`
- `src/pages/SetupPage.tsx`
- `src/pages/DashboardPage.tsx`
- `src/pages/OrganizationPage.tsx`
- `src/lib/types.ts`
- `src-tauri/src/models.rs`

Work items:

1. Sketch the onboarding sequence:
   - create or join workspace
   - confirm workspace ready
   - land in dashboard
2. Define the config contract:
   - `firebase_uid`
   - `organization_uid`
   - `setup_complete`
   - `firebase_auth_domain`
   - `firebase_web_api_key`
   - `firebase_database_url`
3. Define readiness states:
   - no workspace
   - needs login
   - needs membership
   - ready
   - dev profile ready
4. Define the minimum snapshot shape used by the frontend.

Acceptance:

- the UI copy and the state model tell the same story
- setup does not imply the wrong ownership boundary

## Pass 1: Stabilize the workspace-ready startup path

Purpose:

- make app startup predictable
- keep the dashboard from lying about readiness

Files:

- `src/App.tsx`
- `src/lib/tauri.ts`
- `src/lib/shell.ts`
- `src/lib/types.ts`
- `src-tauri/src/state.rs`
- `src-tauri/src/commands/mod.rs`
- `src-tauri/src/main.rs`
- `src-tauri/src/models.rs`

Work items:

1. Keep the frontend bridge thin.
   - `src/lib/tauri.ts` should only invoke commands
2. Keep normalization in one place.
   - `src/lib/shell.ts` should remain the filter and formatter layer
3. Make startup state explicit.
   - setup needed
   - login needed
   - membership needed
   - ready
4. Restore config/session on reload.
   - never lose the active workspace on refresh
5. Keep dev profile as a valid smoke path.
6. Ensure `snapshot` returns the canonical workspace identity.

Foundation:

- `state.rs` owns startup and readiness policy
- `commands/mod.rs` stays thin and delegates to `state.rs`
- `models.rs` and `types.ts` should match exactly on readiness fields

Acceptance:

- a fresh app clearly asks for setup or dev profile
- a configured app lands in the workspace without ambiguity
- refresh preserves session and workspace identity

## Pass 2: Automatic Firebase and workspace creation

Purpose:

- make the technical setup disappear for normal users
- let the app create or attach a workspace seamlessly

Files:

- `src/pages/SetupPage.tsx`
- `src/App.tsx`
- `src/lib/types.ts`
- `src/lib/tauri.ts`
- `src-tauri/src/state.rs`
- `src-tauri/src/config.rs`
- `src-tauri/src/firebase.rs`

Work items:

1. Collect only the minimum user inputs:
   - organization name
   - work email
   - optional workspace code or invite code
2. Auto-create or attach the workspace from the backend.
3. Auto-fill Firebase settings from known defaults when possible.
4. Hide advanced Firebase fields behind an expandable section.
5. Persist the workspace identifiers into local config.
6. Keep the onboarding copy non-technical.

Foundation:

- `SetupPage.tsx` is the user-facing entry point
- `state.rs` is the source of truth for workspace bootstrap policy
- `config.rs` should remain the persistence boundary

Acceptance:

- setup feels like creating an account, not configuring a backend
- the user does not need to understand Firebase to continue

## Pass 3: Data boundary and migration compatibility

Purpose:

- preserve old data while moving to org-scoped data
- avoid breaking pilot users during the transition

Files:

- `src-tauri/src/db.rs`
- `src-tauri/src/state.rs`
- `src-tauri/src/models.rs`
- `src/lib/types.ts`
- `src/lib/shell.ts`

Work items:

1. Add compatibility reads for existing `firebase_uid`-keyed records.
2. Prefer `organization_uid` for new writes and lookups.
3. Seed membership records when a workspace is created.
4. Add helper paths for organization membership and workspace membership.
5. Decide how to handle duplicate or orphaned workspaces.
6. Make migration behavior explicit in tests.

Foundation:

- keep the old key path readable while the new org path becomes primary
- do not make the UI depend on a successful migration to function

Acceptance:

- existing records are still visible
- new records are written against the workspace boundary
- membership lookups work from both startup and workspace bootstrap flows

## Pass 4: Nonprofit workflow surfaces

Purpose:

- make the grant discovery to draft path feel contiguous
- keep context visible at every step

Files:

- `src/pages/GrantDiscoveryPage.tsx`
- `src/pages/GrantDetailPage.tsx`
- `src/components/GrantDetailView.tsx`
- `src/pages/DraftsPage.tsx`
- `src/pages/WatchlistPage.tsx`
- `src/pages/OrganizationPage.tsx`
- `src/pages/DashboardPage.tsx`
- `src/lib/shell.ts`
- `src/lib/types.ts`
- `src/styles.css`

Work items:

1. Keep grant detail as the source of truth for one grant.
2. Make watchlist actions available from discovery and detail.
3. Make draft creation feel like a continuation of the grant view.
4. Keep the linked grant reference visible while editing drafts.
5. Keep organization profile in the workflow because drafts depend on it.
6. Preserve selected grant and selected draft across navigation.
7. Reduce "where am I?" friction with consistent copy and status chips.

Design rules:

- user perspective: understand one grant in under a minute
- trust perspective: every summary traces back to a source record
- editing perspective: every draft shows what it was generated from

Acceptance:

- a user can search, inspect, save, draft, edit, export, and reopen without losing context
- the detail page and draft editor always show the linked source

## Pass 5: Operator visibility and failure states

Purpose:

- make source health visible without logs
- make sync failures and stale data obvious

Files:

- `src/pages/DevToolsPage.tsx`
- `src-tauri/src/ingest/mod.rs`
- `src-tauri/src/state.rs`
- `src/lib/tauri.ts`
- `src/styles.css`
- `README.md`

Work items:

1. Expand Dev Tools into an operator check panel.
2. Classify failures clearly:
   - bad source
   - stale source
   - low-yield source
   - blocked source
   - sync error
3. Surface sync results in the UI.
4. Show whether the database is healthy.
5. Add a short manual smoke checklist to the repo.

Foundation:

- `ingest/mod.rs` remains the parsing and sync engine
- `state.rs` classifies source health
- `DevToolsPage.tsx` should tell a maintainer whether the pipeline is healthy

Acceptance:

- a maintainer can tell if ingestion is healthy without opening logs
- sync failures stay visible
- the smoke checklist matches the actual product path

## Pass 6: Tests, validation, and release gating

Purpose:

- prove the core flow works
- keep regressions from slipping into the pilot build

Files:

- `src/__tests__/shell.test.ts`
- `src/__tests__/security.test.ts`
- `src/__tests__/performance.test.ts`
- `src-tauri/src/state.rs`
- `src-tauri/src/ingest/mod.rs`
- `src-tauri/src/db.rs`
- `README.md`

Work items:

1. Keep frontend unit tests aligned with the readiness model.
2. Add or tighten backend tests around:
   - setup validation
   - workspace bootstrap
   - migration compatibility
   - source health classification
3. Keep the smoke sequence documented:
   - start dev profile or sign in
   - confirm grants load
   - open grant detail
   - save to watchlist
   - generate draft
   - edit section
   - export and reopen
   - verify Dev Tools health
4. Run full checks before any commit that affects pilot flow.

Baseline commands:

- `npm run check`
- `npm run build`
- `cargo test` in `src-tauri`
- `node --check docx-sidecar/worker.mjs`

Acceptance:

- the core flow is testable end to end
- readiness, workspace identity, and draft flow all match between frontend and backend
- the repo has a repeatable smoke checklist for pilot verification

## Pass 7: Migration bridge hardening

Purpose:

- keep the legacy `firebase_uid` data path readable while the org-scoped model becomes primary
- make the fallback behavior explicit so pilot users are not broken during rollout

Files:

- `src-tauri/src/commands/mod.rs`
- `src-tauri/src/state.rs`
- `src-tauri/src/db.rs`
- `src-tauri/src/models.rs`
- `README.md`

Work items:

1. Keep the legacy read bridge testable as a pure policy decision.
2. Prefer `organization_uid` for current writes and all new writes.
3. Confirm legacy watchlist, draft, grant, and organization records can still be read and normalized.
4. Seed workspace membership on bootstrap so the org boundary exists before users land in the dashboard.
5. Keep the migration story in the repo docs so operators know old data remains visible during the transition.

Acceptance:

- old `firebase_uid`-keyed data is still visible
- new writes use the organization boundary
- the migration bridge is explicit in tests and docs

## Suggested implementation order

1. Freeze product decisions and flow sketch.
2. Finish startup and workspace readiness wiring.
3. Lock the automatic workspace and Firebase onboarding path.
4. Add compatibility for old data.
5. Tighten discovery, detail, watchlist, and drafts into one flow.
6. Add operator visibility and failure states.
7. Harden the migration bridge and legacy read path.
8. Run the validation and smoke suite.

## What success looks like

- a new nonprofit user can create or join a workspace without understanding the backend
- the app remembers the workspace after refresh
- existing data is still visible during the migration window
- grant discovery, saving, drafting, editing, export, and reopen all work in one flow
- Dev Tools can explain whether the data pipeline is healthy
