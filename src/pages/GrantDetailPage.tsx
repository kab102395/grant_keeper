import type { GrantRecord, LocalConfig } from "../lib/types";
import { GrantDetailView } from "../components/GrantDetailView";
import { formatTimestamp } from "../lib/shell";

export function GrantDetailPage({
  grant,
  config,
  watchlistedPortalIds,
  onBack,
  onToggleWatchlist,
  onCreateDraft,
  canWriteOrg,
  writeDisabledReason,
}: {
  grant: GrantRecord | null;
  config: LocalConfig | null;
  watchlistedPortalIds: Set<string>;
  onBack: () => void;
  onToggleWatchlist: (grant: GrantRecord) => Promise<void>;
  onCreateDraft: (grant: GrantRecord) => Promise<void>;
  canWriteOrg: boolean;
  writeDisabledReason: string;
}) {
  return (
    <div className="surface-stack grant-detail-page">
      <div className="surface-copy">
        <h3>Grant details</h3>
        <p>Open the full grant record, inspect the source evidence, and continue into watchlist or draft actions without losing context.</p>
      </div>

      <div className="info-row">
        <span>Catalog source: RTDB</span>
        <span>{config?.last_sync_at ? `Synced ${formatTimestamp(config.last_sync_at)}` : "No live sync recorded"}</span>
      </div>

      <div className="surface-actions">
        <button type="button" className="secondary" onClick={onBack}>
          Back to grants
        </button>
      </div>

      <GrantDetailView
        grant={grant}
        watchlistedPortalIds={watchlistedPortalIds}
        onToggleWatchlist={onToggleWatchlist}
        onCreateDraft={onCreateDraft}
        canWrite={canWriteOrg}
        writeDisabledReason={writeDisabledReason}
        layout="page"
      />
    </div>
  );
}
