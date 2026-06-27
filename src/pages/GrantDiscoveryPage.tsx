import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { GrantRecord } from "../lib/types";
import type { LocalConfig } from "../lib/types";
import {
  DEFAULT_DISCOVERY_FILTERS,
  grantDeadlineLabel,
  grantFundingLabel,
  grantJurisdictionLabel,
  grantMatchesFilters,
  grantSourceLabel,
  grantStatusLabel,
  sortGrantDiscoveryResults,
  formatTimestamp,
  type DiscoveryBinaryFilter,
  type DiscoveryDeadlineFilter,
  type DiscoveryFamilyFilter,
  type DiscoveryFilters,
  type DiscoveryJurisdictionFilter,
  type DiscoverySourceFilter,
  type DiscoverySortFilter,
  type DiscoveryStatusFilter,
} from "../lib/shell";

function summarizeCategories(categories: string[]) {
  if (categories.length === 0) return "None";
  if (categories.length === 1) return categories[0];
  if (categories.length === 2) return categories.join(", ");
  return `${categories.slice(0, 2).join(", ")} +${categories.length - 2}`;
}

export function GrantDiscoveryPage({
  grants,
  watchlistedPortalIds,
  discoveryFilters,
  setDiscoveryFilters,
  selectedGrant,
  config,
  onSelectGrant,
  onToggleWatchlist,
  onCreateDraft,
  aiSettingsRequired,
  onOpenAiSettings,
  canWriteOrg,
  writeDisabledReason,
}: {
  grants: GrantRecord[];
  watchlistedPortalIds: Set<string>;
  discoveryFilters: DiscoveryFilters;
  setDiscoveryFilters: Dispatch<SetStateAction<DiscoveryFilters>>;
  selectedGrant: GrantRecord | null;
  config: LocalConfig | null;
  onSelectGrant: (grant: GrantRecord) => Promise<void>;
  onToggleWatchlist: (grant: GrantRecord) => Promise<void>;
  onCreateDraft: (grant: GrantRecord) => Promise<void>;
  aiSettingsRequired: boolean;
  onOpenAiSettings: () => void;
  canWriteOrg: boolean;
  writeDisabledReason: string;
}) {
  const [searchInput, setSearchInput] = useState(discoveryFilters.query);
  const deferredFilters = useDeferredValue(discoveryFilters);

  useEffect(() => {
    setSearchInput(discoveryFilters.query);
  }, [discoveryFilters.query]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDiscoveryFilters((current) =>
        current.query === searchInput ? current : { ...current, query: searchInput },
      );
    }, 220);
    return () => window.clearTimeout(timeout);
  }, [searchInput, setDiscoveryFilters]);

  const filtered = useMemo(
    () =>
      sortGrantDiscoveryResults(
        grants.filter(
          (grant) =>
            grantMatchesFilters(grant, deferredFilters) &&
            (!deferredFilters.onlyWatchlisted || watchlistedPortalIds.has(grant.portal_id)),
        ),
        deferredFilters.sortBy,
      ),
    [deferredFilters, grants, watchlistedPortalIds],
  );

  const categoryOptions = useMemo(
    () =>
        Array.from(
        new Set(grants.flatMap((grant) => grant.categories).filter((value): value is string => Boolean(value))),
      ).sort(),
    [grants],
  );

  const openCount = filtered.filter((grant) => grantStatusLabel(grant) === "open").length;
  const closedCount = filtered.length - openCount;

  const resetFilters = () => {
    setSearchInput("");
    setDiscoveryFilters({
      ...DEFAULT_DISCOVERY_FILTERS,
      categories: [],
    });
  };

  return (
    <div className="surface-stack discovery-shell">
      <div className="surface-copy discovery-copy">
        <h3>Grant discovery</h3>
        <p>
          Search the cached grant catalog stored in RTDB, scan the table at speed, and jump into the source record, watchlist,
          or draft flow without losing context.
        </p>
      </div>

      <div className="info-row">
        <span>Catalog source: RTDB</span>
        <span>{config?.last_sync_at ? `Synced ${formatTimestamp(config.last_sync_at)}` : "No live sync recorded"}</span>
        {aiSettingsRequired ? <span>AI mode is selected but not configured. Configure it from org settings.</span> : null}
      </div>

      <section className="panel-block discovery-toolbar">
        <div className="discovery-toolbar-grid">
          <label className="search-box discovery-search">
            Search grants
            <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="title, purpose, agency..." />
          </label>

          <label>
            Status
            <select
              value={discoveryFilters.status}
              onChange={(event) =>
                setDiscoveryFilters((current) => ({ ...current, status: event.target.value as DiscoveryStatusFilter }))
              }
            >
              <option value="all">All grants</option>
              <option value="open">Open now</option>
              <option value="historical">Historical</option>
            </select>
          </label>

          <label>
            Jurisdiction
            <select
              value={discoveryFilters.jurisdiction}
              onChange={(event) =>
                setDiscoveryFilters((current) => ({
                  ...current,
                  jurisdiction: event.target.value as DiscoveryJurisdictionFilter,
                }))
              }
            >
              <option value="all">All jurisdictions</option>
              <option value="california">California grants only</option>
              <option value="other">Other jurisdictions</option>
            </select>
          </label>

          <label>
            Sort by
            <select
              value={discoveryFilters.sortBy}
              onChange={(event) =>
                setDiscoveryFilters((current) => ({
                  ...current,
                  sortBy: event.target.value as DiscoverySortFilter,
                }))
              }
            >
              <option value="recommended">Recommended</option>
              <option value="jurisdiction">Jurisdiction</option>
              <option value="newest">Newest first</option>
              <option value="funding">Highest funding</option>
            </select>
          </label>
        </div>

        <div className="discovery-toolbar-grid discovery-toolbar-grid-secondary">
          <label>
            Source type
            <select
              value={discoveryFilters.sourceKind}
              onChange={(event) =>
                setDiscoveryFilters((current) => ({
                  ...current,
                  sourceKind: event.target.value as DiscoverySourceFilter,
                }))
              }
            >
              <option value="all">All sources</option>
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
              <option value="webpage">Webpage</option>
            </select>
          </label>

          <label>
            Source family
            <select
              value={discoveryFilters.sourceFamily}
              onChange={(event) =>
                setDiscoveryFilters((current) => ({
                  ...current,
                  sourceFamily: event.target.value as DiscoveryFamilyFilter,
                }))
              }
            >
              <option value="all">All families</option>
              <option value="ca-grants-portal">California Grants Portal</option>
              <option value="cde-grants">CDE</option>
              <option value="caloes-grants">Cal OES</option>
              <option value="calepa-grants">CalEPA</option>
              <option value="scc-grants">Coastal Conservancy</option>
              <option value="calfire-grants">CAL FIRE</option>
              <option value="hcd-grants">HCD</option>
              <option value="csd-grants">Community Services</option>
              <option value="sgc-grants">Strategic Growth Council</option>
              <option value="cnra-grants">CNRA</option>
              <option value="cdfa-grants">CDFA</option>
              <option value="cdfw-grants">CDFW</option>
              <option value="carb-grants">CARB</option>
              <option value="arts-council-grants">Arts Council</option>
              <option value="calosba-grants">CalOSBA</option>
            </select>
          </label>

          <label>
            Deadline window
            <select
              value={discoveryFilters.deadlineWindow}
              onChange={(event) =>
                setDiscoveryFilters((current) => ({
                  ...current,
                  deadlineWindow: event.target.value as DiscoveryDeadlineFilter,
                }))
              }
            >
              <option value="any">Any</option>
              <option value="30">Next 30 days</option>
              <option value="60">Next 60 days</option>
              <option value="90">Next 90 days</option>
            </select>
          </label>

          <label className="toggle-row discovery-toggle">
            <input
              type="checkbox"
              checked={discoveryFilters.onlyWatchlisted}
              onChange={(event) => setDiscoveryFilters((current) => ({ ...current, onlyWatchlisted: event.target.checked }))}
            />
            Watchlist only
          </label>
        </div>

        <details className="panel-block advanced-panel discovery-advanced">
          <summary>More filters</summary>
          <div className="discovery-advanced-grid">
            <label>
              Min amount
              <input
                inputMode="numeric"
                value={discoveryFilters.minAmount}
                onChange={(event) => setDiscoveryFilters((current) => ({ ...current, minAmount: event.target.value }))}
                placeholder="$0"
              />
            </label>

            <label>
              Max amount
              <input
                inputMode="numeric"
                value={discoveryFilters.maxAmount}
                onChange={(event) => setDiscoveryFilters((current) => ({ ...current, maxAmount: event.target.value }))}
                placeholder="$100000"
              />
            </label>

            <label>
              LOI required
              <select
                value={discoveryFilters.loiRequired}
                onChange={(event) =>
                  setDiscoveryFilters((current) => ({ ...current, loiRequired: event.target.value as DiscoveryBinaryFilter }))
                }
              >
                <option value="any">Any</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>

            <label>
              Matching funds
              <select
                value={discoveryFilters.matchingFunds}
                onChange={(event) =>
                  setDiscoveryFilters((current) => ({
                    ...current,
                    matchingFunds: event.target.value as DiscoveryBinaryFilter,
                  }))
                }
              >
                <option value="any">Any</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
          </div>

          <div className="discovery-advanced-footer">
            <div className="chip-row discovery-chip-row">
              {categoryOptions.length === 0 ? (
                <span className="muted">No categories available</span>
              ) : (
                categoryOptions.map((category) => {
                  const active = discoveryFilters.categories.includes(category);
                  return (
                    <button
                      key={category}
                      type="button"
                      className={active ? "chip active" : "chip"}
                      onClick={() =>
                        setDiscoveryFilters((current) => ({
                          ...current,
                          categories: active
                            ? current.categories.filter((entry) => entry !== category)
                            : [...current.categories, category],
                        }))
                      }
                    >
                      {category}
                    </button>
                  );
                })
              )}
            </div>

            <button type="button" className="secondary discovery-reset" onClick={resetFilters}>
              Reset filters
            </button>
          </div>
        </details>
      </section>

      <div className="surface-copy surface-metrics discovery-metrics">
        <p className="muted">
          Showing {filtered.length} grants total, {openCount} open and {closedCount} closed.
        </p>
      </div>

      <section className="grant-table-shell">
        <div className="grant-table-wrap">
          <table className="grant-table">
            <thead>
              <tr>
                <th>Grant</th>
                <th>Agency</th>
                <th>Deadline</th>
                <th>Funding</th>
                <th>Status</th>
                <th>Categories</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <p className="muted grant-table-empty">No grants match the current search.</p>
                  </td>
                </tr>
              ) : (
                filtered.map((grant) => {
                  const isSelected = selectedGrant?.portal_id === grant.portal_id;
                  const isWatchlisted = watchlistedPortalIds.has(grant.portal_id);
                  return (
                    <tr key={grant.portal_id} className={isSelected ? "grant-row selected" : "grant-row"}>
                      <td className="grant-cell grant-cell-title">
                        <button type="button" className="grant-title-button" onClick={() => void onSelectGrant(grant)}>
                          {grant.title}
                        </button>
                        <div className="grant-cell-meta">
                          <span>{grant.portal_id}</span>
                          <span>{grantSourceLabel(grant)}</span>
                        </div>
                      </td>
                      <td className="grant-cell">
                        <strong>{grant.agency_dept ?? "Unknown agency"}</strong>
                        <span>{grantJurisdictionLabel(grant)}</span>
                      </td>
                      <td className="grant-cell">
                        <strong>{grantDeadlineLabel(grant)}</strong>
                        <span>{grant.deadline_is_ongoing ? "Open-ended" : grant.application_deadline ?? "No deadline set"}</span>
                      </td>
                      <td className="grant-cell">
                        <strong>{grantFundingLabel(grant)}</strong>
                        <span>{grant.est_awards ?? "Award count not set"}</span>
                      </td>
                      <td className="grant-cell">
                        <span className="status-pill">{grantStatusLabel(grant)}</span>
                        <span>{grant.loi_required ? "LOI required" : "No LOI flag"}</span>
                      </td>
                      <td className="grant-cell">
                        <strong>{summarizeCategories(grant.categories)}</strong>
                        <span>{grant.categories.length === 0 ? "No categories tagged" : `${grant.categories.length} tagged categories`}</span>
                      </td>
                      <td className="grant-cell grant-cell-actions">
                        <button type="button" className="secondary" onClick={() => void onSelectGrant(grant)}>
                          Open
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => void onToggleWatchlist(grant)}
                          disabled={!canWriteOrg}
                          title={!canWriteOrg ? writeDisabledReason : undefined}
                        >
                          {isWatchlisted ? "Saved" : "Save"}
                        </button>
                        <button
                          type="button"
                          className="primary"
                          onClick={() => void onCreateDraft(grant)}
                          disabled={!canWriteOrg}
                          title={!canWriteOrg ? writeDisabledReason : undefined}
                        >
                          {aiSettingsRequired ? "Scaffold" : "Draft"}
                        </button>
                        {aiSettingsRequired ? (
                          <button type="button" className="ghost" onClick={onOpenAiSettings}>
                            AI settings
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
