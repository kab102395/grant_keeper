# Grant Keeper

A desktop app for California nonprofit grant discovery, watchlisting, and AI-assisted draft generation.

Built with Tauri 2 (Rust backend), React 18 + TypeScript (frontend), Firebase Auth, Firebase Realtime Database, and Claude-powered draft generation. Exports grant drafts as `.docx` files.

---

## Prototype status

### What works end to end

- **Self-serve accounts** — create a workspace, sign in, or join via invite, using either email/password or Google sign-in; no manual Firebase account creation required
- **Google sign-in** — desktop OAuth (PKCE via system browser) for create, sign-in, and join; an existing password account can permanently link Google so both methods reach the same workspace
- **Workspace session** — session persists across restarts and auto-refreshes the Firebase token before it expires, so a long-running or reopened session keeps working without a dead end; a revoked session routes the user back to sign-in
- **Multi-user invites** — workspace owners generate one-time invite tokens; a second person joins the same org with email/password or Google
- **Grant discovery** — California Grants Portal CSV feed (`data.ca.gov`) syncs into RTDB; searchable and filterable by deadline, status, funding range, source family, and jurisdiction
- **Watchlist** — save any grant to the org watchlist; entries persist in RTDB under the org boundary
- **AI draft generation** — generates a structured 10-section grant draft via Claude (requires Anthropic API key); sections map to the shared `DraftSchema` model
- **Draft editing** — section-by-section editor with 900ms debounced autosave
- **DOCX export** — exports the draft as a `.docx` file via a Node.js sidecar
- **Org profile** — org name, mission, programs, and contact fields with autosave
- **Security** — Firebase RTDB rules (deployed) enforce org membership on all data paths; the Rust backend double-checks membership before any write

### What is missing before a nonprofit can use it unsupported

| Gap | Impact |
|---|---|
| Grant data is California-only | Nonprofits outside California will see an empty discovery table |
| `.env` must exist with valid Firebase credentials | App will fail to authenticate if `.env` is missing or has placeholder values |
| No in-app password change | Users can reset via email ("Forgot password?") but cannot change a known password from inside the app |

### Honest assessment

The core loop — **find a grant → save it → generate a draft → export a Word doc** — is functional, and the account/auth story is now self-serve: a California nonprofit staff member can create a workspace, invite a colleague, and sign back in across sessions without hand-holding. The remaining gaps are scope (California-only data) and a one-time credentials setup, not core functionality.

---

## First-pilot checklist

Before putting this in front of a real nonprofit:

1. **Confirm RTDB rules are published** — Firebase console → Realtime Database → Rules should match `firebase-rtdb.rules.json`. Re-publish if you change the file.
2. **Confirm `.env` has real credentials** — `GRANT_KEEPER_DEFAULT_FIREBASE_RTD_URL`, `GRANT_KEEPER_DEFAULT_FIREBASE_WEB_API_KEY`, `GRANT_KEEPER_DEFAULT_FIREBASE_AUTH_DOMAIN` must all be set. For Google sign-in also set `GRANT_KEEPER_DEFAULT_GOOGLE_OAUTH_CLIENT_ID` and `GRANT_KEEPER_DEFAULT_GOOGLE_OAUTH_CLIENT_SECRET`.
3. **Run the smoke sequence** listed below
4. **Hand them the app** — they create their own workspace on first launch (email/password or Google); no pre-provisioning needed. To add a second user, the owner generates an invite token from Org settings.

---

## Smoke test sequence

Use this to confirm the core loop before handing to a user:

1. Launch the app
2. On the setup screen, **Create account** with an org name and work email (or **Continue with Google**)
3. Confirm grants load in the Discover tab
4. Open a grant detail page
5. Save the grant to the watchlist
6. Generate a draft from that grant
7. Edit at least one draft section — confirm autosave fires
8. Export the draft as `.docx` and confirm the file opens in Word
9. Close and relaunch — confirm the session and watchlist persist (session token auto-refreshes)
10. Sign out and sign back in with the same account — confirm the workspace reopens
11. From Org settings, **Generate invite token**, then in a fresh session use **Join workspace** with that token
12. Open Dev Tools → confirm source health and last sync timestamp are visible

