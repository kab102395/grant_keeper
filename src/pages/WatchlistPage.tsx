import type { WatchlistEntry, GrantRecord, LocalConfig } from "../lib/types";
import {
  deadlineUrgency,
  grantDeadlineLabel,
  grantFundingLabel,
  grantSourceLabel,
  grantStatusLabel,
  formatTimestamp,
} from "../lib/shell";

function deadlineTone(grant: GrantRecord | undefined) {
  if (!grant) return "distant";
  return deadlineUrgency(grant);
}

export function WatchlistPage({
  watchlist,
  grantsByPortalId,
  onRemove,
  onViewGrant,
  onCreateDraft,
  canWriteOrg,
  writeDisabledReason,
  config,
}: {
  watchlist: WatchlistEntry[];
  grantsByPortalId: Map<string, GrantRecord>;
  config: LocalConfig | null;
  onRemove: (grant: Pick<GrantRecord, "portal_id">) => Promise<void>;
  onViewGrant: (portalId: string) => Promise<void>;
  onCreateDraft: (grant: GrantRecord) => Promise<void>;
  canWriteOrg: boolean;
  writeDisabledReason: string;
}) {
  return (
    <div className="surface-stack watchlist-shell">
      <div className="surface-copy watchlist-copy">
        <h3>Watchlist</h3>
        <p>Saved grants for the current organization. Each row stays paired with the cached grant catalog, with live metadata only when available.</p>
      </div>

      <div className="info-row">
        <span>Catalog source: RTDB</span>
        <span>{config?.last_sync_at ? `Synced ${formatTimestamp(config.last_sync_at)}` : "No live sync recorded"}</span>
      </div>

      <div className="watchlist-table-shell">
        <table className="grant-table watchlist-table">
          <thead>
            <tr>
              <th>Grant</th>
              <th>Deadline</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Source</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {watchlist.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <p className="muted grant-table-empty">Nothing has been saved yet.</p>
                </td>
              </tr>
            ) : (
              watchlist.map((entry) => {
                const grant = grantsByPortalId.get(entry.portal_id);
                const title = grant?.title ?? `Grant ${entry.portal_id}`;
                const agency = grant?.agency_dept ?? "No live agency metadata";
                const source = grant ? grantSourceLabel(grant) : "No source metadata";
                const status = grant ? grantStatusLabel(grant) : "unknown";
                const deadline = grant ? grantDeadlineLabel(grant) : "not set";
                const funding = grant ? grantFundingLabel(grant) : "not set";
                const urgency = deadlineTone(grant);

                return (
                  <tr key={entry.portal_id} className="grant-row watchlist-row">
                    <td className="grant-cell grant-cell-title">
                      <button type="button" className="grant-title-button" onClick={() => void onViewGrant(entry.portal_id)}>
                        {title}
                      </button>
                      <div className="grant-cell-meta">
                        <span>{agency}</span>
                        <span>Portal ID: {entry.portal_id}</span>
                      </div>
                      <span className="watchlist-note">{entry.note ?? "Saved from the live grant catalog"}</span>
                    </td>
                    <td className="grant-cell">
                      <strong className={`deadline ${urgency}`}>{deadline}</strong>
                      <span>{grant?.deadline_is_ongoing ? "Open-ended" : grant?.application_deadline ?? "No deadline set"}</span>
                    </td>
                    <td className="grant-cell">
                      <strong>{funding}</strong>
                      <span>{grant ? grant.est_awards ?? "Award count not set" : "No live amount metadata"}</span>
                    </td>
                    <td className="grant-cell">
                      <span className="status-pill">{status}</span>
                      <span>{grant ? (grant.deadline_is_ongoing ? "Ongoing" : grant.status ?? "Live metadata") : "No live metadata"}</span>
                    </td>
                    <td className="grant-cell">
                      <strong>{source}</strong>
                      <span>{grant?.source_jurisdiction ?? grant?.geography ?? "No jurisdiction metadata"}</span>
                    </td>
                    <td className="grant-cell grant-cell-actions watchlist-actions">
                      <button type="button" className="secondary" onClick={() => void onViewGrant(entry.portal_id)}>
                        View
                      </button>
                      <button
                        type="button"
                        className="primary"
                        onClick={() => grant && void onCreateDraft(grant)}
                        disabled={!grant || !canWriteOrg}
                        title={!canWriteOrg ? writeDisabledReason : grant ? undefined : "Grant metadata not loaded yet"}
                      >
                        Draft
                      </button>
                      <button type="button" className="secondary" onClick={() => void onRemove({ portal_id: entry.portal_id })}>
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="surface-copy watchlist-footnote">
        <p className="muted">Rows without live grant metadata still reflect the saved entry and can be removed from the watchlist.</p>
      </div>
    </div>
  );
}
