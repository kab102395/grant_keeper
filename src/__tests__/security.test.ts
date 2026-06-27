/**
 * Security boundary tests for the Grant Keeper frontend.
 *
 * These tests verify that data flowing through normalizers, filters, and
 * formatters does NOT get executed, modified, or cause crashes regardless of
 * what an attacker might put in a database record. The frontend is responsible
 * for rendering — XSS prevention is a React concern (JSX escaping) — but the
 * pure functions here must never silently transform malicious input in a way
 * that could mask a vulnerability or cause unexpected behavior downstream.
 */

import { describe, expect, it } from "vitest";
import {
  composeDraftBody,
  exportDraftFileName,
  formatCurrency,
  formatTimestamp,
  grantMatchesFilters,
  grantStatusLabel,
  normalizeGrantRecords,
  normalizeOrganization,
  normalizeWatchlistEntries,
  normalizeDraftRecords,
  parsePrograms,
  serializePrograms,
  DEFAULT_DISCOVERY_FILTERS,
} from "../lib/shell";
import type { DraftRecord, GrantRecord } from "../lib/types";

const filters = DEFAULT_DISCOVERY_FILTERS;

function makeGrant(overrides: Partial<GrantRecord> = {}): GrantRecord {
  return {
    portal_id: "1",
    title: "Test Grant",
    agency_dept: "Agency",
    status: "active",
    deadline: null,
    loi_required: false,
    categories: [],
    source_highlights: [],
    applicant_types: [],
    deadline_is_ongoing: false,
    ...overrides,
  };
}