---

## Setup

### Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) 18+
- [Tauri CLI v2](https://tauri.app/start/prerequisites/)
- A Firebase project with Authentication (email/password, plus Google provider for Google sign-in) and Realtime Database enabled
- An Anthropic API key (optional — only needed for AI draft generation)

### Environment

Create a `.env` file at the project root:

```
GRANT_KEEPER_DEFAULT_FIREBASE_RTD_URL=https://your-project.firebaseio.com
GRANT_KEEPER_DEFAULT_FIREBASE_WEB_API_KEY=your-web-api-key
GRANT_KEEPER_DEFAULT_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
GRANT_KEEPER_DEFAULT_ANTHROPIC_API_KEY=sk-ant-...
GRANT_KEEPER_DEFAULT_GOOGLE_OAUTH_CLIENT_ID=your-google-oauth-client-id
GRANT_KEEPER_DEFAULT_GOOGLE_OAUTH_CLIENT_SECRET=your-google-oauth-client-secret
```

The Anthropic key is optional. Without it, local scaffold drafts work but AI generation is disabled.

The Google OAuth credentials are optional — without them, the "Continue with Google" buttons are hidden and email/password auth still works. The client secret stays in the Rust backend and is never surfaced to the frontend. `.env` is gitignored; keep real credentials out of version control.

### Run in development

```bash
npm install
npm run tauri dev
```

### Build for desktop

```bash
npm run tauri build
```

---

## Project layout

```
src/                    React frontend
  App.tsx               Root shell (316 lines)
  hooks/                useWorkspaceData, useNavigation, useAutosave
  components/           Sidebar, DraftEditor, GrantDetailView, FirstRunPrompt
  pages/                Setup, Dashboard, Discover, Watchlist, Drafts, Org, DevTools
  lib/                  types.ts, shell.ts, tauri.ts, draftSchema.ts

src-tauri/src/          Rust backend
  main.rs               Tauri entry — registers all commands
  state.rs              AppState, session persistence, startup_state, workspace bootstrap
  config.rs             LocalConfig, setup validation, apply_env_defaults()
  firebase.rs           FirebaseAuthClient — email/password + Google sign-in, account linking, token refresh
  google_auth.rs        GoogleDesktopAuthClient — desktop OAuth (PKCE) via system browser
  rtdb.rs               RealtimeDatabaseClient — authenticated REST calls
  db.rs                 RTDB path helpers for all data boundaries
  commands/mod.rs       All Tauri invoke handlers
  models.rs             Shared data types (Grant, Org, Draft, Source, etc.)
  draft_schema.rs       Grant draft section schema — Rust side
  ingest/               California CSV fetch, parse, and normalize pipeline
  source_adapters.rs    Grant source adapter registry
  ai/                   Anthropic client and grant-specific prompt assembly

docx-sidecar/           Node.js .docx export worker
scripts/                PowerShell desktop launcher
docs/                   Spec, source registry, pilot execution plan
firebase-rtdb.rules.json  RTDB security rules — source of truth; keep the Firebase console in sync
```

---

## Data boundaries

All org data (watchlist, drafts, organization profile) is scoped under `organization_uid` in RTDB. The `memberships/{firebase_uid}/{organization_uid}` node controls access. RTDB rules enforce this; the Rust backend enforces it independently before any write.

Grant catalog data (`grants/`, `grant_sources/`) is readable by any authenticated user and is not org-scoped — it is shared across all workspaces.

---

## Grant data source

The discovery catalog pulls from the **California Grants Portal** live CSV feed:

```
https://data.ca.gov/dataset/.../california-grants-portal-data.csv
```

This covers California state and federal grants available to California nonprofits. Sync runs on demand from Dev Tools or on a configurable background interval.

---

## Tests

```bash
# Frontend (Vitest)
npm test

# Rust
cargo test --manifest-path src-tauri/Cargo.toml

# DOCX sidecar (node:test)
node --test docx-sidecar/worker.test.mjs
```

Current baseline: 225 Vitest passing, 160 Rust passing (2 ignored live-network tests), 23 sidecar passing.
