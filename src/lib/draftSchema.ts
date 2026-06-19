import type { DraftFieldSchema, DraftRecord, GrantDraftSchema, GrantRecord } from "./types";

export const DRAFT_SCHEMA_VERSION = 2;

const BASE_SECTIONS: DraftFieldSchema[] = [
  {
    key: "section_org_overview",
    label: "Organization Overview",
    placeholder: "Summarize who the organization is and why it fits this grant.",
    helper: "Use the nonprofit's mission, programs, and service area to show fit.",
    required: true,
    visible: true,
  },
  {
    key: "section_need_statement",
    label: "Need Statement",
    placeholder: "Explain the community need this grant will address.",
    helper: "Tie the problem to the grant's eligibility, categories, and source evidence.",
    required: true,
    visible: true,
  },
  {
    key: "section_project_description",
    label: "Project Description",
    placeholder: "Describe the project activities and who will benefit.",
    helper: "Make the work specific to this opportunity and its funding method.",
    required: true,
    visible: true,
  },
  {
    key: "section_goals_objectives",
    label: "Goals & Objectives",
    placeholder: "List measurable goals and objectives for the project.",
    helper: "Keep the outcome language tied to the grant categories and target population.",
    required: true,
    visible: true,
  },
  {
    key: "section_implementation_plan",
    label: "Implementation Plan",
    placeholder: "Show the timeline and delivery plan.",
    helper: "Break the work into realistic phases that fit the award period.",
    required: true,
    visible: true,
  },
  {
    key: "section_evaluation_plan",
    label: "Evaluation Plan",
    placeholder: "Explain how success will be measured.",
    helper: "Describe data collection, reporting, and how results will drive improvement.",
    required: true,
    visible: true,
  },
  {
    key: "section_budget_narrative",
    label: "Budget Narrative",
    placeholder: "Explain how funds will be used and justified.",
    helper: "Describe proportional allocation across personnel, operations, and direct program costs.",
    required: true,
    visible: true,
  },
  {
    key: "section_sustainability",
    label: "Sustainability",
    placeholder: "Explain how the work will continue after the grant period.",
    helper: "Reference existing programs, partnerships, and funding strategy.",
    required: true,
    visible: true,
  },
  {
    key: "section_org_capacity",
    label: "Organization Capacity",
    placeholder: "Show why the organization can deliver the project.",
    helper: "Tie staff, budget, and programs to the funder's expectations.",
    required: true,
    visible: true,
  },
  {
    key: "section_loi_text",
    label: "Letter of Intent",
    placeholder: "Draft the LOI if this grant requires one.",
    helper: "Only include this when the grant explicitly requires a letter of intent.",
    required: false,
    visible: true,
  },
];

