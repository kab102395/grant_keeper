import { invoke } from "@tauri-apps/api/core";
import type {
  AppSnapshot,
  ConfigUpdate,
  DraftRecord,
  EmailPasswordSignIn,
  FirebaseSession,
  GrantIngestReport,
  GrantRecord,
  GrantSourceHealthRecord,
  GrantSourceRecord,
  GrantSourceSyncOutcome,
  LocalConfig,
  OrganizationRecord,
  SetupValidation,
  WorkspaceStartRequest,
  WatchlistEntry,
} from "./types";

export const api = {
  getAppSnapshot: () => invoke<AppSnapshot>("get_app_snapshot"),
  getLocalConfig: () => invoke<LocalConfig>("get_local_config"),
  updateLocalConfig: (update: ConfigUpdate) => invoke<LocalConfig>("update_local_config", { update }),
  signInWithEmailPassword: (request: EmailPasswordSignIn) =>
    invoke<FirebaseSession>("sign_in_with_email_password", { request }),
  startDevProfile: () => invoke<FirebaseSession>("start_dev_profile"),
  startWorkspaceProfile: (request: WorkspaceStartRequest) =>
    invoke<FirebaseSession>("start_workspace_profile", { request }),
  refreshSession: () => invoke<FirebaseSession | null>("refresh_session"),
  clearSession: () => invoke<void>("clear_session"),
  validateSetup: () => invoke<SetupValidation>("validate_setup"),
  listGrants: () => invoke<GrantRecord[]>("list_grants"),
  listGrantSources: () => invoke<GrantSourceRecord[]>("list_grant_sources"),
  listGrantSourceHealth: () => invoke<GrantSourceHealthRecord[]>("list_grant_source_health"),
  upsertGrantSource: (source: GrantSourceRecord) => invoke<GrantSourceRecord>("upsert_grant_source", { source }),
  deleteGrantSource: (sourceId: string) => invoke<void>("delete_grant_source", { sourceId }),
  syncGrantSource: (sourceId: string, markMissingClosed?: boolean | null) =>
    invoke<GrantIngestReport>("sync_grant_source", {
      sourceId,
      markMissingClosed: markMissingClosed ?? null,
    }),
  syncEnabledGrantSources: (markMissingClosed?: boolean | null) =>
    invoke<GrantSourceSyncOutcome[]>("sync_enabled_grant_sources", {
      markMissingClosed: markMissingClosed ?? null,
    }),
  syncPublicGrants: (sourceUrl?: string | null, markMissingClosed?: boolean | null) =>
    invoke<GrantIngestReport>("sync_public_grants", {
      sourceUrl: sourceUrl ?? null,
      markMissingClosed: markMissingClosed ?? null,
    }),
  getGrant: (portalId: string) => invoke<GrantRecord | null>("get_grant", { portalId }),
  upsertGrant: (grant: GrantRecord) => invoke<GrantRecord>("upsert_grant", { grant }),
  deleteGrant: (portalId: string) => invoke<void>("delete_grant", { portalId }),
  listOrganization: () => invoke<OrganizationRecord | null>("list_organization"),
  upsertOrganization: (organization: OrganizationRecord) =>
    invoke<OrganizationRecord>("upsert_organization", { organization }),
  deleteOrganization: () => invoke<void>("delete_organization"),
  listWatchlist: () => invoke<WatchlistEntry[]>("list_watchlist"),
  upsertWatchlistEntry: (entry: WatchlistEntry) =>
    invoke<WatchlistEntry>("upsert_watchlist_entry", { entry }),
  deleteWatchlistEntry: (portalId: string) => invoke<void>("delete_watchlist_entry", { portalId }),
  listDrafts: () => invoke<DraftRecord[]>("list_drafts"),
  getDraft: (draftId: string) => invoke<DraftRecord | null>("get_draft", { draftId }),
  upsertDraft: (draft: DraftRecord) => invoke<DraftRecord>("upsert_draft", { draft }),
  saveDraft: (draft: DraftRecord) => invoke<DraftRecord>("upsert_draft", { draft }),
  deleteDraft: (draftId: string) => invoke<void>("delete_draft", { draftId }),
  generateDraft: (grantPortalId: string) => invoke<DraftRecord>("generate_draft", { grantPortalId }),
  exportDraft: (draftId: string, outputPath?: string | null) =>
    invoke<string>("export_draft", { draftId, outputPath: outputPath ?? null }),
  revealPathInFolder: (path: string) => invoke<void>("reveal_path_in_folder", { path }),
  ping: () => invoke<string>("ping"),
};
