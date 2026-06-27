# Grant Keeper

Grant Keeper is a desktop app for nonprofit grant discovery and AI draft generation.

Current architecture:

- Tauri 2 desktop shell
- React 18 + Vite + TypeScript frontend
- Rust backend inside `src-tauri`
- Firebase Realtime Database for persistence
- Firebase Authentication for user sessions
- Claude-powered draft generation
- `.docx` export via a Node sidecar

This repository has been reset from the older Grant Draft submission packet and is now being rebuilt to match the Grant Keeper specification.

## Pilot smoke checklist

Use this sequence to confirm the free nonprofit workflow still works:

1. Start the desktop app.
2. Complete setup or start the local dev profile.
3. Confirm grants load in the workspace.
4. Open a grant detail page.
5. Save the grant to the watchlist.
6. Create a draft from that grant.
7. Edit at least one draft section.
8. Save the draft, export the `.docx`, and reopen it from the drafts list.
9. Check Dev Tools for source health and sync status.

## Revised Pilot Plan

The current direction is workspace-first. The app should feel like a simple nonprofit product where:

- one organization owns the data boundary
- one email maps to one workspace identity
- Firebase auth and database access are seamless in the normal case
- setup is hidden from the user unless something is actually broken

Implementation should happen in this order:

1. Sketch the three onboarding screens before more code lands.
2. Decide the join model explicitly.
   - Invite code
   - Domain-based join
   - Manual admin-created workspace
3. Add the compatibility bridge for existing `firebase_uid`-keyed data alongside the new org model.
4. Define the RTDB shape and security rules around `organization_uid`.
5. Finish the workspace-first onboarding and membership flow.
6. Keep the free nonprofit flow stable: discover, save, draft, edit, export, reopen.
7. Add sync health, source status, and failure visibility for operators.
8. Harden the migration bridge so legacy `firebase_uid` data stays readable during rollout.

The main product risk is not adding more grant sources. It is making the workspace boundary, setup, and trust model obvious enough that a nonprofit user does not need help to get started.

Backend trust enforcement is now modeled in two layers:

- the Rust backend requires a workspace membership record before touching org-scoped data
- `firebase-rtdb.rules.json` captures the intended org-scoped RTDB policy for Firebase deployment

The detailed execution checklist lives in [docs/workspace-pilot-execution-plan.md](/C:/Users/kab10/grant_draft/docs/workspace-pilot-execution-plan.md).

## Layout

- `src-tauri/` - Tauri/Rust backend
- `src/` - React frontend
- `docx-sidecar/` - document export worker
- `.github/workflows/` - build and release automation

## Next Step

Implement the core app shell around the workspace model, then wire Firebase auth, RTDB access, grant loading, and migration compatibility together.