export function resolveGrantDraftSchema(grant: GrantRecord | null): GrantDraftSchema {
  const sourceFamily = normalizeFamily(grant?.source_family);
  const sourceKind = grant?.source_kind ?? "unknown";
  const categories = grant?.categories ?? [];
  const primaryCategory = categories[0] ?? "the target population";
  const matchingFundsRequired = isMatchRequired(grant?.matching_funds);
  const hasLoiSection = Boolean(grant?.loi_required);
  const isWebpageSource = sourceKind === "webpage";
  const sourceFamilyLabel = sourceFamily || "unclassified";

  const sections = BASE_SECTIONS.map((section) => {
    switch (section.key) {
      case "section_org_overview":
        return {
          ...section,
          label: isWebpageSource ? "Organization Fit" : section.label,
          placeholder: `Show why the organization fits ${grant?.title ?? "this grant"}.`,
          helper: `Anchor the narrative to ${grant?.agency_dept ?? "the funder"} and the organization profile.`,
        };
      case "section_need_statement":
        return {
          ...section,
          label: `Need Statement for ${primaryCategory}`,
          placeholder: `Explain the need for ${primaryCategory}.`,
          helper: `Tie the community need to ${grant?.title ?? "the opportunity"} and its eligibility rules.`,
        };
      case "section_project_description":
        return {
          ...section,
          label: isWebpageSource ? "Opportunity Response" : section.label,
          placeholder: `Describe the project activities for ${grant?.title ?? "this grant"}.`,
          helper: `Keep the project grounded in the source evidence and the grant's funding structure.`,
        };
      case "section_goals_objectives":
        return {
          ...section,
          label: `Goals & Objectives for ${primaryCategory}`,
          placeholder: `Write measurable outcomes for ${primaryCategory}.`,
          helper: "Use only goals that connect back to the opportunity's categories.",
        };
      case "section_implementation_plan":
        return {
          ...section,
          helper: `Use the award period and agency timing for ${grant?.agency_dept ?? "the funder"}.`,
        };
      case "section_evaluation_plan":
        return {
          ...section,
          helper: `Describe how ${grant?.title ?? "the project"} will be measured and reported.`,
        };
      case "section_budget_narrative":
        return {
          ...section,
          label: matchingFundsRequired ? "Budget Narrative and Match" : section.label,
          placeholder: matchingFundsRequired
            ? "Explain how grant funds and matching funds will be used."
            : section.placeholder,
          helper: matchingFundsRequired
            ? "Include the match requirement explicitly and show how it will be covered."
            : section.helper,
        };
      case "section_sustainability":
        return {
          ...section,
          helper: `Show how existing programs will sustain the work beyond ${grant?.award_period ?? "the award period"}.`,
        };
      case "section_org_capacity":
        return {
          ...section,
          helper: `Use staffing, budget, and program depth to prove capacity for ${grant?.title ?? "the grant"}.`,
        };
      case "section_loi_text":
        return {
          ...section,
          visible: hasLoiSection,
          required: hasLoiSection,
          helper: hasLoiSection
            ? "This grant requires a letter of intent, so the section stays visible."
            : "Hidden unless the grant requires a letter of intent.",
        };
      default:
        return section;
    }
  }).filter((section) => section.visible);

  const requiredSections = sections.filter((section) => section.required).length;
  const optionalSections = sections.length - requiredSections;
  const schemaName = buildSchemaName(sourceFamilyLabel, sourceKind, hasLoiSection, matchingFundsRequired);

  return {
    schema_id: [
      sourceFamilyLabel,
      sourceKind,
      hasLoiSection ? "loi" : "no-loi",
      matchingFundsRequired ? "match" : "no-match",
    ].join(":"),
    schema_name: schemaName,
    source_family: sourceFamilyLabel,
    source_kind: sourceKind,
    section_count: sections.length,
    required_sections: requiredSections,
    optional_sections: optionalSections,
    has_loi_section: hasLoiSection,
    matching_funds_required: matchingFundsRequired,
    categories,
    sections,
  };
}

export function draftSchemaSummary(schema: GrantDraftSchema) {
  const parts = [
    `${schema.section_count} sections`,
    `${schema.required_sections} required`,
    schema.has_loi_section ? "LOI" : "no LOI",
    schema.matching_funds_required ? "match required" : "no match",
    schema.source_family,
  ];
  return parts.filter(Boolean);
}

export function composeGrantAwareDraftBody(
  draft: DraftRecord,
  grant: GrantRecord | null,
) {
  const schema = resolveGrantDraftSchema(grant);
  const sections = schema.sections
    .map((section) => {
      const value = draft[section.key];
      return typeof value === "string" && value.trim()
        ? `${section.label}:\n${value.trim()}`
        : null;
    })
    .filter((value): value is string => Boolean(value));

  const grantContext = grant
    ? [
        "Grant Context:",
        `Program: ${grant.title}`,
        `Portal ID: ${grant.portal_id}`,
        `Agency: ${grant.agency_dept ?? "not set"}`,
        `Deadline: ${grant.deadline_is_ongoing ? "Ongoing" : grant.application_deadline ?? "not set"}`,
        `Funding: ${grant.est_amounts ?? grant.est_avail_funds ?? "not set"}`,
        `Source: ${grant.source_name ?? grant.source_id ?? "not set"}`,
      ].join("\n")
    : "";

  return [draft.title && `Title: ${draft.title}`, grantContext, ...sections].filter(Boolean).join("\n\n");
}

function normalizeFamily(value: string | null | undefined) {
  const trimmed = value?.trim().toLowerCase();
  return trimmed || "unclassified";
}

function isMatchRequired(value: string | null | undefined) {
  if (!value) return false;
  const lower = value.trim().toLowerCase();
  return (lower.includes("required") || lower.includes("match")) && !lower.includes("not required");
}

function buildSchemaName(sourceFamily: string, sourceKind: string, hasLoiSection: boolean, matchingFundsRequired: boolean) {
  const base = sourceKind === "webpage" ? "webpage grant response" : "grant draft";
  const familyPart = sourceFamily === "unclassified" ? "general" : sourceFamily.replace(/[-_]+/g, " ");
  const suffix = [
    hasLoiSection ? "loi" : null,
    matchingFundsRequired ? "match aware" : null,
  ]
    .filter(Boolean)
    .join(", ");
  return suffix ? `${base} for ${familyPart} (${suffix})` : `${base} for ${familyPart}`;
}
