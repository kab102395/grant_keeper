# Grant Keeper — Engineering Specification (v6)
**Project:** Grant Keeper — Nonprofit Grant Discovery, AI Drafting & Autofill Platform  
**Author:** Senior Engineer → Junior Engineer Handoff  
**Date:** June 18, 2026  
**Status:** Authoritative source of truth. Describes both what is built and what must be built to reach a finished SaaS product.

---

## Table of Contents

1. [What This Is](#1-what-this-is)
2. [Stack — Verified Against Source](#2-stack--verified-against-source)
3. [Repository Layout](#3-repository-layout)
4. [The `rtdb-rs` Crate — Exact API in Use](#4-the-rtdb-rs-crate--exact-api-in-use)
5. [Firebase RTDB — Data Model](#5-firebase-rtdb--data-model)
6. [Rust Backend — Tauri Commands](#6-rust-backend--tauri-commands)
7. [Auth — Dual Path](#7-auth--dual-path)
8. [AI Draft Generation](#8-ai-draft-generation)
9. [Ingest — CA Grants Portal CSV](#9-ingest--ca-grants-portal-csv)
10. [Frontend — React / Vite](#10-frontend--react--vite)
11. [.docx Export Sidecar](#11-docx-export-sidecar)
12. [Grant Field Requirements](#12-grant-field-requirements)
13. [Draft Sections & Prompt Templates](#13-draft-sections--prompt-templates)
14. [Setup & First-Run Experience](#14-setup--first-run-experience)
15. [Freemium Tier Definitions](#15-freemium-tier-definitions)
16. [SaaS Account System — Phase 7](#16-saas-account-system--phase-7)
17. [Browser Extension — Phase 9](#17-browser-extension--phase-9)
18. [Hosting & Deployment](#18-hosting--deployment)
19. [Testing Requirements](#19-testing-requirements)
20. [Phase Roadmap](#20-phase-roadmap)
21. [Definition of Done](#21-definition-of-done)

---

## 1. What This Is

Grant Keeper is a Tauri desktop application that grows into a SaaS platform. It does five things in its final form:

1. **Discover** — live California grant catalog from the CA Grants Portal CSV, written to Firebase RTDB via `rtdb-rs`.
2. **Filter** — full-text search plus structured filters: category, amount, deadline, LOI, matching funds, applicant type.
3. **Watchlist** — per-org saved grants stored in RTDB under the org's Firebase UID.
4. **Draft** — AI-generated grant application sections using Claude (`claude-sonnet-4-6`), or a grant-aware scaffold when no API key is configured.
5. **Autofill** — browser extension (Pro) that fills grantor web forms with the org's saved profile and draft in one click.

**Why Firebase + `rtdb-rs`:** Firebase RTDB Spark free tier covers the prototype at zero cost. `rtdb-rs` (crates.io v0.3.0+) is the first-party Rust RTDB client written by Kyle Barrett. Every Firebase operation in this codebase is production proof that the crate works at scale. This is a deliberate Ember Tech Solutions portfolio decision.

**The architecture is desktop-first now, SaaS later.** The desktop app talks directly to Firebase RTDB via `rtdb-rs`. A future central Axum API layer (Phase 7) adds managed accounts, freemium enforcement, and the browser extension backend — without requiring a browser web app before the desktop product is useful. The RTDB data model and crate usage stay the same.

---

## 2. Stack — Verified Against Source

| Layer | Technology | Source File |
|---|---|---|
| Desktop shell | Tauri 2.x | `src-tauri/tauri.conf.json` |
| Frontend | React 18 + Vite + TypeScript | `src/main.tsx`, `vite.config.ts` |
| Styling | Custom CSS (no Tailwind) | `src/styles.css` |
| Backend | Rust — Tauri IPC commands | `src-tauri/src/commands/mod.rs` |
| RTDB client | `rtdb-rs = "0.3.1"` | `src-tauri/Cargo.toml` |
| RTDB wrapper | `RealtimeDatabaseClient` | `src-tauri/src/rtdb.rs` |
| Firebase Auth | Custom `FirebaseAuthClient` | `src-tauri/src/firebase.rs` |
| AI | Direct `reqwest` → Anthropic | `src-tauri/src/ai/client.rs` |
| Prompt templates | `build_draft_prompt_bundle()` | `src-tauri/src/ai/prompts.rs` |
| CSV ingest | `csv` crate + custom parser | `src-tauri/src/ingest/mod.rs` |
| .docx export | Node.js sidecar (`docx` npm) | `docx-sidecar/worker.mjs` |
| Config persistence | JSON file + env overrides | `src-tauri/src/config.rs` |
| RTDB path helpers | `db.rs` | `src-tauri/src/db.rs` |
| State management | `AppState` with `Arc<RwLock<>>` | `src-tauri/src/state.rs` |
| Models | Rust structs + TS types | `src-tauri/src/models.rs`, `src/lib/types.ts` |

**`rtdb-rs` is the live runtime.** `src-tauri/src/rtdb.rs` wraps `RtdbClient` from the crate. Auth tokens are obtained via `generate_jwt()` and `exchange_jwt_for_access_token()` from `rtdb-rs`, imported directly in `state.rs`. The ingest job, grant catalog reads, org writes, watchlist, and draft CRUD all go through this wrapper. No raw reqwest calls to Firebase exist.

---

## 3. Repository Layout

```
grant-keeper/
├── src-tauri/
│   ├── Cargo.toml                    # rtdb-rs = "0.3.1" is the Firebase client
│   ├── build.rs
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs                   # Tauri entry — registers all commands
│       ├── state.rs                  # AppState: config, session, grant cache, RTDB clients
│       ├── config.rs                 # JSON config store + env var overrides
│       ├── db.rs                     # RTDB path helpers (grants/, organizations/, etc.)
│       ├── firebase.rs               # FirebaseAuthClient: sign-in, token refresh
│       ├── rtdb.rs                   # RealtimeDatabaseClient wrapping RtdbClient from rtdb-rs
│       ├── models.rs                 # All Rust data structs
│       ├── commands/
│       │   └── mod.rs                # All #[tauri::command] handlers (thin — delegate to services)
│       ├── ai/
│       │   ├── mod.rs
│       │   ├── client.rs             # AnthropicClient — direct reqwest to /v1/messages
│       │   └── prompts.rs            # build_draft_prompt_bundle(), prompt version, model const
│       └── ingest/
│           └── mod.rs                # CSV fetch, parse, RTDB upsert, GrantIngestReport
│
├── src/                              # React frontend
│   ├── main.tsx
│   ├── App.tsx                       # Root shell, routing, all surface state
│   ├── styles.css
│   ├── components/
│   │   ├── GrantDetailView.tsx
│   │   └── SectionCard.tsx
│   ├── lib/
│   │   ├── tauri.ts                  # All invoke() wrappers (api.* object)
│   │   ├── types.ts                  # TypeScript types mirroring Rust models
│   │   └── shell.ts                  # Normalizers, filters, formatters
│   └── pages/
│       ├── SetupPage.tsx
│       ├── DashboardPage.tsx
│       ├── GrantDiscoveryPage.tsx
│       ├── GrantDetailPage.tsx
│       ├── WatchlistPage.tsx
│       ├── OrganizationPage.tsx
│       └── DraftsPage.tsx
│
├── docx-sidecar/
│   ├── package.json                  # docx ^8.5.0 dep
│   └── worker.mjs                    # Reads payload JSON, writes .docx to Downloads
│
├── .github/workflows/
│   ├── build.yml                     # Placeholder — needs implementation (Phase 10)
│   └── release.yml                   # Placeholder — needs implementation (Phase 10)
│
├── scripts/
│   ├── start-desktop.ps1
│   └── start-vite.ps1
│
├── package.json
├── vite.config.ts
├── tsconfig.json
└── index.html
```

**Future additions (not yet present):**
```
├── api/                              # Phase 7: Central Axum API for managed accounts
├── extension/                        # Phase 9: Browser extension for autofill
└── migrations/                       # Phase 7: Firebase rules + tree docs
```

---

## 4. The `rtdb-rs` Crate — Exact API in Use

All code in this section is verified against the crate source and against `src-tauri/src/rtdb.rs` as of 2026-06-18.

### 4.1 Cargo.toml

```toml
rtdb-rs = "0.3.1"
```

### 4.2 Auth — Service Account Flow

Used in `state.rs::rtdb_service_client()` to obtain the token that writes `/grants` and reads org-scoped data as admin.

```rust
use rtdb_rs::{generate_jwt, exchange_jwt_for_access_token};

// Step 1: Sign a JWT using the service account private key (RSA PEM)
// private_key = serviceAccountKey.json["private_key"]
// client_email = serviceAccountKey.json["client_email"]
let jwt = generate_jwt(&private_key, &client_email).await?;

// Step 2: Exchange for a Google OAuth2 access token (starts with "ya29.")
// The crate automatically uses "access_token=" query param for ya29.* tokens
// and "auth=" for Firebase ID tokens — transparent to callers.
let access_token = exchange_jwt_for_access_token(&jwt).await?;
```

Token lifetime: 3600 seconds. The crate sets this in the JWT `exp` claim. Refresh by repeating both steps. `state.rs` holds a background task that refreshes every 50 minutes.

### 4.3 `RtdbClient` Construction

```rust
use rtdb_rs::RtdbClient;

// Both service-account tokens and Firebase ID tokens work here.
// The crate's auth_query_name() detects token type internally.
let client = RtdbClient::new(database_url, token);

// Token refresh — consumes and returns new client
let client = client.with_token(new_token);
```

In `RealtimeDatabaseClient`, the client is constructed fresh per call:
```rust
let client = RtdbClient::new(self.database_url.clone(), self.auth_token.clone().unwrap_or_default());
```

This is correct for the current architecture. When the wrapper is simplified in a later phase, the client can be stored and refreshed with `with_token()`.

### 4.4 Core CRUD Methods

```rust
// READ — returns serde_json::Value
// Returns Value::Null when node is empty (not Err)
// Returns Err(RtdbError::NotFound) only on HTTP 404
let value: Value = client.get("grants/171870").await?;

// WRITE — HTTP PUT — overwrites the full node
let written: Value = client.put("grants/171870", &grant_json).await?;

// UPDATE — HTTP PATCH — updates only specified fields, siblings untouched
let updated: Value = client.patch("organizations/uid123", &json!({ "plan": "pro" })).await?;

// APPEND — HTTP POST — Firebase generates push key
// Returns { "name": "-NxPushKey..." }
let response: Value = client.post("drafts/uid123", &draft_json).await?;
let push_key = response["name"].as_str().unwrap();

// DELETE — HTTP DELETE
client.delete("drafts/uid123/draft_abc").await?;
```

### 4.5 Filtered Queries — `GetBuilder`

```rust
// Chain methods on GetBuilder, close with .send() or .stream()

// Order by child field + filter
let results: Value = client
    .query("grants")
    .order_by_child("status")
    .equal_to(rtdb_rs::FilterValue::string("active"))
    .limit_to_last(100)
    .send()
    .await?;

// Shallow read — keys only, no values
// Cannot combine with order_by/limit/filters — returns InvalidQuery if attempted
let keys: Value = client.query("grants").shallow().send().await?;

// Range filter
let results: Value = client
    .query("grants")
    .order_by_child("est_amount_min")
    .start_at(rtdb_rs::FilterValue::number(100_000.0))
    .end_at(rtdb_rs::FilterValue::number(500_000.0))
    .send()
    .await?;
```

**`FilterValue` constructors:**
- `FilterValue::string("active")` — JSON-quoted in URL
- `FilterValue::number(42.0)` — bare in URL
- `FilterValue::boolean(true)` — bare in URL

**Mutual exclusions caught before any network call (returns `RtdbError::InvalidQuery`):**
- `limit_to_first` / `limit_to_last` / `start_at` / `end_at` / `equal_to` without `order_by`
- `shallow()` combined with any filter or order
- `limit_to_first` and `limit_to_last` together (setting one clears the other)

### 4.6 SSE Streams

```rust
use rtdb_rs::{RtdbClient, RtdbEvent};
use futures_util::StreamExt;

let mut stream = client.stream("grants").await?;
tokio::pin!(stream);

while let Some(event) = stream.next().await {
    match event? {
        RtdbEvent::Put { path, data } => { /* first event = full current value */ }
        RtdbEvent::Patch { path, data } => { /* only changed fields */ }
        RtdbEvent::KeepAlive => {}
        RtdbEvent::Cancel => { /* token expired — re-auth and reconnect */ break; }
    }
}

// Filtered stream — same filters as GetBuilder
let mut stream = client
    .query("drafts/uid123")
    .order_by_key()
    .stream()
    .await?;
```

### 4.7 `RtdbError` Variants

```rust
pub enum RtdbError {
    Request(reqwest::Error),       // Network failure
    Status { status, body },       // Non-success HTTP
    Auth(String),                  // JWT / token error
    NotFound(String),              // HTTP 404
    Parse(String),                 // JSON or SSE parse failure
    InvalidQuery(String),          // Bad query combination
}
```

Match these explicitly in service functions. Never unwrap RTDB calls. The `RealtimeDatabaseClient` in `rtdb.rs` applies a 3-attempt retry with exponential backoff for transient errors (`is_connect()`, `is_timeout()`, connection reset).

### 4.8 Free Functions — Do Not Use

The crate exports `get()`, `put()`, `patch()`, `delete()` free functions for backward compatibility. They create a new `reqwest::Client` per call. Do not use them. Always use `RtdbClient` or `RealtimeDatabaseClient`.

---

## 5. Firebase RTDB — Data Model

### 5.1 Firebase Project Setup

1. Create project at console.firebase.google.com.
2. Enable Realtime Database → region `us-central1` → **locked mode**.
3. Download `serviceAccountKey.json`. Store as env var `GRANT_KEEPER_FIREBASE_SERVICE_ACCOUNT_JSON` (path to file). Never commit the file. It is in `.gitignore`.
4. Set `GRANT_KEEPER_DEFAULT_FIREBASE_RTD_URL` = `https://<project>-default-rtdb.firebaseio.com`.
5. Enable Email/Password sign-in under Authentication.

### 5.2 RTDB Path Helpers (`db.rs`)

```rust
pub fn grants_root() -> &'static str { "grants" }
pub fn grant_path(portal_id: &str) -> String { format!("grants/{portal_id}") }
pub fn organization_path(uid: &str) -> String { format!("organizations/{uid}") }
pub fn watchlist_path(uid: &str) -> String { format!("watchlist/{uid}") }
pub fn watchlist_entry_path(uid: &str, portal_id: &str) -> String { format!("watchlist/{uid}/{portal_id}") }
pub fn drafts_path(uid: &str) -> String { format!("drafts/{uid}") }
pub fn draft_path(uid: &str, draft_id: &str) -> String { format!("drafts/{uid}/{draft_id}") }
```

### 5.3 JSON Tree Schema (Authoritative)

```
/
├── grants/
│   └── {portal_id}/
│       ├── portal_id: "171870"
│       ├── title: "2026-27 Public Charter Schools Grant Program"
│       ├── status: "active"
│       ├── agency_dept: "CA Department of Education"
│       ├── grant_type: "Grant"
│       ├── loi_required: false
│       ├── categories: ["Education"]
│       ├── applicant_types: ["Nonprofit", "Public Agency"]
│       ├── purpose: "..."
│       ├── description: "..."
│       ├── applicant_type_notes: "..."
│       ├── geography: "State of California"
│       ├── funding_source: "Federal"
│       ├── funding_source_notes: "..."
│       ├── matching_funds: "Not Required"
│       ├── matching_funds_notes: null
│       ├── est_avail_funds: "$33,666,515"
│       ├── est_avail_funds_numeric: 33666515
│       ├── est_amounts: "$250,000 – $1,900,000"
│       ├── est_amount_min: 250000
│       ├── est_amount_max: 1900000
│       ├── funding_method: "Reimbursement(s)"
│       ├── funding_method_notes: null
│       ├── open_date: "2026-06-12T15:41:00"
│       ├── application_deadline: "2026-08-14T00:00:00"
│       ├── deadline_is_ongoing: false
│       ├── award_period: "10/01/26 - 09/30/29"
│       ├── exp_award_date: "10/21/26"
│       ├── elec_submission_url: "https://example.com/apply"
│       ├── grant_url: "https://www.cde.ca.gov/..."
│       ├── agency_url: "https://www.cde.ca.gov/"
│       ├── agency_subscribe_url: null
│       ├── grant_events_url: null
│       ├── contact_name: "Grant Program Office"
│       ├── contact_email: "PCSGP@cde.ca.gov"
│       ├── contact_phone: "1-916-322-6029"
│       ├── award_stats: null
│       ├── organization_uid: null
│       └── updated_at: "2026-06-18T14:00:00Z"
│
├── organizations/
│   └── {uid}/                        ← Firebase Auth UID or dev-profile UID
│       ├── uid: "firebase-uid-..."
│       ├── name: "Modesto Food Bank"
│       ├── ein: "12-3456789"
│       ├── ntee_code: "K30"
│       ├── irc_status: "501(c)(3)"
│       ├── mission: "..."
│       ├── founded_year: 2010
│       ├── address: "123 Main St"
│       ├── city: "Modesto"
│       ├── state: "CA"
│       ├── zip: "95350"
│       ├── website: "https://foodbank.org"
│       ├── phone: "209-555-0100"
│       ├── contact_name: "Jane Smith"
│       ├── contact_email: "jane@foodbank.org"
│       ├── annual_budget: 850000
│       ├── staff_count: 12
│       ├── volunteer_count: 45
│       ├── service_area: "Stanislaus County"
│       ├── target_population: "Food-insecure families..."
│       ├── description: "..."
│       ├── programs: [
│       │   { "name": "Emergency Food Box", "description": "...", "budget": 200000 }
│       │ ]
│       └── updated_at: "2026-06-18T14:00:00Z"
│
├── watchlist/
│   └── {uid}/
│       └── {portal_id}/
│           ├── portal_id: "171870"
│           ├── saved: true
│           ├── note: "Review for Q3 funding cycle"
│           └── updated_at: "2026-06-18T14:00:00Z"
│
└── drafts/
    └── {uid}/
        └── {draft_id}/
            ├── draft_id: "local-uuid-..." or AI-generated UUID
            ├── grant_portal_id: "171870"
            ├── status: "draft"
            ├── version: 1
            ├── generation_mode: "ai" | "local_scaffold" | "manual"
            ├── section_org_overview: "..."
            ├── section_need_statement: "..."
            ├── section_project_description: "..."
            ├── section_goals_objectives: "..."
            ├── section_implementation_plan: "..."
            ├── section_evaluation_plan: "..."
            ├── section_budget_narrative: "..."
            ├── section_sustainability: "..."
            ├── section_org_capacity: "..."
            ├── section_loi_text: null
            ├── ai_model_used: "claude-sonnet-4-6"
            ├── ai_prompt_version: 1
            ├── generation_tokens: 8200
            ├── user_edited: false
            ├── provenance_org_uid: "firebase-uid-..."
            ├── provenance_note: "Generated from live AI sections"
            ├── scaffold_template_version: null
            ├── title: "Draft: 2026-27 Public Charter Schools..."
            ├── body: "..." (concatenated sections)
            ├── notes: null
            ├── created_at: "2026-06-18T14:00:00Z"
            └── updated_at: "2026-06-18T14:00:00Z"
```

### 5.4 Firebase Security Rules

```json
{
  "rules": {
    "grants": {
      ".read": true,
      ".write": false
    },
    "organizations": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid"
      }
    },
    "watchlist": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid"
      }
    },
    "drafts": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid"
      }
    }
  }
}
```

The service account token bypasses these rules. User ID tokens must pass them. The dev profile uses the service account client and therefore also bypasses them — this is intentional for local development.

### 5.5 Grant Filtering Strategy

RTDB does not support compound SQL-style queries. The grant catalog (~200 rows, ~500 KB) is loaded once per session into `AppState.grant_cache: Option<Vec<GrantRecord>>` and filtered in-memory in Rust (`state.rs::grant_catalog()`). The cache is invalidated after every ingest sync (`state.rs::invalidate_grant_cache()`). All filter logic lives in `src/lib/shell.ts::grantMatchesFilters()` on the frontend.

---

## 6. Rust Backend — Tauri Commands

All commands are registered in `main.rs` and implemented in `commands/mod.rs`. Commands are thin: they extract state, call a service function or RTDB method, and return. All business logic is in `state.rs`, `ingest/mod.rs`, and `ai/`.

### 6.1 Full Command List (Current)

| Command | Auth Required | Description |
|---|---|---|
| `get_app_snapshot` | No | Returns `AppSnapshot` — config + session state |
| `get_local_config` | No | Returns `LocalConfig` from disk |
| `update_local_config` | No | Persists config fields |
| `sign_in_with_email_password` | No | Firebase email/password → sets session |
| `start_dev_profile` | No | Seeds dev org, sets long-lived session |
| `refresh_session` | No | Exchanges refresh token for new ID token |
| `clear_session` | No | Clears session + uid from config |
| `validate_setup` | No | Returns `SetupValidation` |
| `list_grants` | No | Returns cached grant catalog |
| `get_grant` | No | Returns single grant from cache or RTDB |
| `upsert_grant` | Service client | Writes a grant record to RTDB |
| `delete_grant` | Service client | Deletes a grant from RTDB |
| `sync_public_grants` | Service client | Runs CA CSV ingest |
| `list_organization` | User client | Reads org profile for current UID |
| `upsert_organization` | User client | Writes org profile |
| `delete_organization` | User client | Deletes org from RTDB |
| `list_watchlist` | User client | Returns all watchlist entries for UID |
| `upsert_watchlist_entry` | User client | Adds/updates a watchlist entry |
| `delete_watchlist_entry` | User client | Removes a watchlist entry |
| `list_drafts` | User client | Returns all drafts for UID |
| `get_draft` | User client | Returns single draft |
| `upsert_draft` | User client | Saves draft edits |
| `generate_draft` | User client | AI or scaffold draft generation |
| `delete_draft` | User client | Deletes draft from RTDB |
| `export_draft` | User client | Runs docx sidecar, returns file path |
| `ping` | No | Health check |

### 6.2 AppState

```rust
pub struct AppState {
    inner: Arc<RwLock<AppStateInner>>,
}

struct AppStateInner {
    config_store: ConfigStore,
    config: LocalConfig,
    session: Option<FirebaseSession>,
    grant_cache: Option<Vec<GrantRecord>>,
}
```

### 6.3 LocalConfig (persisted to disk + env overrides)

```rust
pub struct LocalConfig {
    pub firebase_rtdb_url: Option<String>,      // env: GRANT_KEEPER_DEFAULT_FIREBASE_RTD_URL
    pub firebase_web_api_key: Option<String>,   // env: GRANT_KEEPER_DEFAULT_FIREBASE_WEB_API_KEY
    pub firebase_auth_domain: Option<String>,   // env: GRANT_KEEPER_DEFAULT_FIREBASE_AUTH_DOMAIN
    pub anthropic_api_key: Option<String>,      // env: GRANT_KEEPER_DEFAULT_ANTHROPIC_API_KEY
    pub firebase_uid: Option<String>,           // env: GRANT_KEEPER_DEFAULT_FIREBASE_UID
    pub setup_complete: bool,
    pub last_sync_at: Option<DateTime<Utc>>,
}
```

### 6.4 Two RTDB Clients in AppState

**Service account client** (`rtdb_service_client()`): Used for grant writes, ingest, and grant reads. Token obtained from `GRANT_KEEPER_FIREBASE_SERVICE_ACCOUNT_JSON` (path to key file) or `GRANT_KEEPER_RTDB_AUTH_TOKEN` (raw token). Falls back to no-auth for emulator dev.

**User client** (`rtdb_client()`): Used for org, watchlist, draft CRUD. Token is the Firebase ID token from the current session. Falls back to service client in dev profile mode (since dev profile skips Firebase Auth).

Both clients are `RealtimeDatabaseClient` from `src-tauri/src/rtdb.rs`, which wraps `RtdbClient` from `rtdb-rs`.

---

## 7. Auth — Dual Path

### 7.1 Firebase Email/Password (Production)

1. User enters email + password in `SetupPage.tsx`.
2. Frontend calls `api.signInWithEmailPassword({ email, password })`.
3. Rust: `firebase.rs::FirebaseAuthClient::sign_in_with_email_password()` POSTs to Firebase Identity Toolkit.
4. Returns `FirebaseSession` with `id_token`, `refresh_token`, `uid`, `expires_at`.
5. Session stored in `AppState`. `uid` written to `LocalConfig` on disk.
6. All subsequent RTDB org/watchlist/draft calls use `session.id_token` as the auth token.

**Token refresh:** Before any RTDB call, `state.rs::ensure_valid_session()` checks `session.is_expiring_soon()` (within 5 minutes of expiry). If so, calls `firebase.rs::refresh_session()` which POSTs to `securetoken.googleapis.com/v1/token`. Dev profile sessions (`id_token.starts_with("dev:")`) are never refreshed.

### 7.2 Dev Profile (Development Only)

1. User clicks "Start local dev profile" in `SetupPage.tsx`.
2. Rust: `state.rs::start_dev_profile()` generates a synthetic UID (`dev-{uuid}`), creates a long-lived (10-year) `FirebaseSession` with a `dev:` prefixed token.
3. Seeds a demo `OrganizationRecord` to RTDB if none exists.
4. Sets `setup_complete: true` in config.
5. All RTDB calls go through the service account client (dev sessions bypass Firebase Auth rules).
6. UI shows "Dev Mode" state in session panel.

**Detection:** `is_dev_session()` checks `email.ends_with("@grantkeeper.local")` or `id_token.starts_with("dev:")`.

---

## 8. AI Draft Generation

### 8.1 Model

`claude-sonnet-4-6`. Constant: `DRAFT_MODEL` in `src-tauri/src/ai/prompts.rs`. Do not change without updating both the constant and the spec.

### 8.2 Two Paths

**AI path** (when `LocalConfig.anthropic_api_key` is `Some` and non-empty):
- Validates org fields first (`missing_org_fields_for_generation()`)
- Validates grant fields (`missing_grant_fields_for_generation()`)
- Builds `DraftPromptBundle` via `build_draft_prompt_bundle()`
- Calls `AnthropicClient::generate_section()` sequentially for each section
- Stores result with `generation_mode: "ai"`

**Scaffold path** (when no API key):
- `build_local_draft_scaffold()` in `commands/mod.rs`
- Generates grant-aware, field-substituted placeholder text — not lorem ipsum
- Stores result with `generation_mode: "local_scaffold"`
- Immediately editable and exportable

### 8.3 API Call

```rust
// src-tauri/src/ai/client.rs — AnthropicClient::generate_section()
self.http
    .post("https://api.anthropic.com/v1/messages")
    .header("x-api-key", &self.api_key)
    .header("anthropic-version", "2023-06-01")
    .json(&MessagesRequest {
        model: DRAFT_MODEL,    // "claude-sonnet-4-6"
        max_tokens: 1200,
        system: system_prompt,
        messages: vec![Message { role: "user", content: prompt }],
    })
    .send().await?
```

### 8.4 System Prompt

```
You are an expert nonprofit grant writer with 15 years of experience winning
California state grant applications. You write clearly, specifically, and
persuasively. You always tie the organization's work directly to the funder's
stated priorities. You write in professional prose - no headers, no bullet
points, no markdown formatting of any kind. Each section is a self-contained
paragraph or set of paragraphs.
```

### 8.5 Prompt Version

`DRAFT_PROMPT_VERSION: u32 = 1` in `prompts.rs`. Increment when any prompt template changes. Stored on the draft record as `ai_prompt_version`.

### 8.6 Org Fields Required Before Generation (Blocks Both AI and Scaffold)

| Field | Why |
|---|---|
| `name` | Used in every section |
| `ein` | Required on most CA grant applications |
| `irc_status` | Confirms nonprofit eligibility |
| `mission` | Core of overview and need statement |
| `target_population` | Core of need statement |
| `service_area` | Must match grant geography |
| `annual_budget` | Budget narrative |
| `programs` (≥ 1) | Project description |
| `contact_name` | LOI and autofill |
| `contact_email` | LOI and autofill |

---

## 9. Ingest — CA Grants Portal CSV

### 9.1 Feed URL

```
https://data.ca.gov/dataset/e1b1c799-cdd4-4219-af6d-93b79747fffb/resource/111c8c88-21f6-453c-ae2c-b4785a0624f5/download/california-grants-portal-data.csv
```

`DEFAULT_CA_GRANTS_CSV_URL` constant in `ingest/mod.rs`. Public domain. No API key. Updated daily ~8:45 PM PT. Strip BOM (`\u{FEFF}`) before parsing.

### 9.2 Ingest Flow (`sync_public_grants()`)

```
1. reqwest GET the CSV URL
2. Strip BOM
3. Parse headers from row 0
4. For each row: parse into GrantRecord (skip + log on error, never abort)
5. Build BTreeMap<String, GrantRecord> keyed by portal_id
6. PUT entire map to /grants (full overwrite — atomic from Firebase's perspective)
7. If mark_missing_closed=true: compare against existing keys, count absences
8. Return GrantIngestReport { source_url, total_rows, upserted, closed_missing }
9. Caller invalidates grant_cache in AppState
10. Caller writes last_sync_at to LocalConfig
```

### 9.3 Parsing Rules (Verified Against `ingest/mod.rs`)

| Rule | Implementation |
|---|---|
| BOM strip | `text.strip_prefix('\u{feff}')` |
| `"N/A"` or blank | `normalize_text()` → `None` |
| Dollar strings | `clean_money()` strips `$`, commas → `parse::<i64>()` |
| Ranges `"$250,000 – $1,900,000"` | `parse_amount_range()` splits on ` – `, ` - `, `—` etc. |
| `"Dependent"` | `→ (None, None)` for amount fields |
| Semicolon lists | `split("; ")` → `Vec<String>` |
| Contact string | `split(';')` → `split(':')` → `name`, `email`, `tel` fields |
| Submission URL | `strip_prefix("url: ")` |
| `"Ongoing"` deadline | `deadline_is_ongoing: true`, `application_deadline: None` |

### 9.4 Full CSV Column → Rust Field Mapping

| CSV Column | Rust Field |
|---|---|
| `PortalID` | `portal_id: String` (RTDB node key) |
| `GrantID` | `grant_id_external: Option<String>` |
| `Status` | `status: Option<String>` |
| `LastUpdated` | `last_updated_source: Option<String>` |
| `ChangeNotes` | `change_notes: Option<String>` |
| `AgencyDept` | `agency_dept: Option<String>` |
| `Title` | `title: String` |
| `Type` | `grant_type: Option<String>` |
| `LOI` | `loi_required: bool` (`"Yes"` → `true`) |
| `Categories` | `categories: Vec<String>` (split `"; "`) |
| `CategorySuggestion` | `category_suggestion: Option<String>` |
| `Purpose` | `purpose: Option<String>` |
| `Description` | `description: Option<String>` |
| `ApplicantType` | `applicant_types: Vec<String>` (split `"; "`) |
| `ApplicantTypeNotes` | `applicant_type_notes: Option<String>` |
| `Geography` | `geography: Option<String>` |
| `FundingSource` | `funding_source: Option<String>` |
| `FundingSourceNotes` | `funding_source_notes: Option<String>` |
| `MatchingFunds` | `matching_funds: Option<String>` |
| `MatchingFundsNotes` | `matching_funds_notes: Option<String>` |
| `EstAvailFunds` | `est_avail_funds: Option<String>` + `est_avail_funds_numeric: Option<i64>` |
| `EstAwards` | `est_awards: Option<String>` |
| `EstAmounts` | `est_amounts: Option<String>` + `est_amount_min/max: Option<i64>` |
| `FundingMethod` | `funding_method: Option<String>` |
| `FundingMethodNotes` | `funding_method_notes: Option<String>` |
| `OpenDate` | `open_date: Option<String>` |
| `ApplicationDeadline` | `application_deadline: Option<String>` + `deadline_is_ongoing: bool` |
| `AwardPeriod` | `award_period: Option<String>` |
| `ExpAwardDate` | `exp_award_date: Option<String>` |
| `ElecSubmission` | `elec_submission_url: Option<String>` (strip `"url: "`) |
| `GrantURL` | `grant_url: Option<String>` |
| `AgencyURL` | `agency_url: Option<String>` |
| `AgencySubscribeURL` | `agency_subscribe_url: Option<String>` |
| `GrantEventsURL` | `grant_events_url: Option<String>` |
| `ContactInfo` | `contact_name`, `contact_email`, `contact_phone: Option<String>` |
| `AwardStats` | `award_stats: Option<String>` |

### 9.5 Canonical Category Values

```
Agriculture | Animal Services | Consumer Protection | Disadvantaged Communities
Disaster Prevention & Relief | Education | Employment, Labor & Training | Energy
Environment & Water | Food & Nutrition | Health & Human Services
Housing, Community and Economic Development | Law, Justice, and Legal Services
Libraries and Arts | Parks & Recreation | Science, Technology, and Research & Development
Transportation | Veterans & Military
```

### 9.6 Canonical Applicant Type Values

```
Business | Individual | Nonprofit | Other Legal Entity | Public Agency | Tribal Government
```

---

## 10. Frontend — React / Vite

### 10.1 Pages (All Implemented)

| Route/Surface | Component | Status |
|---|---|---|
| `"setup"` | `SetupPage.tsx` | ✅ Done |
| `"dashboard"` | `DashboardPage.tsx` | ✅ Done |
| `"discover"` | `GrantDiscoveryPage.tsx` | ✅ Done |
| `"grant"` | `GrantDetailPage.tsx` | ✅ Done |
| `"watchlist"` | `WatchlistPage.tsx` | ✅ Done |
| `"organization"` | `OrganizationPage.tsx` | ✅ Done |
| `"drafts"` | `DraftsPage.tsx` | ✅ Done |

Surface routing is handled in `App.tsx` via `activeSurface: Surface` state — not React Router. This is correct for a Tauri desktop app.

### 10.2 Tauri invoke() Wrappers (`src/lib/tauri.ts`)

All backend calls go through the typed `api` object. No `invoke()` calls exist outside this file. This is a hard rule — adding a new command means adding it to `tauri.ts` first.

### 10.3 Key Frontend Rules

- All filtering runs synchronously in `src/lib/shell.ts::grantMatchesFilters()` after `listGrants()` loads the full catalog.
- Search is debounced at 300ms (via React controlled input in `GrantDiscoveryPage.tsx`).
- `normalizeGrantRecords()`, `normalizeWatchlistEntries()`, `normalizeOrganization()`, `normalizeDraftRecords()` in `shell.ts` are the single point of data shape normalization from RTDB payloads into typed frontend objects.
- No `localStorage` or `sessionStorage`. All persistence goes through Tauri commands to the Rust config store or RTDB.
- Draft generation mode badge: "AI Draft" or "Local Scaffold — Edit before exporting" based on `generation_mode`.

### 10.4 Grant Discovery Filters

Implemented in `GrantDiscoveryPage.tsx` + `shell.ts`:
- Free text search (title, purpose, agency, description, status)
- Status: all / active / forecasted
- Categories: multi-select chip array
- Min/max amount
- Deadline window: any / 30 / 60 / 90 days
- LOI required: any / yes / no
- Matching funds: any / yes / no
- Watchlist only toggle

---

## 11. .docx Export Sidecar

### 11.1 Architecture

1. `export_draft` command in Rust serializes `DraftRecord + GrantRecord + OrganizationRecord` to a temp JSON file.
2. Spawns `node worker.mjs <payload_path> <output_dir>` via `tokio::process::Command`.
3. `worker.mjs` reads JSON, builds a `docx.Document` with sections for each draft field, writes to `~/Downloads/Grant Keeper/<title>-<draft_id>.docx`.
4. Worker prints the output path to stdout.
5. Rust reads stdout, deletes the temp JSON, returns the path to the frontend.
6. Frontend calls `open(filePath)` via `@tauri-apps/plugin-shell`.

### 11.2 Section Rendering (`worker.mjs`)

`sectionParagraphs(title, body)` renders a `HEADING_2` followed by body paragraphs split on double newlines. Sections rendered in order:
1. Organization Overview
2. Need Statement
3. Project Description
4. Goals and Objectives
5. Implementation Plan
6. Evaluation Plan
7. Budget Narrative
8. Sustainability
9. Organization Capacity
10. Letter of Intent (if present)

### 11.3 File Naming

`sanitizeFileStem()` in `worker.mjs` replaces `[\\/:*?"<>|]+` with `-`, trims, and caps at 120 chars. Output: `{stem}.docx` in `~/Downloads/Grant Keeper/`.

---

## 12. Grant Field Requirements

### 12.1 Fields the AI Uses

| Field | AI Sections | Why |
|---|---|---|
| `title` | All | Used in every prompt |
| `agency_dept` | Overview, Capacity, LOI | Funder name affects tone |
| `purpose` | Need, Project, LOI | Primary alignment anchor |
| `description` | Project, Goals | Full program context |
| `categories` | Need, Goals, Eval | Drives narrative focus |
| `applicant_types` + notes | Overview | Eligibility context |
| `geography` | Need, LOI | Geographic match |
| `funding_source` | Budget | Federal = compliance language |
| `matching_funds` | Budget | Required = address match source |
| `funding_method` | Project, Budget | Reimbursement framing |
| `award_period` | Implementation | Constrains timeline |
| `application_deadline` | LOI | Urgency language |
| `est_amounts` | Budget | Scopes narrative |
| `loi_required` | — | Triggers/skips section 10 |

### 12.2 Fields Surfaced to User Only (Not in Prompts)

`grant_url`, `elec_submission_url`, `agency_url`, `agency_subscribe_url`, `grant_events_url`, `contact_*`, `award_stats`, `category_suggestion`, `change_notes`.

---

## 13. Draft Sections & Prompt Templates

All prompts are implemented in `src-tauri/src/ai/prompts.rs::build_draft_prompt_bundle()`. What follows is the authoritative documentation of each section's intent and the variables it uses. Any change to prompts must update this spec first, then the Rust source, then increment `DRAFT_PROMPT_VERSION`.

**System prompt** (applied to every section call):
```
You are an expert nonprofit grant writer with 15 years of experience winning
California state grant applications. You write clearly, specifically, and
persuasively. You always tie the organization's work directly to the funder's
stated priorities. You write in professional prose - no headers, no bullet
points, no markdown formatting of any kind. Each section is a self-contained
paragraph or set of paragraphs.
```

| # | Section | Target Length | Key Variables |
|---|---|---|---|
| 1 | Org Overview | 200–300 words | grant.title, grant.agency_dept, grant.purpose, org.name, org.ein, org.irc_status, org.founded_year, org.mission, org.annual_budget, org.staff_count, org.volunteer_count, org.service_area, org.target_population, org.programs |
| 2 | Need Statement | 250–350 words | grant.title, grant.purpose, grant.categories, grant.geography, grant.applicant_types, org.target_population, org.service_area, org.mission |
| 3 | Project Description | 350–500 words | grant.title, grant.agency_dept, grant.purpose, grant.description, grant.est_amounts, grant.award_period, grant.funding_method, org.name, org.programs, org.target_population, org.service_area |
| 4 | Goals & Objectives | 200–300 words | grant.title, grant.categories, grant.award_period, org.programs, org.target_population |
| 5 | Implementation Plan | 250–350 words | grant.title, grant.award_period, org.name, org.staff_count, org.programs |
| 6 | Evaluation Plan | 200–300 words | grant.title, grant.categories, org.name, org.target_population |
| 7 | Budget Narrative | 200–300 words | grant.title, grant.est_amounts, grant.funding_method, grant.matching_funds, grant.matching_funds_notes, org.annual_budget, org.staff_count, org.programs |
| 8 | Sustainability | 150–250 words | grant.title, grant.award_period, org.name, org.programs, org.annual_budget, org.mission |
| 9 | Org Capacity | 200–300 words | grant.title, grant.agency_dept, org.name, org.staff_count, org.volunteer_count, org.founded_year, org.annual_budget, org.programs, org.irc_status |
| 10 | Letter of Intent | 400–500 words | grant.title, grant.agency_dept, grant.purpose, grant.application_deadline, grant.geography, org.name, org.ein, org.mission, org.irc_status, org.annual_budget, org.contact_name, org.contact_email |

Section 10 is only generated when `grant.loi_required == true`.

Budget narrative includes matching fund language only when `grant.matching_funds` equals `"Required"` (case-insensitive check in `prompts.rs`).

---

## 14. Setup & First-Run Experience

### 14.1 Current Setup Wizard (SetupPage.tsx)

Fields collected:
- Firebase RTDB URL (required — blocks all other surfaces if missing)
- Firebase Web API Key (required for real Firebase sign-in)
- Firebase Auth Domain
- Anthropic API Key (optional — scaffold mode always available)
- Email + Password (optional — skip for dev profile)

Actions:
- **Save session settings** — saves config, optionally signs in with Firebase, marks `setup_complete: true`, navigates to dashboard
- **Start local dev profile** — saves config, creates synthetic session, seeds demo org, marks setup complete
- **Reset form** — reloads from stored config

### 14.2 Redirect Logic

On cold start, if `config.setup_complete == false` or `setup_validation.ready == false`, `App.tsx` forces `activeSurface = "setup"`. The `visibleSurface` computed value always returns `"setup"` in this case regardless of `activeSurface`.

### 14.3 Future Setup (Phase 7 — Managed Account)

When the central Axum API is in place, the setup wizard simplifies to:
1. Email + password → POST `/auth/register` or `/auth/login`
2. Org profile form
3. Plan selection (free or Pro)

No Firebase credentials needed from the user. The API manages the Firebase project.

---

## 15. Freemium Tier Definitions

These are the tiers for the finished SaaS product. The Tauri app currently has no enforcement — enforcement arrives in Phase 7 when the central API manages accounts.

| Capability | Free | Pro |
|---|---|---|
| Grant catalog (full, live) | ✅ | ✅ |
| Filters and search | ✅ | ✅ |
| Watchlist | Up to 20 saved | Unlimited |
| Org profile | ✅ | ✅ |
| Manual draft editing | ✅ | ✅ |
| Scaffold draft generation | 5/month | Unlimited |
| Export to .docx | ✅ | ✅ |
| AI draft generation | ❌ | ✅ — uses credits |
| AI credits (monthly allotment) | 0 | 50 included |
| Additional AI credit packs | ❌ | Available for purchase |
| Browser autofill extension | ❌ | ✅ |
| Support | GitHub Issues | Email priority |

**Credit definition:** 1 credit = 1 full AI draft (all 9 sections, or 10 with LOI). Single section regeneration = 0.1 credits. Credits do not roll over month to month. Purchased packs roll over.

**Tier stored at:** `/organizations/{uid}/plan: "free" | "pro"` in RTDB. In Phase 7, also stored in the central Postgres DB and enforced server-side by the Axum API. The frontend checks plan for UX gating only — never trust the client for access control.

---

## 16. SaaS Account System — Phase 7

This section describes the central Axum API that transforms Grant Keeper from a self-configured desktop app into a managed SaaS. Users create accounts on your platform — no Firebase console, no service account download, no API keys from the user.

### 16.1 Central API

- **Language:** Rust / Axum 0.7
- **Port:** 9091 (avoids collision with Ember on 9090)
- **Database:** Firebase RTDB via `rtdb-rs` (same crate, same data model)
- **Auth issued:** Your own JWTs (HS256, 24-hour lifetime)

### 16.2 Route Table

```
POST  /api/v1/auth/register        { email, password, org_name } → { token, org }
POST  /api/v1/auth/login           { email, password } → { token }
POST  /api/v1/auth/refresh         { token } → { token }
POST  /api/v1/auth/logout          → 204

GET   /api/v1/grants               Filter/search grants (in-memory from RTDB cache)
GET   /api/v1/grants/:portal_id    Single grant detail

GET   /api/v1/watchlist            Org watchlist
POST  /api/v1/watchlist            { portal_id } → add
DELETE /api/v1/watchlist/:portal_id → remove

GET   /api/v1/org/profile          Org profile
PUT   /api/v1/org/profile          Update profile

GET   /api/v1/drafts               List summaries
GET   /api/v1/drafts/:id           Full draft
POST  /api/v1/drafts               { portal_id, mode } → create blank/scaffold
PUT   /api/v1/drafts/:id           Save edits
DELETE /api/v1/drafts/:id          Soft delete
GET   /api/v1/drafts/:id/export    Returns .docx binary

POST  /api/v1/drafts/generate      { portal_id } → AI draft (Pro, costs 1 credit)
POST  /api/v1/drafts/:id/regenerate-section  { section } → (Pro, costs 0.1 credits)

GET   /api/v1/credits/balance      { balance, next_reset }
GET   /api/v1/credits/history      Last 50 ledger entries

GET   /api/v1/extension/autofill-data/:portal_id  Pro only — org + draft + mappings + grant

POST  /api/v1/admin/sync           Trigger CSV ingest (service token)
GET   /api/v1/admin/sync/status    Last sync result
```

### 16.3 Credit Ledger in RTDB

```
/credits/
  └── {org_id}/
      └── {push_key}/
          ├── amount: 50.0      ← positive=add, negative=consume
          ├── reason: "monthly_reset" | "draft_generation" | "section_regen" | "purchase"
          ├── draft_id: null
          └── created_at: "..."
```

Balance = `SUM(amount)` across all entries for the org. Deduction is a new POST with a negative amount — never DELETE or UPDATE existing entries. This is an append-only ledger.

### 16.4 Email Uniqueness Index

RTDB has no `WHERE email = ?`. Maintain:
```
/email_index/
  └── {base64url(email)}: "org-uid-..."
```

On registration: check this key. On login: read it to get `org_id`, then read `/organizations/{org_id}`.

### 16.5 Hosting

**Phase 7 start (prototype):** Home server, same box as Ember. Nginx proxies `api.grantkeeper.app` → `localhost:9091`. Docker Compose service alongside existing Ember containers.

**Phase 7+ (paying users):** Migrate to Fly.io (`sjc` region). API is stateless — all state is in Firebase. Migration = update DNS record, push Docker image, done. No data migration.

### 16.6 Tauri App Changes in Phase 7

The Tauri app becomes a thin HTTPS client. `AppState` loses the direct RTDB clients and replaces them with an `api_client.rs` making `reqwest` calls to `api.grantkeeper.app/api/v1`. The dev profile path is retained. The setup wizard simplifies. The `rtdb-rs` crate moves from the Tauri app into the Axum API.

---

## 17. Browser Extension — Phase 9

### 17.1 Overview

Manifest V3 Chrome extension (Firefox compatible with minor changes). Distributed as `.crx` initially, Chrome Web Store in Phase 11.

**User flow:**
1. User opens a grant application form on a grantor site.
2. Extension badge shows if a form mapping exists.
3. Popup shows: which grant, which draft will be used, fields to be filled.
4. User clicks "Autofill" → content script fills all mapped fields.
5. User reviews and submits manually. The extension **never submits.**

### 17.2 Auth

Extension stores the JWT from the central API in `chrome.storage.session`. User logs in via the popup using the same email/password as the desktop app — same `/auth/login` endpoint. The extension Pro gates via the `/extension/autofill-data/:portal_id` endpoint returning 403 for free accounts.

### 17.3 Form Field Mapping Schema

Stored in RTDB at `/form_mappings/{portal_id}` and bundled in the extension as a local cache.

```json
{
  "portal_id": "171870",
  "site_url_pattern": "applications.cdfa.ca.gov/grants/*",
  "form_version": 1,
  "verified_at": "2026-06-18",
  "fields": [
    {
      "field_id": "org_name",
      "label": "Organization Name",
      "selector": "#applicant-name",
      "selector_fallback": "[name='orgName']",
      "source": "org.name",
      "type": "text"
    },
    {
      "field_id": "project_description",
      "label": "Project Description",
      "selector": "#project-desc",
      "source": "draft.section_project_description",
      "type": "textarea"
    }
  ]
}
```

`source` resolves as a dot-path against the `autofill-data` API response: `org.*`, `draft.*`, `grant.*`.

### 17.4 React-Aware Form Fill

Most CA grant sites use React. Direct `el.value = x` is silently ignored by React-controlled inputs. Required pattern:

```typescript
function fillField(el: HTMLElement, value: string) {
    const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
    )?.set;
    nativeSetter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
}
```

For `<textarea>`, use `HTMLTextAreaElement.prototype`.

### 17.5 Initial Grant Sites to Map (CA Grants Portal)

Add `host_permissions` in `manifest.json` and mapping JSON for each site as form mappings are verified manually. Start with the highest-volume CA grantor sites after the first real nonprofit beta user identifies which sites they apply to most.

---

## 18. Hosting & Deployment

### 18.1 Current (Phases 1–6)

User brings their own Firebase project via setup wizard. App is distributed as a Tauri installer. No server infrastructure required.

### 18.2 Phase 7+ (Central API on Home Server)

```yaml
# Addition to existing docker-compose.yml
services:
  grant-keeper-api:
    build: ./api
    ports:
      - "9091:9091"
    environment:
      FIREBASE_RTDB_URL: ${GK_RTDB_URL}
      FIREBASE_SERVICE_ACCOUNT: ${GK_SERVICE_ACCOUNT_JSON}
      JWT_SECRET: ${GK_JWT_SECRET}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
    restart: unless-stopped
```

```nginx
server {
    listen 443 ssl;
    server_name api.grantkeeper.app;
    location / {
        proxy_pass http://127.0.0.1:9091;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 18.3 Phase 10 — Tauri Release Pipeline

GitHub Actions `release.yml`:
1. Trigger on `v*.*.*` tag push.
2. Build on `ubuntu-latest`, `macos-latest`, `windows-latest` in parallel.
3. Each produces `.AppImage` / `.dmg` / `.msi`.
4. `tauri-action` creates GitHub Release, uploads artifacts, generates `latest.json`.
5. `tauri-plugin-updater` polls the endpoint on every app startup.

**Version bumping before tagging:**
1. Update `version` in `tauri.conf.json`
2. Update `version` in `src-tauri/Cargo.toml`
3. Update `version` in root `package.json`
4. Commit: `chore: bump to vX.X.X`
5. `git tag vX.X.X && git push --tags`

---

## 19. Testing Requirements

### 19.1 Unit Tests (`cargo test`)

**`ingest/mod.rs` — CSV parsing (tests exist):**
- BOM stripped correctly
- All 35 columns parse from fixture row
- `"N/A"` → `None` on all nullable fields
- `"$34,000,000"` → `est_avail_funds_numeric: 34000000`
- `"$250,000 – $1,900,000"` → `est_amount_min: 250000`, `est_amount_max: 1900000`
- `"Dependent"` → `(None, None)` for amount range
- `"Ongoing"` → `deadline_is_ongoing: true`, `application_deadline: None`
- `"url: https://example.com"` → `elec_submission_url: Some("https://example.com")`
- `"name: X; email: Y; tel: Z;"` → correct struct fields
- Single bad row does not abort job

**`ai/prompts.rs` — prompt builder (tests exist):**
- All 9 sections produce non-empty strings from fully populated grant + org
- Section 10 (LOI) generated when `loi_required: true`
- Section 10 absent when `loi_required: false`
- Matching fund language present in budget narrative when `matching_funds == "Required"`
- `missing_org_fields_for_generation()` returns `["name", "programs"]` for default org

**`db.rs` — path helpers (tests exist):**
- `grant_path("123")` → `"grants/123"`
- `organization_path("abc")` → `"organizations/abc"`
- `draft_path("uid", "draft")` → `"drafts/uid/draft"`

**`rtdb.rs` — retry logic:**
- Transient errors (connect, timeout) trigger retry up to 3 attempts
- Non-transient errors (Auth, NotFound) propagate immediately

### 19.2 Integration Tests (Firebase Emulator)

```
firebase emulators:start --only database,auth
```

Set `GRANT_KEEPER_DEFAULT_FIREBASE_RTD_URL=http://localhost:9000/?ns=<project>` in test env.

- Ingest writes all grants to `/grants`
- Grant catalog reads back correctly
- Dev profile login → org seeded at `/organizations/{uid}`
- Save org profile → readable back with correct fields
- Add watchlist entry → key appears at `/watchlist/{uid}/{portal_id}`
- Remove watchlist entry → key deleted
- Create scaffold draft → record at `/drafts/{uid}/{draft_id}`
- AI draft (mock Claude) → `generation_mode: "ai"`, all 9 sections present
- LOI draft → 10 sections when `loi_required: true`
- Cross-org isolation: UID A cannot read `/organizations/{uid_b}` (rules enforced)

Live smoke test (ignored in CI, run manually):
```rust
#[tokio::test]
#[ignore]
async fn live_california_csv_sync_smoke() { ... }
```

### 19.3 Manual QA Checklist

Run before every release tag.

**Setup:**
- [ ] Fresh install, setup wizard completes in under 10 minutes
- [ ] Dev profile seeds demo org and navigates to dashboard
- [ ] Firebase email/password sign-in works with real project
- [ ] Config persists across app restart
- [ ] Last sync timestamp updates after CSV sync

**Grants:**
- [ ] Grant list loads after sync
- [ ] All filters return correct subsets
- [ ] Grant detail shows all fields
- [ ] `"Ongoing"` deadline displayed correctly
- [ ] Amount ranges displayed correctly

**Watchlist:**
- [ ] Add grant to watchlist → persists in RTDB
- [ ] Remove from watchlist → key deleted in RTDB
- [ ] Watchlist page shows correct grant metadata

**Org Profile:**
- [ ] All required fields save and round-trip correctly
- [ ] Programs serialize/deserialize through `name | description | budget` format

**Drafts:**
- [ ] Missing required org fields block generation with field list
- [ ] AI draft shows all 9 (or 10) sections with real content
- [ ] Scaffold draft generates immediately with grant-aware text
- [ ] `generation_mode` badge correct on both types
- [ ] User edits save and update `user_edited: true`
- [ ] Draft persists in RTDB under correct uid path

**Export:**
- [ ] `.docx` opens in Word and LibreOffice without errors
- [ ] All sections present with correct headings
- [ ] LOI section present when `loi_required: true`, absent when not
- [ ] File lands in `~/Downloads/Grant Keeper/`

---

## 20. Phase Roadmap

| Phase | Description | Status |
|---|---|---|
| 1 | Tauri command/state scaffold | ✅ Done |
| 2 | Firebase RTDB + rtdb-rs as live runtime + dual auth | ✅ Done |
| 3 | Frontend shell and all page surfaces | ✅ Done |
| 4 | Live CA grants CSV sync + grant detail | ✅ Done |
| 5 | Watchlist, org profile, draft CRUD | ✅ Done |
| 6 | Dev profile, scaffold draft fallback, .docx export | ✅ Done |
| 7 | Central Axum API + managed account system + freemium enforcement | ⬜ Next |
| 8 | AI credit system + per-section regeneration | ⬜ |
| 9 | Browser extension autofill (Pro) | ⬜ |
| 10 | Release pipeline — Tauri build + GitHub Releases + auto-updater | ⬜ |
| 11 | Chrome Web Store submission | ⬜ |
| 12 | Stripe payment integration (credits + Pro billing) | ⬜ |
| 13 | Multi-state grant expansion (beyond CA) | ⬜ |

**Phase 7 definition of shipped:** At least one real nonprofit org has registered on the managed platform (no Firebase credentials from the user), saved their profile, and generated an AI draft — with the central Axum API using `rtdb-rs` as its sole RTDB client. That is the portfolio milestone.

---

## 21. Definition of Done

A feature is done when **all** of the following are true. No exceptions.

- [ ] `cargo build --release` completes with no warnings.
- [ ] `npm run build` completes with no errors.
- [ ] `cargo test` passes in full.
- [ ] Any new RTDB paths are documented in §5.3.
- [ ] Any new Tauri commands are listed in §6.1 and added to `src/lib/tauri.ts`.
- [ ] Any new frontend surfaces are listed in §10.1.
- [ ] No raw `reqwest` calls to Firebase — all Firebase I/O goes through `RealtimeDatabaseClient` which uses `RtdbClient` from `rtdb-rs`.
- [ ] No `invoke()` calls in React components — all calls go through the `api.*` wrappers in `tauri.ts`.
- [ ] Draft mode badge is correct: `"ai"` shows "AI Draft", `"local_scaffold"` shows "Scaffold Draft".
- [ ] Org field validation blocks draft generation before any RTDB write attempt.
- [ ] Any prompt template changes increment `DRAFT_PROMPT_VERSION` and update §13.
- [ ] Feature works end-to-end in the installed Tauri app (not just `tauri dev`).
- [ ] PR reviewed and approved before merging to `main`.
- [ ] Manual QA checklist items relevant to the feature are verified.

---

*This document is the single source of truth. If reality conflicts with this document, update this document first, then update the code. The codebase described in Phases 1–6 of this spec is the working prototype. Everything in Phases 7–13 is what must be built to deliver a finished SaaS product.*
