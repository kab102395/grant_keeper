import type { WatchlistEntry, GrantRecord, LocalConfig } from "../lib/types";
import {
  grantDeadlineLabel,
  grantFundingLabel,
  grantSourceLabel,
  formatTimestamp,
} from "../lib/shell";
import { EmptyValue, GrantStatusPill, MetaItem, StatusPill } from "../components/ui";
import { BuildingIcon, CalendarIcon, CashIcon, MapPinIcon } from "../components/icons";

export function WatchlistPage({
  watchlist,
  grantsByPortalId,
  onRemove,
  onViewGrant,
  onCreateDraft,
  aiSettingsRequired,
  onOpenAiSettings,
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
  aiSettingsRequired: boolean;
  onOpenAiSettings: () => void;
  canWriteOrg: boolean;
  writeDisabledReason: string;
}) {
  return (
    <div className="surface-stack watchlist-shell">
      <div className="surface-copy watchlist-copy">
        <h3>Watchlist</h3>
        <p>Saved grants for the current organization. Each card stays paired with the cached grant catalog, with live metadata only when available.</p>
      </div>

      <div className="info-row">
        <span>Catalog source: RTDB</span>
        <span>{config?.last_sync_at ? `Synced ${formatTimestamp(config.last_sync_at)}` : "No live sync recorded"}</span>
        {aiSettingsRequired ? <span>AI mode is selected but not configured. Open org settings to enable it.</span> : null}
      </div>

      <section className="grant-card-grid">
        {watchlist.length === 0 ? (
          <p className="muted grant-card-empty">Nothing has been saved yet.</p>
        ) : (
          watchlist.map((entry) => {
            const grant = grantsByPortalId.get(entry.portal_id);
            const title = grant?.title ?? `Grant ${entry.portal_id}`;
            const agency = grant?.agency_dept ?? (grant ? grantSourceLabel(grant) : null);
            const funding = grant ? grantFundingLabel(grant) : "";
            const geography = grant?.source_jurisdiction ?? grant?.geography ?? "";

            return (
              <article key={entry.portal_id} className="grant-card">
                <div className="grant-card-head">
                  <div className="grant-card-titles">
                    <button type="button" className="grant-card-title" onClick={() => void onViewGrant(entry.portal_id)}>
                      {title}
                    </button>
                    <p className="grant-card-agency">
                      <BuildingIcon />
                      {agency ?? <EmptyValue label="No live agency metadata" />}
                    </p>
                  </div>
                  {grant ? <GrantStatusPill grant={grant} /> : <StatusPill tone="neutral">Saved</StatusPill>}
                </div>

                <div className="grant-card-meta">
                  <MetaItem icon={<CalendarIcon />} muted={!grant}>
                    {grant
                      ? grant.deadline_is_ongoing
                        ? "Ongoing deadline"
                        : grantDeadlineLabel(grant)
                      : <EmptyValue label="Deadline not loaded" />}
                  </MetaItem>
                  <MetaItem icon={<CashIcon />} muted={!funding}>
                    {funding || <EmptyValue label="Funding not stated" />}
                  </MetaItem>
                  <MetaItem icon={<MapPinIcon />} muted={!geography}>
                    {geography || <EmptyValue label="Geography not set" />}
                  </MetaItem>
                </div>

                {entry.note ? <p className="watchlist-note muted">{entry.note}</p> : null}

                <div className="grant-card-actions">
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
                    {aiSettingsRequired ? "Scaffold" : "Draft"}
                  </button>
                  {aiSettingsRequired ? (
                    <button type="button" className="ghost" onClick={onOpenAiSettings}>
                      AI settings
                    </button>
                  ) : null}
                  <button type="button" className="secondary" onClick={() => void onRemove({ portal_id: entry.portal_id })}>
                    Remove
                  </button>
                </div>
              </article>
            );
          })
        )}
      </section>

      <div className="surface-copy watchlist-footnote">
        <p className="muted">Cards without live grant metadata still reflect the saved entry and can be removed from the watchlist.</p>
      </div>
    </div>
  );
}