function makeDraft(overrides: Partial<DraftRecord> = {}): DraftRecord {
  return {
    draft_id: "d-1",
    grant_portal_id: "g-1",
    status: "draft",
    version: 1,
    generation_mode: "local_scaffold",
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// XSS payload preservation
// These tests verify that XSS strings are treated as inert data by pure
// functions. React's JSX escaping prevents rendering them as HTML, but we
// also need to confirm the normalizers don't strip or transform them.
// ═══════════════════════════════════════════════════════════════════════════

const XSS_PAYLOADS = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  "javascript:alert(1)",
  '"><script>alert(document.cookie)</script>',
  "'; DROP TABLE grants; --",
  "<svg onload=alert(1)>",
  "\"><img src=x>",
  "{{7*7}}",
  "${7*7}",
  "#{7*7}",
];

describe("XSS payloads preserved literally by normalizeGrantRecords", () => {
  for (const payload of XSS_PAYLOADS) {
    it(`preserves: ${payload.slice(0, 40)}`, () => {
      const raw = [{ portal_id: "x", title: payload, loi_required: false, categories: [], applicant_types: [], source_highlights: [], deadline_is_ongoing: false }];
      const result = normalizeGrantRecords(raw);
      expect(result[0].title).toBe(payload);
    });
  }
});

describe("XSS in grant agency_dept preserved literally", () => {
  for (const payload of XSS_PAYLOADS) {
    it(`preserves agency: ${payload.slice(0, 40)}`, () => {
      const raw = [{ portal_id: "x", title: "T", agency_dept: payload, loi_required: false, categories: [], applicant_types: [], source_highlights: [], deadline_is_ongoing: false }];
      const result = normalizeGrantRecords(raw);
      expect(result[0].agency_dept).toBe(payload);
    });
  }
});

describe("XSS payloads in filter search query do not crash or eval", () => {
  for (const payload of XSS_PAYLOADS) {
    it(`query filter handles: ${payload.slice(0, 40)}`, () => {
      const grant = makeGrant({ title: "Safe Grant Title" });
      expect(() => grantMatchesFilters(grant, { ...filters, query: payload })).not.toThrow();
    });
  }
});

describe("XSS in org name preserved by normalizeOrganization", () => {
  for (const payload of XSS_PAYLOADS) {
    it(`preserves org name: ${payload.slice(0, 40)}`, () => {
      const result = normalizeOrganization({ uid: "u", name: payload }, null);
      expect(result?.name).toBe(payload);
    });
  }
});

describe("XSS in draft sections preserved by composeDraftBody", () => {
  for (const payload of XSS_PAYLOADS) {
    it(`preserves section content: ${payload.slice(0, 40)}`, () => {
      const draft = makeDraft({ section_org_overview: payload });
      const body = composeDraftBody(draft);
      expect(body).toContain(payload);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Path traversal — verify portal IDs and filenames don't get path-modified
// ═══════════════════════════════════════════════════════════════════════════

describe("Path traversal in portal_id preserved by normalizeGrantRecords", () => {
  const traversals = [
    "../../etc/passwd",
    "..\\..\\windows\\system32",
    "/absolute/path",
    "grants%2F..%2Fsecret",
    "%2e%2e%2fetc%2fpasswd",
  ];

  for (const traversal of traversals) {
    it(`preserves portal_id: ${traversal}`, () => {
      const raw = [{ portal_id: traversal, title: "T", loi_required: false, categories: [], applicant_types: [], source_highlights: [], deadline_is_ongoing: false }];
      const result = normalizeGrantRecords(raw);
      expect(result[0].portal_id).toBe(traversal);
    });
  }
});

describe("exportDraftFileName sanitizes path-traversal characters", () => {
  it("removes backslash and forward slash from title", () => {
    const draft = makeDraft({ title: "../../etc/passwd", draft_id: "d1" });
    const filename = exportDraftFileName(draft);
    expect(filename).not.toContain("/");
    expect(filename).not.toContain("\\");
    expect(filename).toMatch(/\.docx$/);
  });

  it("removes colon from title (Windows drive letter injection)", () => {
    const draft = makeDraft({ title: "C:/Windows/System32/cmd.exe", draft_id: "d1" });
    const filename = exportDraftFileName(draft);
    expect(filename).not.toContain(":");
  });

  it("removes asterisk and question mark from title", () => {
    const draft = makeDraft({ title: "Grant*.docx?id=1", draft_id: "d1" });
    const filename = exportDraftFileName(draft);
    expect(filename).not.toContain("*");
    expect(filename).not.toContain("?");
  });

  it("removes angle brackets from title", () => {
    const draft = makeDraft({ title: "<script>alert</script>", draft_id: "d1" });
    const filename = exportDraftFileName(draft);
    expect(filename).not.toContain("<");
    expect(filename).not.toContain(">");
  });

  it("removes pipe character from title", () => {
    const draft = makeDraft({ title: "Grant | Pipe | Test", draft_id: "d1" });
    const filename = exportDraftFileName(draft);
    expect(filename).not.toContain("|");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Null byte injection
// ═══════════════════════════════════════════════════════════════════════════

describe("Null byte in grant data does not crash normalizers", () => {
  it("null byte in title handled without throwing", () => {
    const raw = [{ portal_id: "x", title: "Grant\x00Title", loi_required: false, categories: [], applicant_types: [], source_highlights: [], deadline_is_ongoing: false }];
    expect(() => normalizeGrantRecords(raw)).not.toThrow();
  });

  it("null byte in uid handled by normalizeOrganization", () => {
    expect(() => normalizeOrganization({ uid: "uid\x00test", name: "Org" }, null)).not.toThrow();
  });

  it("null byte in watchlist note handled", () => {
    expect(() => normalizeWatchlistEntries([{ portal_id: "g", saved: true, note: "note\x00" }])).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Integer overflow / boundary values in numeric fields
// ═══════════════════════════════════════════════════════════════════════════

describe("Numeric boundary values in filters", () => {
  it("minAmount with MAX_SAFE_INTEGER does not crash", () => {
    const grant = makeGrant({ est_avail_funds_numeric: 1000 });
    expect(() =>
      grantMatchesFilters(grant, { ...filters, minAmount: String(Number.MAX_SAFE_INTEGER) }),
    ).not.toThrow();
  });

  it("maxAmount with negative value does not crash", () => {
    const grant = makeGrant({ est_avail_funds_numeric: 1000 });
    expect(() =>
      grantMatchesFilters(grant, { ...filters, maxAmount: "-999999" }),
    ).not.toThrow();
  });

  it("minAmount with NaN string does not crash", () => {
    const grant = makeGrant({ est_avail_funds_numeric: 1000 });
    expect(() =>
      grantMatchesFilters(grant, { ...filters, minAmount: "NaN" }),
    ).not.toThrow();
  });

  it("formatCurrency with Infinity does not crash", () => {
    expect(() => formatCurrency(Infinity)).not.toThrow();
  });

  it("formatCurrency with NaN does not crash", () => {
    expect(() => formatCurrency(Number.NaN)).not.toThrow();
  });

  it("formatCurrency with negative number does not crash", () => {
    expect(() => formatCurrency(-999_999)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Unicode and special characters
// ═══════════════════════════════════════════════════════════════════════════

describe("Unicode and special characters in data", () => {
  const UNICODE_SAMPLES = [
    "日本語テスト",
    "中文测试",
    "한국어 테스트",
    "العربية",
    "Ελληνικά",
    "𝕳𝖊𝖑𝖑𝖔 𝖂𝖔𝖗𝖑𝖉",
    "🎉🎊🏆🌟",
    "​‌‍﻿", // zero-width chars and BOM
    "\r\n\t",
    " ", // control characters
  ];

  for (const sample of UNICODE_SAMPLES) {
    it(`handles unicode in title: ${JSON.stringify(sample.slice(0, 20))}`, () => {
      const raw = [{ portal_id: "u", title: sample, loi_required: false, categories: [], applicant_types: [], source_highlights: [], deadline_is_ongoing: false }];
      expect(() => normalizeGrantRecords(raw)).not.toThrow();
      const result = normalizeGrantRecords(raw);
      expect(result[0].title).toBe(sample);
    });
  }

  it("grantStatusLabel handles unicode in status without crashing", () => {
    expect(() => grantStatusLabel(makeGrant({ status: "活动中" }))).not.toThrow();
  });

  it("formatTimestamp handles unicode date string gracefully", () => {
    expect(() => formatTimestamp("二〇二六年六月")).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Large payload stress tests
// ═══════════════════════════════════════════════════════════════════════════

describe("Large payload handling", () => {
  it("normalizeGrantRecords handles 10,000 records without OOM", () => {
    const records = Array.from({ length: 10_000 }, (_, i) => ({
      portal_id: String(i),
      title: `Grant ${i}`,
      loi_required: i % 2 === 0,
      categories: ["Education"],
      applicant_types: ["Nonprofit"],
      source_highlights: [],
      deadline_is_ongoing: false,
    }));
    const result = normalizeGrantRecords(records);
    expect(result).toHaveLength(10_000);
  });

  it("normalizeGrantRecords handles a grant with 100KB description", () => {
    const bigDesc = "A".repeat(100_000);
    const raw = [{ portal_id: "big", title: "T", description: bigDesc, loi_required: false, categories: [], applicant_types: [], source_highlights: [], deadline_is_ongoing: false }];
    const result = normalizeGrantRecords(raw);
    expect(result[0].description?.length).toBe(100_000);
  });

  it("grantMatchesFilters handles 100KB query string without crashing", () => {
    const grant = makeGrant({ title: "Test" });
    const longQuery = "x".repeat(100_000);
    expect(() => grantMatchesFilters(grant, { ...filters, query: longQuery })).not.toThrow();
  });

  it("composeDraftBody handles 100KB section content", () => {
    const bigContent = "Section text. ".repeat(7_000);
    const draft = makeDraft({ section_org_overview: bigContent });
    const body = composeDraftBody(draft);
    expect(body.length).toBeGreaterThan(50_000);
  });

  it("parsePrograms handles 1,000 program lines", () => {
    const lines = Array.from({ length: 1_000 }, (_, i) => `Program ${i} | Desc ${i} | ${i * 1000}`).join("\n");
    const result = parsePrograms(lines);
    expect(result).toHaveLength(1_000);
  });

  it("serializePrograms handles 1,000 programs", () => {
    const programs = Array.from({ length: 1_000 }, (_, i) => ({ name: `Program ${i}`, description: null, budget: null }));
    expect(() => serializePrograms(programs)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Deeply nested / unexpected data structures
// ═══════════════════════════════════════════════════════════════════════════

describe("Unexpected data structures handled gracefully", () => {
  it("normalizeGrantRecords handles null items in array", () => {
    expect(() => normalizeGrantRecords([null, undefined, 42, "string"] as unknown[])).not.toThrow();
  });

  it("normalizeWatchlistEntries handles null items in array", () => {
    expect(() => normalizeWatchlistEntries([null, undefined] as unknown[])).not.toThrow();
  });

  it("normalizeOrganization handles non-object first array element", () => {
    expect(normalizeOrganization(["not-an-object"] as unknown[], "fallback")).toBeNull();
  });

  it("normalizeDraftRecords handles deeply nested non-standard value", () => {
    const raw = [{ draft_id: "d", grant_portal_id: "g", status: { nested: "object" }, version: 1, generation_mode: "ai" }];
    expect(() => normalizeDraftRecords(raw as unknown[])).not.toThrow();
  });

  it("grantMatchesFilters handles grant with empty categories array", () => {
    const grant = makeGrant({ categories: [] });
    expect(() => grantMatchesFilters(grant, { ...filters, categories: ["Education"] })).not.toThrow();
    expect(grantMatchesFilters(grant, { ...filters, categories: ["Education"] })).toBe(false);
  });

  it("grantStatusLabel handles null status", () => {
    const grant = makeGrant({ status: null });
    expect(() => grantStatusLabel(grant)).not.toThrow();
  });

  it("grantStatusLabel handles undefined status", () => {
    const grant = makeGrant({ status: undefined });
    expect(() => grantStatusLabel(grant)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Input injection in program serializer / parser
// ═══════════════════════════════════════════════════════════════════════════

describe("Injection in program name/description", () => {
  it("XSS in program name preserved by serialize", () => {
    const programs = [{ name: "<script>alert(1)</script>", description: null, budget: null }];
    const serialized = serializePrograms(programs);
    expect(serialized).toContain("<script>alert(1)</script>");
  });

  it("pipe delimiter in program name does not break parser catastrophically", () => {
    // A pipe in the name will be split — this is a data concern, not a security crash
    expect(() => parsePrograms("Program | Extra Pipe | In | Name | 1000")).not.toThrow();
  });

  it("newline injection in program description does not break serialize roundtrip badly", () => {
    const programs = [{ name: "Program A", description: "Line1\nLine2", budget: null }];
    expect(() => serializePrograms(programs)).not.toThrow();
  });
});
