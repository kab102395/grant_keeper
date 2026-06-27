/**
 * Performance tests for frontend pure functions.
 * Verifies that hot-path operations complete within defined latency budgets
 * when processing realistic production-scale data volumes.
 */

import { describe, expect, it } from "vitest";
import {
  grantMatchesFilters,
  normalizeGrantRecords,
  normalizeWatchlistEntries,
  normalizeDraftRecords,
  sortGrantDiscoveryResults,
  DEFAULT_DISCOVERY_FILTERS,
} from "../lib/shell";
import type { GrantRecord } from "../lib/types";

const filters = DEFAULT_DISCOVERY_FILTERS;

function makeGrant(i: number): GrantRecord {
  const isOpen = i % 3 !== 0;
  const isCa = i % 2 === 0;
  return {
    portal_id: String(i),
    title: `Grant Program ${i} - ${isOpen ? "Active" : "Closed"} Funding`,
    agency_dept: isCa ? "CA Department of Education" : "Oregon DHS",
    status: isOpen ? "active" : "closed",
    deadline: null,
    loi_required: i % 5 === 0,
    categories: i % 4 === 0 ? ["Education", "Youth"] : ["Environment"],
    source_highlights: [],
    applicant_types: ["Nonprofit"],
    deadline_is_ongoing: i % 7 === 0,
    application_deadline: isOpen && i % 7 !== 0
      ? new Date(Date.now() + (i % 90) * 24 * 60 * 60 * 1000).toISOString()
      : null,
    matching_funds: i % 3 === 0 ? "Required" : "Not Required",
    est_avail_funds_numeric: i * 10_000,
    source_kind: "csv",
    source_jurisdiction: isCa ? "California" : "Oregon",
    source_family: isCa ? "ca-grants-portal" : null,
    updated_at: new Date(Date.now() - i * 1000).toISOString(),
  };
}

const GRANTS_1K = Array.from({ length: 1_000 }, (_, i) => makeGrant(i));
const GRANTS_10K = Array.from({ length: 10_000 }, (_, i) => makeGrant(i));

// ── filter performance ─────────────────────────────────────────────────────

