import { useMemo } from "react";
import type { AppSnapshot, DraftRecord, GrantIngestReport, GrantRecord, LocalConfig, OrganizationRecord } from "../lib/types";
import { formatTimestamp, type Surface } from "../lib/shell";

function sessionModeLabel(mode: AppSnapshot["session"]["mode"]) {
  switch (mode) {
    case "firebase":
      return "Firebase session";
    case "dev_profile":
      return "Local dev profile";
    default:
      return "No session";
  }
}

function workspaceStatusLabel(snapshot: AppSnapshot | null, config: LocalConfig | null) {
  if (snapshot?.session.signed_in) {
    return sessionModeLabel(snapshot.session.mode);
  }
  if (config?.firebase_rtdb_url) {
    return "Ready to sign in";
  }
  return "Setup required";
}

export function DashboardPage({
  snapshot,
  config,
  organization,
  syncReport,
  onRefreshDatabase,
  onRefreshLiveFeeds,
  grantCount,
  watchlistCount,
  draftCount,
  selectedGrant,
  selectedDraft,
  aiSettingsRequired,
  onOpenSurface,
  onOpenAiSettings,
  }: {
  snapshot: AppSnapshot | null;
  config: LocalConfig | null;
  organization: OrganizationRecord | null;
  syncReport: GrantIngestReport | null;
  onRefreshDatabase: () => Promise<void>;
  onRefreshLiveFeeds: () => Promise<void>;
  grantCount: number;
  watchlistCount: number;
  draftCount: number;
  selectedGrant: GrantRecord | null;
  selectedDraft: DraftRecord | null;
  aiSettingsRequired: boolean;
  onOpenSurface: (
    surface: Surface,
    overrides?: { grantPortalId?: string | null; draftId?: string | null },
  ) => void;
  onOpenAiSettings: () => void;
}) {
  const workspaceStatus = useMemo(() => workspaceStatusLabel(snapshot, config), [config, snapshot]);

  return (
    <div className="surface-stack workspace-stack">
      <section className="panel-block panel-block-soft">
        <div className="detail-header">
          <div>
            <p className="eyebrow">Workspace</p>
            <h3>Workspace overview</h3>
            <p className="muted">A landing page for current session state, cached catalog freshness, and direct jumps into the dedicated pages.</p>
          </div>
          <span className="status-pill">{workspaceStatus}</span>
        </div>

        <div className="info-row">
          <span>Workspace UID: {snapshot?.current_org_uid ?? "not set"}</span>
          <span>{snapshot?.session.signed_in ? sessionModeLabel(snapshot.session.mode) : "No active session"}</span>
          <span>Draft mode: {config?.draft_generation_preference === "ai" ? "AI available" : "Scaffold first"}</span>
          <span>{config?.last_sync_at ? `Catalog synced ${formatTimestamp(config.last_sync_at)}` : "Catalog sync not recorded"}</span>
        </div>

        <div className="surface-actions">
          <button type="button" className="secondary" onClick={() => void onRefreshDatabase()}>
            Refresh database
          </button>
          <button type="button" className="secondary" onClick={() => void onRefreshLiveFeeds()}>
            Sync live sources
          </button>
          <button type="button" className="secondary" onClick={() => onOpenSurface("discover")}>
            Open discovery
          </button>
          <button type="button" className="secondary" onClick={() => onOpenSurface("watchlist")}>
            Open watchlist
          </button>
          <button type="button" className="secondary" onClick={() => onOpenSurface("drafts")}>
            Open drafts
          </button>
          <button type="button" className="secondary" onClick={() => onOpenSurface("organization")}>
            Open org profile
          </button>
          <button type="button" className="secondary" onClick={() => onOpenSurface("dev")}>
            Open dev tools
          </button>
        </div>

        <div className="panel-block panel-block-soft">
          <h4>Current organization</h4>
          {organization ? (
            <p className="field-value">
              {organization.name ?? "Unnamed organization"}
              <span>
                {organization.city ?? "Unknown city"}
                {organization.state ? `, ${organization.state}` : ""}
              </span>
            </p>
          ) : (
            <p className="muted">No organization profile loaded yet.</p>
          )}
        </div>
      </section>

      <div className="stat-grid stat-grid-dashboard">
        <article className="stat-card">
          <span>Grants</span>
          <strong>{grantCount}</strong>
          <p>Catalog available in discovery</p>
        </article>
        <article className="stat-card">
          <span>Watchlist</span>
          <strong>{watchlistCount}</strong>
          <p>Resume from the watchlist surface</p>
        </article>
        <article className="stat-card">
          <span>Drafts</span>
          <strong>{draftCount}</strong>
          <p>Resume from the drafts surface</p>
        </article>
        <article className="stat-card">
          <span>Session</span>
          <strong>{snapshot ? sessionModeLabel(snapshot.session.mode) : "No session"}</strong>
          <p>{snapshot?.session.email ?? "No active identity"}</p>
        </article>
      </div>

      <section className="panel-block">
        <div className="detail-header">
          <div>
            <p className="eyebrow">Resume work</p>
            <h3>Last active items</h3>
            <p className="muted">Use these as shortcuts back into the currently selected grant or draft.</p>
          </div>
          <span className="status-pill">{syncReport ? `Last sync ${formatTimestamp(config?.last_sync_at)}` : "Live catalog ready"}</span>
        </div>

        <div className="info-row">
          <span>{selectedGrant ? `Grant: ${selectedGrant.title}` : "No grant selected"}</span>
          <span>{selectedGrant ? `Source: ${selectedGrant.source_name ?? selectedGrant.source_id ?? "not set"}` : "Open discovery to pick a grant"}</span>
          <span>{selectedDraft ? `Draft: ${selectedDraft.title ?? selectedDraft.draft_id}` : "No draft selected"}</span>
          <span>{selectedDraft ? `Mode: ${selectedDraft.generation_mode}` : "Open drafts to continue editing"}</span>
        </div>

        <div className="list-grid">
          <article className="panel-block panel-block-soft">
            <p className="eyebrow">Current grant</p>
            <h4>{selectedGrant?.title ?? "Nothing selected"}</h4>
            <p className="muted">
              {selectedGrant
                ? `${selectedGrant.agency_dept ?? "Unknown agency"} - ${selectedGrant.deadline_is_ongoing ? "Ongoing" : selectedGrant.application_deadline ?? "No deadline"}`
                : "Open discovery or a grant detail page to resume from the selected opportunity."}
            </p>
            {selectedGrant && aiSettingsRequired ? (
              <p className="muted">AI mode is selected, but this workspace has no Anthropic API key yet. Start with a scaffold draft or open AI settings.</p>
            ) : null}
            <div className="surface-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => onOpenSurface("grant", { grantPortalId: selectedGrant?.portal_id ?? null })}
                disabled={!selectedGrant}
              >
                Resume grant
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => onOpenSurface("drafts", { grantPortalId: selectedGrant?.portal_id ?? null })}
                disabled={!selectedGrant}
              >
                {aiSettingsRequired ? "Create scaffold draft" : "Create draft"}
              </button>
              {aiSettingsRequired ? (
                <button type="button" className="secondary" onClick={onOpenAiSettings}>
                  AI settings
                </button>
              ) : null}
              <button type="button" className="secondary" onClick={() => onOpenSurface("discover")}>
                Open discovery
              </button>
            </div>
          </article>

          <article className="panel-block panel-block-soft">
            <p className="eyebrow">Current draft</p>
            <h4>{selectedDraft?.title ?? "Nothing selected"}</h4>
            <p className="muted">
              {selectedDraft
                ? `Grant Portal ID: ${selectedDraft.grant_portal_id || "not set"}`
                : "Open drafts to continue editing the last working draft."}
            </p>
            <div className="surface-actions">
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  onOpenSurface("drafts", {
                    grantPortalId: selectedGrant?.portal_id ?? null,
                    draftId: selectedDraft?.draft_id ?? null,
                  })
                }
                disabled={!selectedDraft}
              >
                Resume draft
              </button>
              <button type="button" className="secondary" onClick={() => onOpenSurface("drafts")}>
                Open drafts
              </button>
            </div>
          </article>
        </div>

        {syncReport ? (
          <div className="info-row">
            <span>{syncReport.source_name ?? syncReport.source_id ?? "batch sync"}</span>
            <span>{syncReport.total_rows} rows</span>
            <span>{syncReport.upserted} upserted</span>
            <span>{syncReport.closed_missing} closed missing</span>
          </div>
        ) : null}
      </section>
    </div>
  );
}
