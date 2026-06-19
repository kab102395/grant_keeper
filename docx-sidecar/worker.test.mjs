/**
 * Docx sidecar test suite.
 * Run: node --test docx-sidecar/worker.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Packer } from "docx";
import {
  sanitizeFileStem,
  nonEmpty,
  sectionParagraphs,
  grantMetaParagraphs,
  organizationMetaParagraphs,
  buildDocument,
} from "./worker.mjs";

function collectText(value) {
  if (typeof value === "string") {
    return value;
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  if (Array.isArray(value.root)) {
    return value.root.map(collectText).join("");
  }
  return "";
}

function paragraphTexts(paragraphs) {
  return paragraphs.map(collectText);
}

describe("sanitizeFileStem", () => {
  it("returns fallback for null", () => {
    assert.equal(sanitizeFileStem(null), "grant-keeper-draft");
  });

  it("returns fallback for empty string", () => {
    assert.equal(sanitizeFileStem(""), "grant-keeper-draft");
  });

  it("replaces illegal path characters", () => {
    const result = sanitizeFileStem('a/b\\c:d*e?f"g<h>i|j');
    assert.ok(!/[\\/:*?"<>|]/.test(result));
  });

  it("trims and collapses whitespace", () => {
    assert.equal(sanitizeFileStem("  Grant   Title  "), "Grant Title");
  });

  it("truncates to 120 characters", () => {
    const long = "A".repeat(200);
    assert.equal(sanitizeFileStem(long).length, 120);
  });
});

describe("nonEmpty", () => {
  it("filters empty values", () => {
    assert.equal(nonEmpty(""), false);
    assert.equal(nonEmpty("   "), false);
    assert.equal(nonEmpty("value"), true);
  });
});

describe("sectionParagraphs", () => {
  it("returns heading plus content blocks", () => {
    const result = sectionParagraphs("Title", "One\n\nTwo");
    assert.equal(result.length, 3);
    assert.deepEqual(paragraphTexts(result).slice(1), ["One", "Two"]);
  });

  it("returns empty array for empty body", () => {
    assert.deepEqual(sectionParagraphs("Title", ""), []);
  });
});

describe("grantMetaParagraphs", () => {
  it("returns five paragraphs", () => {
    assert.equal(grantMetaParagraphs({}).length, 5);
  });

  it("renders fallback labels and values", () => {
    const paragraphs = grantMetaParagraphs({});
    assert.deepEqual(paragraphTexts(paragraphs), [
      "Portal ID: not set",
      "Agency: not set",
      "Status: not set",
      "Deadline: not set",
      "Funding: not set",
    ]);
  });

  it("renders grant values", () => {
    const paragraphs = grantMetaParagraphs({
      portal_id: "171870",
      agency_dept: "CA Dept of Education",
      status: "open",
      deadline_is_ongoing: false,
      application_deadline: "2026-08-14",
      est_amounts: "$50,000",
    });
    assert.deepEqual(paragraphTexts(paragraphs), [
      "Portal ID: 171870",
      "Agency: CA Dept of Education",
      "Status: open",
      "Deadline: 2026-08-14",
      "Funding: $50,000",
    ]);
  });

  it("renders ongoing deadline", () => {
    const paragraphs = grantMetaParagraphs({ deadline_is_ongoing: true });
    assert.equal(paragraphTexts(paragraphs)[3], "Deadline: Ongoing");
  });
});

describe("organizationMetaParagraphs", () => {
  it("returns five paragraphs", () => {
    assert.equal(organizationMetaParagraphs({}).length, 5);
  });

  it("renders fallback labels and values", () => {
    const paragraphs = organizationMetaParagraphs({});
    assert.deepEqual(paragraphTexts(paragraphs), [
      "Organization: not set",
      "UID: not set",
      "Contact: not set",
      "Email: not set",
      "Website: not set",
    ]);
  });

  it("renders organization values", () => {
    const paragraphs = organizationMetaParagraphs({
      uid: "org-uid-1",
      name: "Community Partners",
      contact_name: "Alice Smith",
      contact_email: "alice@communitypartners.org",
      website: "https://communitypartners.org",
    });
    assert.deepEqual(paragraphTexts(paragraphs), [
      "Organization: Community Partners",
      "UID: org-uid-1",
      "Contact: Alice Smith",
      "Email: alice@communitypartners.org",
      "Website: https://communitypartners.org",
    ]);
  });
});

describe("buildDocument", () => {
  const samplePayload = {
    generated_at: "2026-06-25T00:00:00Z",
    draft: {
      draft_id: "d-001",
      title: "Education Grant Application",
      body: "This is the draft body.\n\nSecond paragraph.",
      section_org_overview: "We are a nonprofit serving youth.",
      section_need_statement: "The community needs support.",
      section_project_description: "We will run after-school programs.",
      section_goals_objectives: "Goal 1: Increase literacy.",
      section_implementation_plan: "Q1: Hire staff. Q2: Launch.",
      section_evaluation_plan: "We will track outcomes monthly.",
      section_budget_narrative: "Funds will be allocated 60% personnel, 40% operations.",
      section_sustainability: "We will seek continued funding.",
      section_org_capacity: "We have 12 staff and 10 years of experience.",
      section_loi_text: "We intend to apply for this grant.",
    },
    grant: {
      portal_id: "171870",
      title: "CA Education Grant",
      agency_dept: "CA Dept of Education",
      status: "active",
      application_deadline: "2026-08-14",
      deadline_is_ongoing: false,
      est_amounts: "$50,000 - $250,000",
    },
    organization: {
      uid: "org-uid-1",
      name: "Community Partners",
      contact_name: "Alice Smith",
      contact_email: "alice@communitypartners.org",
      website: "https://communitypartners.org",
    },
  };

  it("builds a Document object without throwing", async () => {
    await assert.doesNotReject(async () => {
      await buildDocument(samplePayload);
    });
  });

  it("produces a non-empty docx buffer", async () => {
    const doc = await buildDocument(samplePayload);
    const buffer = await Packer.toBuffer(doc);
    assert.ok(buffer instanceof Buffer);
    assert.ok(buffer.length > 1000, `Expected buffer > 1KB, got ${buffer.length} bytes`);
  });

  it("buffer starts with PK zip magic bytes", async () => {
    const doc = await buildDocument(samplePayload);
    const buffer = await Packer.toBuffer(doc);
    assert.equal(buffer[0], 0x50);
    assert.equal(buffer[1], 0x4b);
  });

  it("handles empty payload gracefully", async () => {
    const doc = await buildDocument({});
    const buffer = await Packer.toBuffer(doc);
    assert.ok(buffer.length > 0);
  });

  it("handles null sections without throwing", async () => {
    const payload = {
      ...samplePayload,
      draft: {
        ...samplePayload.draft,
        section_org_overview: null,
        section_need_statement: null,
        section_loi_text: null,
      },
    };
    await assert.doesNotReject(async () => {
      const doc = await buildDocument(payload);
      await Packer.toBuffer(doc);
    });
  });

  it("handles XSS-like content without crashing", async () => {
    const payload = {
      ...samplePayload,
      draft: { ...samplePayload.draft, title: "<script>alert(1)</script>" },
      organization: { ...samplePayload.organization, name: "<img src=x onerror=alert(1)>" },
    };
    await assert.doesNotReject(async () => {
      const doc = await buildDocument(payload);
      await Packer.toBuffer(doc);
    });
  });

  it("handles very long content", async () => {
    const payload = {
      ...samplePayload,
      draft: {
        ...samplePayload.draft,
        section_org_overview: "A".repeat(50000),
        section_need_statement: "B".repeat(50000),
      },
    };
    const doc = await buildDocument(payload);
    const buffer = await Packer.toBuffer(doc);
    assert.ok(buffer.length > 0);
  });

  it("builds in under 2 seconds", async () => {
    const start = Date.now();
    const doc = await buildDocument(samplePayload);
    await Packer.toBuffer(doc);
    assert.ok(Date.now() - start < 2000);
  });
});
