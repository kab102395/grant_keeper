import { describe, expect, it } from "vitest";
import {
  composeDraftBody,
  DEFAULT_DISCOVERY_FILTERS,
  exportDraftFileName,
  formatCurrency,
  formatTimestamp,
  grantMatchesFilters,
  grantStatusLabel,
  orgCompletenessScore,
  orgMissingFields,
  normalizeGrantRecords,
  normalizeOrganization,
  normalizeWatchlistEntries,
  normalizeDraftRecords,
  parsePrograms,
  serializePrograms,
  sortGrantDiscoveryResults,
  summarizeSetup,
  toMessage,
  isObject,
} from "../lib/shell";
import type { DraftRecord, GrantRecord, WatchlistEntry } from "../lib/types";
import type { OrganizationRecord } from "../lib/types";

// ── helpers ───────────────────────────────────────────────────────────────

function makeGrant(overrides: Partial<GrantRecord> = {}): GrantRecord {
  return {
    portal_id: "1",
    title: "Test Grant",
    agency_dept: "CA Dept of Education",
    status: "active",
    deadline: null,
    loi_required: false,
    categories: ["Education"],
    source_highlights: [],
    applicant_types: ["Nonprofit"],
    deadline_is_ongoing: false,
    ...overrides,
  };
}

function makeDraft(overrides: Partial<DraftRecord> = {}): DraftRecord {
  return {
    draft_id: "draft-001",
    grant_portal_id: "grant-1",
    status: "draft",
    version: 1,
    generation_mode: "local_scaffold",
    ...overrides,
  };
}

