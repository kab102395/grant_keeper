import { useEffect, useState } from "react";
import type { AppSnapshot, GrantSourceHealthRecord, GrantSourceSyncOutcome, LocalConfig, SetupValidation } from "../lib/types";
import { formatTimestamp } from "../lib/shell";

function titleCase(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function sourceHealthLabel(value: GrantSourceHealthRecord["health_status"]) {
  switch (value) {
    case "bad_source":
      return "Bad source";
    case "blocked":
      return "Blocked";
    case "low_yield":
      return "Low yield";
    case "pending_adapter":
      return "Pending adapter";
    case "failing":
      return "Sync error";
    case "stale":
      return "Stale";
    case "healthy":
      return "Healthy";
    default:
      return "Unknown";
  }
}

export function DevToolsPage({
  snapshot,
  config,
  setupValidation,
  sourceHealth,
  syncOutcomes,
  lastCheckedAt,
  onRefreshHealth,
  onSyncAll,
  onSyncSource,
  onUpdateRefreshInterval,
}: {
  snapshot: AppSnapshot | null;
  config: LocalConfig | null;
  setupValidation: SetupValidation | null;
  sourceHealth: GrantSourceHealthRecord[];
  syncOutcomes: GrantSourceSyncOutcome[] | null;
  lastCheckedAt: string | null;
  onRefreshHealth: () => Promise<void>;
  onSyncAll: () => Promise<void>;
  onSyncSource: (sourceId: string) => Promise<void>;
  onUpdateRefreshInterval: (intervalMs: number) => Promise<void>;
}) {
  const [refreshMinutesDraft, setRefreshMinutesDraft] = useState("2");

  useEffect(() => {
    const intervalMs = config?.background_refresh_interval_ms ?? 120_000;
    setRefreshMinutesDraft(String(Math.max(1, Math.round(intervalMs / 60_000))));
  }, [config?.background_refresh_interval_ms]);

  const healthyCount = sourceHealth.filter((source) => source.health_status === "healthy").length;
  const badCount = sourceHealth.filter((source) => source.health_status === "bad_source").length;
  const staleCount = sourceHealth.filter((source) => source.health_status === "stale").length;
  const lowYieldCount = sourceHealth.filter((source) => source.health_status === "low_yield").length;
  const failingCount = sourceHealth.filter((source) => source.health_status === "failing").length;
  const blockedCount = sourceHealth.filter((source) => source.health_status === "blocked" || source.health_status === "pending_adapter").length;
  const lastSyncAt = config?.last_sync_at ?? null;
  const refreshIntervalMs = config?.background_refresh_interval_ms ?? 120_000;

  async function saveRefreshInterval() {
    const parsedMinutes = Number(refreshMinutesDraft);
    if (!Number.isFinite(parsedMinutes) || parsedMinutes <= 0) {
      setRefreshMinutesDraft(String(Math.max(1, Math.round(refreshIntervalMs / 60_000))));
      return;
    }
    try {
      await onUpdateRefreshInterval(Math.round(parsedMinutes * 60_000));
    } catch {
      setRefreshMinutesDraft(String(Math.max(1, Math.round(refreshIntervalMs / 60_000))));
    }
  }

  return (
    <div className="surface-stack dev-tools-stack">
      <div className="surface-copy">
        <h3>Dev Tools</h3>
        <p>Operator checks for source health, sync results, and backend readiness. This is the fastest way to see whether the database is healthy.</p>
      </div>

      <div className="stat-grid dev-stat-grid">
        <article className="stat-card">
          <span>Session</span>
          <strong>{titleCase(snapshot?.session.mode ?? "none")}</strong>
          <p>{snapshot?.session.email ?? "No active identity"}</p>
        </article>
        <article className="stat-card">
          <span>RTDB</span>
          <strong>{config?.firebase_rtdb_url ? "Configured" : "Missing"}</strong>
          <p>{config?.firebase_rtdb_url ?? "No RTDB URL set"}</p>
        </article>
        <article className="stat-card">
          <span>Setup</span>
          <strong>{setupValidation?.ready ? "Ready" : "Blocked"}</strong>
          <p>{setupValidation?.missing_fields?.length ? setupValidation.missing_fields.join(", ") : "No missing fields"}</p>
        </article>
        <article className="stat-card">
          <span>Last checked</span>
          <strong>{lastCheckedAt ? formatTimestamp(lastCheckedAt) : "not set"}</strong>
          <p>Database snapshot timestamp</p>
        </article>
        <article className="stat-card">
          <span>Refresh interval</span>
          <strong>{Math.max(1, Math.round(refreshIntervalMs / 60_000))} min</strong>
          <p>Background snapshot refresh cadence</p>
        </article>
        <article className="stat-card">
          <span>Live sync</span>
          <strong>{lastSyncAt ? formatTimestamp(lastSyncAt) : "not set"}</strong>
          <p>Last explicit source sync</p>
        </article>
        <article className="stat-card">
          <span>Healthy sources</span>
          <strong>{healthyCount}</strong>
          <p>{sourceHealth.length ? `${sourceHealth.length} total sources` : "No sources loaded"}</p>
        </article>
        <article className="stat-card">
          <span>Blocked</span>
          <strong>{blockedCount}</strong>
          <p>Access denied or adapter required</p>
        </article>
        <article className="stat-card">
          <span>Bad source</span>
          <strong>{badCount}</strong>
          <p>Invalid or incomplete metadata</p>
        </article>
      </div>

      <section className="panel-block">
        <div className="detail-header">
          <div>
            <p className="eyebrow">Backend checks</p>
            <h4>Source health and syncs</h4>
            <p className="muted">Use this page to verify database freshness, source reachability, and explicit live sync results.</p>
          </div>
          <div className="surface-actions">
            <button type="button" className="secondary" onClick={() => void onRefreshHealth()}>
              Refresh health
            </button>
            <button type="button" className="primary" onClick={() => void onSyncAll()}>
              Sync enabled sources
            </button>
          </div>
        </div>

        <div className="panel-inline-form">
          <label className="field">
            <span>Background refresh interval (minutes)</span>
            <input
              type="number"
              min={1}
              step={1}
              value={refreshMinutesDraft}
              onChange={(event) => setRefreshMinutesDraft(event.target.value)}
            />
          </label>
          <button type="button" className="secondary" onClick={() => void saveRefreshInterval()}>
            Save interval
          </button>
        </div>

        {syncOutcomes?.length ? (
          <div className="sync-results">
            {syncOutcomes.map((outcome) => (
              <article className={outcome.success ? "sync-result success" : "sync-result failure"} key={outcome.source_id}>
                <strong>{outcome.source_name}</strong>
                <p>{outcome.success ? "Sync completed" : outcome.error ?? "Sync failed"}</p>
                <small>{outcome.report ? `${outcome.report.total_rows} rows` : "No report"}</small>
              </article>
            ))}
          </div>
        ) : null}
        {sourceHealth.length ? (
          <div className="info-row">
            <span>Database snapshot: {lastCheckedAt ? formatTimestamp(lastCheckedAt) : "not set"}</span>
            <span>Live sync: {lastSyncAt ? formatTimestamp(lastSyncAt) : "not set"}</span>
            <span>{healthyCount} healthy</span>
            <span>{badCount} bad source</span>
            <span>{staleCount} stale</span>
            <span>{lowYieldCount} low yield</span>
            <span>{failingCount} failing</span>
            <span>{blockedCount} blocked</span>
          </div>
        ) : null}
      </section>

      <section className="panel-block">
        <div className="detail-header">
          <div>
            <p className="eyebrow">Source catalog</p>
            <h4>Grant source health</h4>
          </div>
          <span className="status-pill">{sourceHealth.length} sources</span>
        </div>

        <div className="health-grid">
          {sourceHealth.map((source) => (
            <article className="health-card" key={source.source_id}>
              <div className="list-card-top">
                <strong>{source.name}</strong>
                <span>{sourceHealthLabel(source.health_status)}</span>
              </div>
              <p>{source.url}</p>
              {source.source_family ? <small>Family: {source.source_family}</small> : null}
              {source.canonical_source_id ? <small>Canonical: {source.canonical_source_id}</small> : null}
              <small>Kind: {titleCase(source.kind)}</small>
              <small>Enabled: {source.enabled ? "yes" : "no"}</small>
              <small>Grants linked: {source.grant_count}</small>
              <small>Last run: {formatTimestamp(source.last_run_at)}</small>
              <small>Status: {source.last_status ?? "not set"}</small>
              {source.health_note ? <small>{source.health_note}</small> : null}
              {source.last_error ? <small className="error-text">{source.last_error}</small> : null}
              <small>Health: {sourceHealthLabel(source.health_status)}</small>
              <div className="card-actions">
                <button type="button" className="secondary" onClick={() => void onSyncSource(source.source_id)}>
                  Sync source
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
