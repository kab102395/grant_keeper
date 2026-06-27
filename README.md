# Grant Keeper

A desktop app for California nonprofit grant discovery, watchlisting, and AI-assisted draft generation.

Built with Tauri 2 (Rust backend), React 18 + TypeScript (frontend), Firebase Auth, Firebase Realtime Database, and Claude-powered draft generation. Exports grant drafts as `.docx` files.

---

## Prototype status

### What works end to end

- **Workspace session** — create or join an org workspace via email/password Firebase auth; session persists across restarts
- **Grant discovery** — California Grants Portal CSV feed (`data.ca.gov`) syncs into RTDB; searchable and filterable by deadline, status, funding range, source family, and jurisdiction
- **Watchlist** — save any grant to the org watchlist; entries persist in RTDB under the org boundary
- **AI draft generation** — generates a structured 10-section grant draft via Claude (requires Anthropic API key); sections map to the shared `DraftSchema` model
- **Draft editing** — section-by-section editor with 900ms debounced autosave
- **DOCX export** — exports the draft as a `.docx` file via a Node.js sidecar
- **Org profile** — org name, mission, programs, and contact fields with autosave
- **Security** — Firebase RTDB rules enforce org membership on all data paths; the Rust backend double-checks membership before any write

### What is missing before a nonprofit can use it unsupported

| Gap | Impact |
|---|---|
| Firebase RTDB rules not yet deployed to the console | Database is still open — **deploy `firebase-rtdb.rules.json` before any real user touches it** |
| No self-serve signup flow | You must manually create the Firebase user account before handing the app to someone |
| No error recovery UI | If the API is down or the token expires mid-session the user hits a dead end with no message |
| No way to update the Anthropic API key after setup | Requires re-running setup or editing the config file directly |
| No multi-user invite flow | One person per org works; a second person joining the same org is a manual operation |
| Grant data is California-only | Nonprofits outside California will see an empty discovery table |
| `.env` must exist with valid Firebase credentials | App will fail to authenticate if `.env` is missing or has placeholder values |

### Honest assessment

The core loop — **find a grant → save it → generate a draft → export a Word doc** — is functional. A California nonprofit with one staff member could use this today if you hand-hold the setup. It is not ready to hand to someone cold with no support.

---

## First-pilot checklist

Before putting this in front of a real nonprofit:

1. **Deploy RTDB rules** — Firebase console → Realtime Database → Rules → paste `firebase-rtdb.rules.json` → Publish
2. **Create their Firebase account** — Firebase console → Authentication → Add user (email + password)
3. **Confirm `.env` has real credentials** — `GRANT_KEEPER_DEFAULT_FIREBASE_RTD_URL`, `GRANT_KEEPER_DEFAULT_FIREBASE_WEB_API_KEY`, `GRANT_KEEPER_DEFAULT_FIREBASE_AUTH_DOMAIN` must all be set
4. **Run the smoke sequence** listed below
5. **Share their email and a temporary password** — they log in on first launch, the setup flow creates the workspace

---

## Smoke test sequence

Use this to confirm the core loop before handing to a user:

1. Launch the app
2. Enter org name and work email on the setup screen → **Create workspace**
3. Confirm grants load in the Discover tab
4. Open a grant detail page
5. Save the grant to the watchlist
6. Generate a draft from that grant
7. Edit at least one draft section — confirm autosave fires
8. Export the draft as `.docx` and confirm the file opens in Word
9. Close and relaunch — confirm the session and watchlist persist
10. Open Dev Tools → confirm source health and last sync timestamp are visible

---

## Setup

### Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) 18+
- [Tauri CLI v2](https://tauri.app/start/prerequisites/)
- A Firebase project with Authentication (email/password) and Realtime Database enabled
- An Anthropic API key (optional — only needed for AI draft generation)

### Environment

Create a `.env` file at the project root:

```
GRANT_KEEPER_DEFAULT_FIREBASE_RTD_URL=https://your-project.firebaseio.com
GRANT_KEEPER_DEFAULT_FIREBASE_WEB_API_KEY=your-web-api-key
GRANT_KEEPER_DEFAULT_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
GRANT_KEEPER_DEFAULT_ANTHROPIC_API_KEY=sk-ant-...
```

The Anthropic key is optional. Without it, local scaffold drafts work but AI generation is disabled.

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
  firebase.rs           FirebaseAuthClient — email/password sign-in, token refresh
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
firebase-rtdb.rules.json  RTDB security rules — deploy to Firebase console before first user
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

Current baseline: 219 Vitest passing, 131 Rust passing, 61 sidecar passing.