function makeOrg(overrides: Partial<OrganizationRecord> = {}): OrganizationRecord {
  return {
    uid: "org-001",
    name: "Test Org",
    city: "Sacramento",
    state: "CA",
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// formatTimestamp
// ═══════════════════════════════════════════════════════════════════════════

describe("formatTimestamp", () => {
  it("returns 'not set' for null", () => {
    expect(formatTimestamp(null)).toBe("not set");
  });

  it("returns 'not set' for undefined", () => {
    expect(formatTimestamp(undefined)).toBe("not set");
  });

  it("returns 'not set' for empty string", () => {
    expect(formatTimestamp("")).toBe("not set");
  });

  it("formats a valid ISO date string", () => {
    const result = formatTimestamp("2026-06-15T12:00:00Z");
    expect(typeof result).toBe("string");
    expect(result).not.toBe("not set");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns raw value for unparseable string", () => {
    expect(formatTimestamp("not-a-date")).toBe("not-a-date");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// formatCurrency
// ═══════════════════════════════════════════════════════════════════════════

describe("formatCurrency", () => {
  it("returns 'not set' for null", () => {
    expect(formatCurrency(null)).toBe("not set");
  });

  it("returns 'not set' for undefined", () => {
    expect(formatCurrency(undefined)).toBe("not set");
  });

  it("formats zero", () => {
    expect(formatCurrency(0)).toMatch(/\$0/);
  });

  it("formats a large amount with commas", () => {
    const result = formatCurrency(1_000_000);
    expect(result).toContain("1,000,000");
    expect(result).toContain("$");
  });

  it("formats a typical grant amount", () => {
    const result = formatCurrency(250_000);
    expect(result).toContain("250,000");
  });

  it("does not include decimal places", () => {
    const result = formatCurrency(50_000);
    expect(result).not.toMatch(/\.\d{2}/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// grantStatusLabel
// ═══════════════════════════════════════════════════════════════════════════

describe("grantStatusLabel", () => {
  it("returns 'open' for status containing 'open'", () => {
    expect(grantStatusLabel(makeGrant({ status: "open" }))).toBe("open");
  });

  it("returns 'open' for status containing 'active'", () => {
    expect(grantStatusLabel(makeGrant({ status: "active" }))).toBe("open");
  });

  it("returns 'closed' for status containing 'closed'", () => {
    expect(grantStatusLabel(makeGrant({ status: "closed" }))).toBe("closed");
  });

  it("returns 'closed' for status containing 'expired'", () => {
    expect(grantStatusLabel(makeGrant({ status: "expired" }))).toBe("closed");
  });

  it("returns 'closed' for status containing 'inactive'", () => {
    expect(grantStatusLabel(makeGrant({ status: "inactive" }))).toBe("closed");
  });

  it("returns 'open' for ongoing grant regardless of status", () => {
    expect(grantStatusLabel(makeGrant({ status: "", deadline_is_ongoing: true }))).toBe("open");
  });

  it("returns 'open' when deadline is in the future", () => {
    const futureDeadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(
      grantStatusLabel(makeGrant({ status: "", application_deadline: futureDeadline })),
    ).toBe("open");
  });

  it("returns 'closed' when deadline is in the past", () => {
    const pastDeadline = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(
      grantStatusLabel(makeGrant({ status: "", application_deadline: pastDeadline })),
    ).toBe("closed");
  });

  it("status check is case-insensitive", () => {
    expect(grantStatusLabel(makeGrant({ status: "ACTIVE" }))).toBe("open");
    expect(grantStatusLabel(makeGrant({ status: "CLOSED" }))).toBe("closed");
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// orgCompletenessScore / orgMissingFields
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe("orgCompletenessScore", () => {
  it("returns 0 for null org", () => {
    expect(orgCompletenessScore(null)).toBe(0);
  });

  it("returns 100 when all scored fields are present", () => {
    const org = makeOrg({
      name: "Full Org",
      mission: "Support communities",
      ein: "12-3456789",
      city: "Sacramento",
      state: "CA",
      website: "https://example.org",
      contact_name: "Alex",
      contact_email: "alex@example.org",
      service_area: "California",
      target_population: "Families",
      annual_budget: 100000,
      description: "A fully described nonprofit.",
    });
    expect(orgCompletenessScore(org)).toBe(100);
    expect(orgMissingFields(org)).toEqual([]);
  });

  it("scores partial profiles below 100 and reports missing fields", () => {
    const org = makeOrg({
      mission: "Support communities",
      website: "https://example.org",
    });
    expect(orgCompletenessScore(org)).toBeLessThan(100);
    expect(orgCompletenessScore(org)).toBeGreaterThan(0);
    expect(orgMissingFields(org).length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// sortGrantDiscoveryResults
// ═══════════════════════════════════════════════════════════════════════════

describe("sortGrantDiscoveryResults", () => {
  it("does not mutate the original array", () => {
    const grants = [makeGrant({ portal_id: "a" }), makeGrant({ portal_id: "b" })];
    const original = [...grants];
    sortGrantDiscoveryResults(grants, "recommended");
    expect(grants).toEqual(original);
  });

  it("recommended mode puts open california grants first", () => {
    const caOpen = makeGrant({ portal_id: "ca-open", status: "active", source_jurisdiction: "California" });
    const otherOpen = makeGrant({ portal_id: "other-open", status: "active", source_jurisdiction: "Oregon" });
    const sorted = sortGrantDiscoveryResults([otherOpen, caOpen], "recommended");
    expect(sorted[0].portal_id).toBe("ca-open");
  });

  it("funding mode puts higher-funded grants first", () => {
    const low = makeGrant({ portal_id: "low", est_avail_funds_numeric: 10_000 });
    const high = makeGrant({ portal_id: "high", est_avail_funds_numeric: 5_000_000 });
    const sorted = sortGrantDiscoveryResults([low, high], "funding");
    expect(sorted[0].portal_id).toBe("high");
  });

  it("newest mode puts recently updated grants first", () => {
    const old = makeGrant({ portal_id: "old", updated_at: "2024-01-01T00:00:00Z" });
    const recent = makeGrant({ portal_id: "recent", updated_at: "2026-06-01T00:00:00Z" });
    const sorted = sortGrantDiscoveryResults([old, recent], "newest");
    expect(sorted[0].portal_id).toBe("recent");
  });

  it("returns empty array for empty input", () => {
    expect(sortGrantDiscoveryResults([], "recommended")).toEqual([]);
  });

  it("returns single-element array unchanged", () => {
    const grant = makeGrant({ portal_id: "only" });
    expect(sortGrantDiscoveryResults([grant], "recommended")).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// grantMatchesFilters
// ═══════════════════════════════════════════════════════════════════════════

describe("grantMatchesFilters", () => {
  const filters = DEFAULT_DISCOVERY_FILTERS;

  it("matches all grants with default filters", () => {
    const grant = makeGrant({ status: "active" });
    expect(grantMatchesFilters(grant, filters)).toBe(true);
  });

  it("filters by text query in title", () => {
    const grant = makeGrant({ title: "Youth Development Grant" });
    expect(grantMatchesFilters(grant, { ...filters, query: "youth" })).toBe(true);
    expect(grantMatchesFilters(grant, { ...filters, query: "housing" })).toBe(false);
  });

  it("text query is case-insensitive", () => {
    const grant = makeGrant({ title: "Workforce Training" });
    expect(grantMatchesFilters(grant, { ...filters, query: "WORKFORCE" })).toBe(true);
  });

  it("text query searches agency_dept", () => {
    const grant = makeGrant({ agency_dept: "CA Department of Health" });
    expect(grantMatchesFilters(grant, { ...filters, query: "health" })).toBe(true);
  });

  it("text query searches categories", () => {
    const grant = makeGrant({ categories: ["Environment", "Climate"] });
    expect(grantMatchesFilters(grant, { ...filters, query: "climate" })).toBe(true);
  });

  it("status filter 'open' excludes closed grants", () => {
    const closed = makeGrant({ status: "closed" });
    expect(grantMatchesFilters(closed, { ...filters, status: "open" })).toBe(false);
  });

  it("status filter 'historical' excludes open grants", () => {
    const open = makeGrant({ status: "active" });
    expect(grantMatchesFilters(open, { ...filters, status: "historical" })).toBe(false);
  });

  it("status filter 'all' includes both open and closed", () => {
    const open = makeGrant({ status: "active" });
    const closed = makeGrant({ status: "closed" });
    expect(grantMatchesFilters(open, { ...filters, status: "all" })).toBe(true);
    expect(grantMatchesFilters(closed, { ...filters, status: "all" })).toBe(true);
  });

  it("jurisdiction filter 'california' matches CA grants", () => {
    const ca = makeGrant({ source_jurisdiction: "California" });
    const other = makeGrant({ source_jurisdiction: "Oregon" });
    expect(grantMatchesFilters(ca, { ...filters, jurisdiction: "california" })).toBe(true);
    expect(grantMatchesFilters(other, { ...filters, jurisdiction: "california" })).toBe(false);
  });

  it("jurisdiction filter 'ca' shortcode is recognized", () => {
    const ca = makeGrant({ source_jurisdiction: "CA" });
    expect(grantMatchesFilters(ca, { ...filters, jurisdiction: "california" })).toBe(true);
  });

  it("category filter requires at least one matching category", () => {
    const grant = makeGrant({ categories: ["Education", "Youth"] });
    expect(grantMatchesFilters(grant, { ...filters, categories: ["education"] })).toBe(true);
    expect(grantMatchesFilters(grant, { ...filters, categories: ["housing"] })).toBe(false);
  });

  it("category filter is case-insensitive", () => {
    const grant = makeGrant({ categories: ["Education"] });
    expect(grantMatchesFilters(grant, { ...filters, categories: ["EDUCATION"] })).toBe(true);
  });

  it("minAmount filter excludes grants with lower funding", () => {
    const low = makeGrant({ est_avail_funds_numeric: 5_000 });
    expect(grantMatchesFilters(low, { ...filters, minAmount: "10000" })).toBe(false);
    expect(grantMatchesFilters(makeGrant({ est_avail_funds_numeric: 50_000 }), { ...filters, minAmount: "10000" })).toBe(true);
  });

  it("maxAmount filter excludes grants with higher funding", () => {
    const high = makeGrant({ est_avail_funds_numeric: 1_000_000 });
    expect(grantMatchesFilters(high, { ...filters, maxAmount: "100000" })).toBe(false);
  });

  it("loi filter 'yes' matches grants requiring LOI", () => {
    const withLoi = makeGrant({ loi_required: true });
    const withoutLoi = makeGrant({ loi_required: false });
    expect(grantMatchesFilters(withLoi, { ...filters, loiRequired: "yes" })).toBe(true);
    expect(grantMatchesFilters(withoutLoi, { ...filters, loiRequired: "yes" })).toBe(false);
  });

  it("loi filter 'no' matches grants NOT requiring LOI", () => {
    const withLoi = makeGrant({ loi_required: true });
    const withoutLoi = makeGrant({ loi_required: false });
    expect(grantMatchesFilters(withLoi, { ...filters, loiRequired: "no" })).toBe(false);
    expect(grantMatchesFilters(withoutLoi, { ...filters, loiRequired: "no" })).toBe(true);
  });

  it("matching funds filter 'yes' matches grants with required matching", () => {
    const withMatch = makeGrant({ matching_funds: "Required" });
    const withoutMatch = makeGrant({ matching_funds: "Not Required" });
    expect(grantMatchesFilters(withMatch, { ...filters, matchingFunds: "yes" })).toBe(true);
    expect(grantMatchesFilters(withoutMatch, { ...filters, matchingFunds: "yes" })).toBe(false);
  });

  it("deadline window filter excludes grants beyond the window", () => {
    const farDeadline = new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString();
    const grant = makeGrant({ application_deadline: farDeadline, status: "active" });
    expect(grantMatchesFilters(grant, { ...filters, deadlineWindow: "30" })).toBe(false);
  });

  it("deadline window filter includes ongoing grants", () => {
    const ongoing = makeGrant({ deadline_is_ongoing: true, application_deadline: null });
    expect(grantMatchesFilters(ongoing, { ...filters, deadlineWindow: "30" })).toBe(true);
  });

  it("source kind filter matches grants of the correct kind", () => {
    const csv = makeGrant({ source_kind: "csv" });
    const webpage = makeGrant({ source_kind: "webpage" });
    expect(grantMatchesFilters(csv, { ...filters, sourceKind: "csv" })).toBe(true);
    expect(grantMatchesFilters(webpage, { ...filters, sourceKind: "csv" })).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// normalizeGrantRecords
// ═══════════════════════════════════════════════════════════════════════════

describe("normalizeGrantRecords", () => {
  it("returns empty array for null", () => {
    expect(normalizeGrantRecords(null)).toEqual([]);
  });

  it("returns empty array for non-object", () => {
    expect(normalizeGrantRecords("string")).toEqual([]);
    expect(normalizeGrantRecords(42)).toEqual([]);
  });

  it("handles array input", () => {
    const payload = [{ portal_id: "1", title: "Grant A", loi_required: false, categories: [], applicant_types: [], source_highlights: [], deadline_is_ongoing: false }];
    const result = normalizeGrantRecords(payload);
    expect(result).toHaveLength(1);
    expect(result[0].portal_id).toBe("1");
    expect(result[0].title).toBe("Grant A");
  });

  it("handles object (map) input", () => {
    const payload = { "grant-1": { title: "Grant B", loi_required: false, categories: [], applicant_types: [], source_highlights: [], deadline_is_ongoing: false } };
    const result = normalizeGrantRecords(payload);
    expect(result).toHaveLength(1);
    expect(result[0].portal_id).toBe("grant-1");
    expect(result[0].title).toBe("Grant B");
  });

  it("normalizes missing optional fields to null", () => {
    const payload = [{ portal_id: "2", title: "T", loi_required: false, categories: [], applicant_types: [], source_highlights: [], deadline_is_ongoing: false }];
    const result = normalizeGrantRecords(payload);
    expect(result[0].agency_dept).toBeNull();
    expect(result[0].geography).toBeNull();
    expect(result[0].purpose).toBeNull();
  });

  it("normalizes loi_required as boolean", () => {
    const payload = [{ portal_id: "3", title: "T", loi_required: 1, categories: [], applicant_types: [], source_highlights: [], deadline_is_ongoing: false }];
    const result = normalizeGrantRecords(payload as unknown[]);
    expect(typeof result[0].loi_required).toBe("boolean");
  });

  it("normalizes categories as string array", () => {
    const payload = [{ portal_id: "4", title: "T", loi_required: false, categories: ["A", "B"], applicant_types: [], source_highlights: [], deadline_is_ongoing: false }];
    const result = normalizeGrantRecords(payload);
    expect(result[0].categories).toEqual(["A", "B"]);
  });

  it("returns empty arrays for missing array fields", () => {
    const payload = [{ portal_id: "5", title: "T" }];
    const result = normalizeGrantRecords(payload as unknown[]);
    expect(Array.isArray(result[0].categories)).toBe(true);
    expect(Array.isArray(result[0].applicant_types)).toBe(true);
    expect(Array.isArray(result[0].source_highlights)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// normalizeWatchlistEntries
// ═══════════════════════════════════════════════════════════════════════════

describe("normalizeWatchlistEntries", () => {
  it("returns empty for null", () => {
    expect(normalizeWatchlistEntries(null)).toEqual([]);
  });

  it("handles array input", () => {
    const payload: WatchlistEntry[] = [{ portal_id: "g-1", saved: true, note: "important" }];
    const result = normalizeWatchlistEntries(payload);
    expect(result).toHaveLength(1);
    expect(result[0].portal_id).toBe("g-1");
    expect(result[0].saved).toBe(true);
    expect(result[0].note).toBe("important");
  });

  it("handles object map input", () => {
    const payload = { "g-2": { saved: true, note: "review" } };
    const result = normalizeWatchlistEntries(payload);
    expect(result).toHaveLength(1);
    expect(result[0].portal_id).toBe("g-2");
  });

  it("defaults saved to true when missing", () => {
    const payload = [{ portal_id: "g-3" }];
    const result = normalizeWatchlistEntries(payload as unknown[]);
    expect(result[0].saved).toBe(true);
  });

  it("null note is preserved as null", () => {
    const payload = [{ portal_id: "g-4", saved: true, note: null }];
    const result = normalizeWatchlistEntries(payload);
    expect(result[0].note).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// normalizeOrganization
// ═══════════════════════════════════════════════════════════════════════════

describe("normalizeOrganization", () => {
  it("returns null for null payload", () => {
    expect(normalizeOrganization(null, null)).toBeNull();
  });

  it("returns null for array payload with no uid and no fallback", () => {
    expect(normalizeOrganization([{}], null)).toBeNull();
  });

  it("extracts uid from object", () => {
    const payload = { uid: "org-uid-1", name: "Test Org" };
    const result = normalizeOrganization(payload, null);
    expect(result?.uid).toBe("org-uid-1");
    expect(result?.name).toBe("Test Org");
  });

  it("uses fallback uid when payload lacks uid", () => {
    const payload = { name: "Fallback Org" };
    const result = normalizeOrganization(payload, "fallback-uid");
    expect(result?.uid).toBe("fallback-uid");
  });

  it("normalizes programs array", () => {
    const payload = { uid: "u", programs: [{ name: "Program A", budget: 100000 }] };
    const result = normalizeOrganization(payload, null);
    expect(result?.programs).toHaveLength(1);
    expect(result?.programs?.[0].name).toBe("Program A");
    expect(result?.programs?.[0].budget).toBe(100000);
  });

  it("handles array payload (takes first element)", () => {
    const payload = [{ uid: "first-uid", name: "First Org" }, { uid: "second-uid" }];
    const result = normalizeOrganization(payload, null);
    expect(result?.uid).toBe("first-uid");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// normalizeDraftRecords
// ═══════════════════════════════════════════════════════════════════════════

describe("normalizeDraftRecords", () => {
  it("returns empty for null", () => {
    expect(normalizeDraftRecords(null)).toEqual([]);
  });

  it("handles array input", () => {
    const payload = [{ draft_id: "d-1", grant_portal_id: "g-1", status: "draft", version: 1, generation_mode: "ai" }];
    const result = normalizeDraftRecords(payload);
    expect(result).toHaveLength(1);
    expect(result[0].draft_id).toBe("d-1");
    expect(result[0].generation_mode).toBe("ai");
  });

  it("normalizes unknown generation_mode to 'unknown'", () => {
    const payload = [{ draft_id: "d-2", grant_portal_id: "g-1", status: "draft", version: 1, generation_mode: "INVALID_MODE" }];
    const result = normalizeDraftRecords(payload);
    expect(result[0].generation_mode).toBe("unknown");
  });

  it("handles object map input", () => {
    const payload = { "d-3": { grant_portal_id: "g-2", status: "draft", version: 2, generation_mode: "local_scaffold" } };
    const result = normalizeDraftRecords(payload);
    expect(result).toHaveLength(1);
    expect(result[0].generation_mode).toBe("local_scaffold");
  });

  it("defaults version to 1 when missing", () => {
    const payload = [{ draft_id: "d-4", grant_portal_id: "g-3" }];
    const result = normalizeDraftRecords(payload as unknown[]);
    expect(result[0].version).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// serializePrograms / parsePrograms
// ═══════════════════════════════════════════════════════════════════════════

describe("serializePrograms", () => {
  it("returns empty string for null", () => {
    expect(serializePrograms(null)).toBe("");
  });

  it("returns empty string for empty array", () => {
    expect(serializePrograms([])).toBe("");
  });

  it("serializes a single program", () => {
    const result = serializePrograms([{ name: "After School", description: "Tutoring", budget: 50000 }]);
    expect(result).toContain("After School");
    expect(result).toContain("Tutoring");
    expect(result).toContain("50000");
  });

  it("serializes multiple programs separated by newline", () => {
    const programs = [
      { name: "Program A", description: null, budget: null },
      { name: "Program B", description: "Desc B", budget: 100000 },
    ];
    const result = serializePrograms(programs);
    const lines = result.split("\n");
    expect(lines).toHaveLength(2);
  });
});

describe("parsePrograms", () => {
  it("returns empty array for empty string", () => {
    expect(parsePrograms("")).toEqual([]);
  });

  it("parses a single program line", () => {
    const result = parsePrograms("After School | Tutoring program | 50000");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("After School");
    expect(result[0].description).toBe("Tutoring program");
    expect(result[0].budget).toBe(50000);
  });

  it("parses multiple lines", () => {
    const text = "Program A | Desc A | 10000\nProgram B | | ";
    const result = parsePrograms(text);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("Program A");
    expect(result[1].name).toBe("Program B");
    expect(result[1].description).toBeNull();
    expect(result[1].budget).toBeNull();
  });

  it("skips blank lines", () => {
    const text = "Program A | Desc | 5000\n\n  \nProgram B | | ";
    const result = parsePrograms(text);
    expect(result).toHaveLength(2);
  });

  it("skips entries with no name", () => {
    const text = " | Desc | 5000";
    const result = parsePrograms(text);
    expect(result).toHaveLength(0);
  });

  it("parse budget with dollar sign", () => {
    const result = parsePrograms("Program | Desc | $75,000");
    expect(result[0].budget).toBe(75000);
  });

  it("roundtrips through serialize -> parse", () => {
    const original = [
      { name: "Program A", description: "Desc A", budget: 10000 },
      { name: "Program B", description: null, budget: null },
    ];
    const serialized = serializePrograms(original);
    const parsed = parsePrograms(serialized);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe("Program A");
    expect(parsed[0].budget).toBe(10000);
    expect(parsed[1].name).toBe("Program B");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// composeDraftBody
// ═══════════════════════════════════════════════════════════════════════════

describe("composeDraftBody", () => {
  it("returns empty string for draft with no sections", () => {
    const draft = makeDraft();
    expect(composeDraftBody(draft)).toBe("");
  });

  it("includes title when present", () => {
    const draft = makeDraft({ title: "My Grant Application" });
    expect(composeDraftBody(draft)).toContain("Title: My Grant Application");
  });

  it("includes section headings and content", () => {
    const draft = makeDraft({
      section_org_overview: "We are a nonprofit...",
      section_need_statement: "The community needs...",
    });
    const body = composeDraftBody(draft);
    expect(body).toContain("Organization Overview:");
    expect(body).toContain("We are a nonprofit...");
    expect(body).toContain("Need Statement:");
    expect(body).toContain("The community needs...");
  });

  it("omits sections that are null or empty", () => {
    const draft = makeDraft({ section_org_overview: null, section_need_statement: "" });
    const body = composeDraftBody(draft);
    expect(body).not.toContain("Organization Overview:");
    expect(body).not.toContain("Need Statement:");
  });

  it("includes all 10 possible sections when all populated", () => {
    const draft = makeDraft({
      section_org_overview: "a",
      section_need_statement: "b",
      section_project_description: "c",
      section_goals_objectives: "d",
      section_implementation_plan: "e",
      section_evaluation_plan: "f",
      section_budget_narrative: "g",
      section_sustainability: "h",
      section_org_capacity: "i",
      section_loi_text: "j",
    });
    const body = composeDraftBody(draft);
    expect(body).toContain("Organization Overview:");
    expect(body).toContain("Letter of Intent:");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// exportDraftFileName
// ═══════════════════════════════════════════════════════════════════════════

describe("exportDraftFileName", () => {
  it("includes draft_id in filename", () => {
    const draft = makeDraft({ draft_id: "abc123" });
    expect(exportDraftFileName(draft)).toContain("abc123");
  });

  it("uses title as prefix", () => {
    const draft = makeDraft({ title: "Education Grant", draft_id: "d1" });
    expect(exportDraftFileName(draft)).toMatch(/^Education Grant/);
  });

  it("ends with .docx", () => {
    expect(exportDraftFileName(makeDraft())).toMatch(/\.docx$/);
  });

  it("replaces illegal filesystem characters", () => {
    const draft = makeDraft({ title: "Grant: Title / With \\Special <Chars>" });
    const name = exportDraftFileName(draft);
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
  });

  it("uses grant portal id when title is null", () => {
    const draft = makeDraft({ title: null, grant_portal_id: "grant-portal-1" });
    expect(exportDraftFileName(draft)).toContain("grant-portal-1");
  });

  it("falls back to draft_id when title and grant_portal_id are missing", () => {
    const draft = makeDraft({ title: null, grant_portal_id: "", draft_id: "fallback-id" });
    expect(exportDraftFileName(draft)).toContain("fallback-id");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// summarizeSetup
// ═══════════════════════════════════════════════════════════════════════════

describe("summarizeSetup", () => {
  it("returns blocked for null validation", () => {
    const result = summarizeSetup(null);
    expect(result.ready).toBe("blocked");
    expect(result.missing).toBeNull();
  });

  it("returns ready when validation is ready", () => {
    const result = summarizeSetup({
      ready: true,
      missing_fields: [],
      signed_in: true,
      session_mode: "firebase",
      workspace_ready: true,
      dev_profile_ready: false,
    });
    expect(result.ready).toBe("ready");
    expect(result.mode).toBe("Firebase session");
    expect(result.workspaceReady).toBe("ready");
    expect(result.devProfileReady).toBe("blocked");
  });

  it("lists missing fields when blocked", () => {
    const result = summarizeSetup({
      ready: false,
      missing_fields: ["firebase_rtdb_url", "organization_uid"],
      signed_in: false,
      session_mode: "none",
      workspace_ready: false,
      dev_profile_ready: false,
    });
    expect(result.ready).toBe("blocked");
    expect(result.missing).toContain("firebase_rtdb_url");
    expect(result.missing).toContain("organization_uid");
  });

  it("shows dev_profile mode label", () => {
    const result = summarizeSetup({
      ready: true,
      missing_fields: [],
      signed_in: true,
      session_mode: "dev_profile",
      workspace_ready: false,
      dev_profile_ready: true,
    });
    expect(result.mode).toBe("Local dev profile");
    expect(result.workspaceReady).toBe("blocked");
    expect(result.devProfileReady).toBe("ready");
  });

  it("shows no session when mode is none", () => {
    const result = summarizeSetup({
      ready: false,
      missing_fields: [],
      signed_in: false,
      session_mode: "none",
      workspace_ready: false,
      dev_profile_ready: false,
    });
    expect(result.mode).toBe("No session");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// toMessage / isObject
// ═══════════════════════════════════════════════════════════════════════════

describe("toMessage", () => {
  it("extracts message from Error", () => {
    expect(toMessage(new Error("something broke"))).toBe("something broke");
  });

  it("returns string directly", () => {
    expect(toMessage("direct string")).toBe("direct string");
  });

  it("returns fallback for unknown types", () => {
    expect(toMessage(42)).toBe("Unexpected error");
    expect(toMessage(null)).toBe("Unexpected error");
  });
});

describe("isObject", () => {
  it("returns true for plain objects", () => {
    expect(isObject({ a: 1 })).toBe(true);
  });

  it("returns false for null", () => {
    expect(isObject(null)).toBe(false);
  });

  it("returns false for arrays", () => {
    expect(isObject([])).toBe(false);
  });

  it("returns false for primitives", () => {
    expect(isObject("string")).toBe(false);
    expect(isObject(42)).toBe(false);
  });
});
