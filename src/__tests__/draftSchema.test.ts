import { describe, it, expect } from "vitest";
import { composeGrantAwareDraftBody, draftSchemaSummary, resolveGrantDraftSchema } from "../lib/draftSchema";
import type { GrantRecord, DraftRecord } from "../lib/types";

function makeGrant(overrides: Partial<GrantRecord> = {}): GrantRecord {
  return {
    portal_id: "grant-1",
    title: "Community Grant",
    loi_required: false,
    categories: ["Education"],
    applicant_types: ["Nonprofit"],
    deadline_is_ongoing: false,
    matching_funds: "Not required",
    source_kind: "csv",
    source_family: "ca-grants-portal-offerings",
    ...overrides,
  } as GrantRecord;
}

function makeDraft(overrides: Partial<DraftRecord> = {}): DraftRecord {
  return {
    draft_id: "draft-1",
    grant_portal_id: "grant-1",
    status: "draft",
    version: 1,
    generation_mode: "local_scaffold",
    section_org_overview: "Org overview",
    section_need_statement: "Need statement",
    section_project_description: "Project description",
    section_goals_objectives: "Goals",
    section_implementation_plan: "Implementation",
    section_evaluation_plan: "Evaluation",
    section_budget_narrative: "Budget",
    section_sustainability: "Sustainability",
    section_org_capacity: "Capacity",
    section_loi_text: null,
    title: "Draft",
    ...overrides,
  } as DraftRecord;
}

describe("resolveGrantDraftSchema", () => {
  it("hides LOI when the grant does not require it", () => {
    const schema = resolveGrantDraftSchema(makeGrant({ loi_required: false }));
    expect(schema.has_loi_section).toBe(false);
    expect(schema.sections.some((section) => section.key === "section_loi_text")).toBe(false);
  });

  it("shows LOI when the grant requires it", () => {
    const schema = resolveGrantDraftSchema(makeGrant({ loi_required: true }));
    expect(schema.has_loi_section).toBe(true);
    expect(schema.sections.some((section) => section.key === "section_loi_text")).toBe(true);
  });

  it("customizes the budget section when matching funds are required", () => {
    const schema = resolveGrantDraftSchema(makeGrant({ matching_funds: "Required 25%" }));
    const budgetSection = schema.sections.find((section) => section.key === "section_budget_narrative");
    expect(budgetSection?.label).toContain("Match");
    expect(budgetSection?.helper).toContain("match");
  });

  it("summarizes the schema for the UI", () => {
    const schema = resolveGrantDraftSchema(makeGrant({ loi_required: true, matching_funds: "Required" }));
    expect(draftSchemaSummary(schema)).toContain("LOI");
    expect(draftSchemaSummary(schema)).toContain("match required");
  });
});

describe("composeGrantAwareDraftBody", () => {
  it("includes only visible sections in the generated body", () => {
    const grant = makeGrant({ loi_required: false });
    const body = composeGrantAwareDraftBody(makeDraft(), grant);
    expect(body).toContain("Grant Context:");
    expect(body).toContain("Organization Overview:");
    expect(body).not.toContain("Letter of Intent:");
  });

  it("includes LOI when the schema exposes it", () => {
    const grant = makeGrant({ loi_required: true });
    const body = composeGrantAwareDraftBody(makeDraft({ section_loi_text: "LOI text" }), grant);
    expect(body).toContain("Letter of Intent:");
    expect(body).toContain("LOI text");
  });
});