describe("grantMatchesFilters performance", () => {
  it("filters 1,000 grants through default filters in under 50ms", () => {
    const start = performance.now();
    const result = GRANTS_1K.filter((g) => grantMatchesFilters(g, filters));
    const elapsed = performance.now() - start;
    expect(result.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(50);
  });

  it("filters 10,000 grants through default filters in under 200ms", () => {
    const start = performance.now();
    const result = GRANTS_10K.filter((g) => grantMatchesFilters(g, filters));
    const elapsed = performance.now() - start;
    expect(result.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(200);
  });

  it("filters 10,000 grants with all filters active in under 500ms", () => {
    const complexFilters = {
      ...filters,
      query: "education",
      status: "open" as const,
      jurisdiction: "california" as const,
      categories: ["Education"],
      loiRequired: "any" as const,
      matchingFunds: "any" as const,
      minAmount: "50000",
      maxAmount: "10000000",
      deadlineWindow: "90" as const,
    };
    const start = performance.now();
    const result = GRANTS_10K.filter((g) => grantMatchesFilters(g, complexFilters));
    const elapsed = performance.now() - start;
    expect(result.length).toBeGreaterThanOrEqual(0);
    expect(elapsed).toBeLessThan(500);
  });

  it("repeated filter calls on same grant set are stable in performance", () => {
    // Warm up
    GRANTS_1K.filter((g) => grantMatchesFilters(g, filters));

    const timings: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      GRANTS_1K.filter((g) => grantMatchesFilters(g, filters));
      timings.push(performance.now() - start);
    }
    const max = Math.max(...timings);
    expect(max).toBeLessThan(100);
  });
});

// ── sort performance ───────────────────────────────────────────────────────

describe("sortGrantDiscoveryResults performance", () => {
  it("sorts 1,000 grants in recommended mode in under 50ms", () => {
    const start = performance.now();
    const result = sortGrantDiscoveryResults(GRANTS_1K, "recommended");
    const elapsed = performance.now() - start;
    expect(result).toHaveLength(1_000);
    expect(elapsed).toBeLessThan(50);
  });

  it("sorts 10,000 grants in recommended mode in under 500ms", () => {
    const start = performance.now();
    const result = sortGrantDiscoveryResults(GRANTS_10K, "recommended");
    const elapsed = performance.now() - start;
    expect(result).toHaveLength(10_000);
    expect(elapsed).toBeLessThan(500);
  });

  it("sorts 10,000 grants in funding mode in under 500ms", () => {
    const start = performance.now();
    const result = sortGrantDiscoveryResults(GRANTS_10K, "funding");
    const elapsed = performance.now() - start;
    expect(result).toHaveLength(10_000);
    expect(elapsed).toBeLessThan(500);
  });

  it("sorts 10,000 grants in newest mode in under 500ms", () => {
    const start = performance.now();
    const result = sortGrantDiscoveryResults(GRANTS_10K, "newest");
    const elapsed = performance.now() - start;
    expect(result).toHaveLength(10_000);
    expect(elapsed).toBeLessThan(500);
  });

  it("does not mutate original array during sort", () => {
    const grants = GRANTS_1K.slice(0, 100);
    const firstId = grants[0].portal_id;
    sortGrantDiscoveryResults(grants, "funding");
    expect(grants[0].portal_id).toBe(firstId);
  });
});

// ── normalization performance ──────────────────────────────────────────────

describe("normalizeGrantRecords performance", () => {
  it("normalizes 1,000 raw grant objects in under 50ms", () => {
    const raw = GRANTS_1K.map((g) => ({ ...g }));
    const start = performance.now();
    const result = normalizeGrantRecords(raw);
    const elapsed = performance.now() - start;
    expect(result).toHaveLength(1_000);
    expect(elapsed).toBeLessThan(50);
  });

  it("normalizes 10,000 raw grant objects in under 500ms", () => {
    const raw = GRANTS_10K.map((g) => ({ ...g }));
    const start = performance.now();
    const result = normalizeGrantRecords(raw);
    const elapsed = performance.now() - start;
    expect(result).toHaveLength(10_000);
    expect(elapsed).toBeLessThan(500);
  });

  it("normalizes a map of 5,000 grants in under 300ms", () => {
    const raw = Object.fromEntries(GRANTS_1K.slice(0, 5_000 % 1000).concat(
      Array.from({ length: 4_000 }, (_, i) => makeGrant(i + 1000)),
    ).map((g) => [g.portal_id, { ...g }]));
    const start = performance.now();
    const result = normalizeGrantRecords(raw);
    const elapsed = performance.now() - start;
    expect(result.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(300);
  });
});

describe("normalizeWatchlistEntries performance", () => {
  it("normalizes 1,000 watchlist entries in under 50ms", () => {
    const raw = Array.from({ length: 1_000 }, (_, i) => ({
      portal_id: String(i),
      saved: true,
      note: `Note for grant ${i}`,
      updated_at: new Date().toISOString(),
    }));
    const start = performance.now();
    const result = normalizeWatchlistEntries(raw);
    const elapsed = performance.now() - start;
    expect(result).toHaveLength(1_000);
    expect(elapsed).toBeLessThan(50);
  });
});

describe("normalizeDraftRecords performance", () => {
  it("normalizes 500 draft records in under 100ms", () => {
    const raw = Array.from({ length: 500 }, (_, i) => ({
      draft_id: `d-${i}`,
      grant_portal_id: `g-${i}`,
      status: "draft",
      version: 1,
      generation_mode: "local_scaffold",
      section_org_overview: "Overview text that is reasonably long to simulate real data...",
      section_need_statement: "Need statement content...",
      section_project_description: "Project description content...",
    }));
    const start = performance.now();
    const result = normalizeDraftRecords(raw);
    const elapsed = performance.now() - start;
    expect(result).toHaveLength(500);
    expect(elapsed).toBeLessThan(100);
  });
});

// ── combined pipeline performance ──────────────────────────────────────────

describe("Full discovery pipeline performance (normalize → filter → sort)", () => {
  it("complete pipeline for 5,000 grants completes under 500ms", () => {
    const raw = Array.from({ length: 5_000 }, (_, i) => ({ ...makeGrant(i) }));

    const start = performance.now();
    const normalized = normalizeGrantRecords(raw);
    const filtered = normalized.filter((g) => grantMatchesFilters(g, { ...filters, status: "open" as const, jurisdiction: "california" as const }));
    const sorted = sortGrantDiscoveryResults(filtered, "recommended");
    const elapsed = performance.now() - start;

    expect(sorted.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(500);
  });
});
