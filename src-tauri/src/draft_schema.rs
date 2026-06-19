use crate::models::{DraftRecord, GrantRecord, OrganizationProgram, OrganizationRecord};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const DRAFT_SCHEMA_VERSION: u32 = 2;

const BASE_SECTIONS: &[DraftFieldTemplate] = &[
    DraftFieldTemplate {
        key: "section_org_overview",
        label: "Organization Overview",
        placeholder: "Summarize who the organization is and why it fits this grant.",
        helper: "Use the nonprofit's mission, programs, and service area to show fit.",
        required: true,
    },
    DraftFieldTemplate {
        key: "section_need_statement",
        label: "Need Statement",
        placeholder: "Explain the community need this grant will address.",
        helper: "Tie the problem to the grant's eligibility, categories, and source evidence.",
        required: true,
    },
    DraftFieldTemplate {
        key: "section_project_description",
        label: "Project Description",
        placeholder: "Describe the project activities and who will benefit.",
        helper: "Make the work specific to this opportunity and its funding method.",
        required: true,
    },
    DraftFieldTemplate {
        key: "section_goals_objectives",
        label: "Goals & Objectives",
        placeholder: "List measurable goals and objectives for the project.",
        helper: "Keep the outcome language tied to the grant categories and target population.",
        required: true,
    },
    DraftFieldTemplate {
        key: "section_implementation_plan",
        label: "Implementation Plan",
        placeholder: "Show the timeline and delivery plan.",
        helper: "Break the work into realistic phases that fit the award period.",
        required: true,
    },
    DraftFieldTemplate {
        key: "section_evaluation_plan",
        label: "Evaluation Plan",
        placeholder: "Explain how success will be measured.",
        helper: "Describe data collection, reporting, and how results will drive improvement.",
        required: true,
    },
    DraftFieldTemplate {
        key: "section_budget_narrative",
        label: "Budget Narrative",
        placeholder: "Explain how funds will be used and justified.",
        helper: "Describe proportional allocation across personnel, operations, and direct program costs.",
        required: true,
    },
    DraftFieldTemplate {
        key: "section_sustainability",
        label: "Sustainability",
        placeholder: "Explain how the work will continue after the grant period.",
        helper: "Reference existing programs, partnerships, and funding strategy.",
        required: true,
    },
    DraftFieldTemplate {
        key: "section_org_capacity",
        label: "Organization Capacity",
        placeholder: "Show why the organization can deliver the project.",
        helper: "Tie staff, budget, and programs to the funder's expectations.",
        required: true,
    },
    DraftFieldTemplate {
        key: "section_loi_text",
        label: "Letter of Intent",
        placeholder: "Draft the LOI if this grant requires one.",
        helper: "Only include this when the grant explicitly requires a letter of intent.",
        required: false,
    },
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct DraftFieldSchema {
    pub key: String,
    pub label: String,
    pub placeholder: String,
    pub helper: String,
    pub required: bool,
    pub visible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct GrantDraftSchema {
    pub schema_id: String,
    pub schema_name: String,
    pub source_family: String,
    pub source_kind: String,
    pub section_count: usize,
    pub required_sections: usize,
    pub optional_sections: usize,
    pub has_loi_section: bool,
    pub matching_funds_required: bool,
    pub categories: Vec<String>,
    pub sections: Vec<DraftFieldSchema>,
}

#[derive(Debug, Clone)]
struct DraftFieldTemplate {
    key: &'static str,
    label: &'static str,
    placeholder: &'static str,
    helper: &'static str,
    required: bool,
}

pub fn resolve_grant_draft_schema(grant: Option<&GrantRecord>) -> GrantDraftSchema {
    let source_family = normalize_family(grant.and_then(|grant| grant.source_family.as_deref()));
    let source_kind = grant
        .and_then(|grant| grant.source_kind.as_ref())
        .map(source_kind_label)
        .unwrap_or_else(|| "unknown".to_string());
    let categories = grant
        .map(|grant| grant.categories.clone())
        .unwrap_or_default();
    let primary_category = categories
        .first()
        .map(String::as_str)
        .unwrap_or("the target population");
    let matching_funds_required =
        is_match_required(grant.and_then(|grant| grant.matching_funds.as_deref()));
    let has_loi_section = grant.map(|grant| grant.loi_required).unwrap_or(false);
    let is_webpage_source = source_kind == "webpage";
    let source_family_label = if source_family.is_empty() {
        "unclassified".to_string()
    } else {
        source_family.clone()
    };

    let sections: Vec<DraftFieldSchema> = BASE_SECTIONS
        .iter()
        .map(|section| match section.key {
            "section_org_overview" => DraftFieldSchema {
                key: section.key.to_string(),
                label: if is_webpage_source {
                    "Organization Fit".to_string()
                } else {
                    section.label.to_string()
                },
                placeholder: format!(
                    "Show why the organization fits {}.",
                    grant.map(|grant| grant.title.as_str()).unwrap_or("this grant")
                ),
                helper: format!(
                    "Anchor the narrative to {} and the organization profile.",
                    grant
                        .and_then(|grant| grant.agency_dept.as_deref())
                        .unwrap_or("the funder")
                ),
                required: section.required,
                visible: true,
            },
            "section_need_statement" => DraftFieldSchema {
                key: section.key.to_string(),
                label: format!("Need Statement for {}", primary_category),
                placeholder: format!("Explain the need for {}.", primary_category),
                helper: format!(
                    "Tie the community need to {} and its eligibility rules.",
                    grant
                        .map(|grant| grant.title.as_str())
                        .unwrap_or("the opportunity")
                ),
                required: section.required,
                visible: true,
            },
            "section_project_description" => DraftFieldSchema {
                key: section.key.to_string(),
                label: if is_webpage_source {
                    "Opportunity Response".to_string()
                } else {
                    section.label.to_string()
                },
                placeholder: format!(
                    "Describe the project activities for {}.",
                    grant.map(|grant| grant.title.as_str()).unwrap_or("this grant")
                ),
                helper: "Keep the project grounded in the source evidence and the grant's funding structure.".to_string(),
                required: section.required,
                visible: true,
            },
            "section_goals_objectives" => DraftFieldSchema {
                key: section.key.to_string(),
                label: format!("Goals & Objectives for {}", primary_category),
                placeholder: format!("Write measurable outcomes for {}.", primary_category),
                helper: "Use only goals that connect back to the opportunity's categories.".to_string(),
                required: section.required,
                visible: true,
            },
            "section_implementation_plan" => DraftFieldSchema {
                key: section.key.to_string(),
                label: section.label.to_string(),
                placeholder: section.placeholder.to_string(),
                helper: format!(
                    "Use the award period and agency timing for {}.",
                    grant
                        .and_then(|grant| grant.agency_dept.as_deref())
                        .unwrap_or("the funder")
                ),
                required: section.required,
                visible: true,
            },
            "section_evaluation_plan" => DraftFieldSchema {
                key: section.key.to_string(),
                label: section.label.to_string(),
                placeholder: section.placeholder.to_string(),
                helper: format!(
                    "Describe how {} will be measured and reported.",
                    grant.map(|grant| grant.title.as_str()).unwrap_or("the project")
                ),
                required: section.required,
                visible: true,
            },
            "section_budget_narrative" => DraftFieldSchema {
                key: section.key.to_string(),
                label: if matching_funds_required {
                    "Budget Narrative and Match".to_string()
                } else {
                    section.label.to_string()
                },
                placeholder: if matching_funds_required {
                    "Explain how grant funds and matching funds will be used.".to_string()
                } else {
                    section.placeholder.to_string()
                },
                helper: if matching_funds_required {
                    "Include the match requirement explicitly and show how it will be covered.".to_string()
                } else {
                    section.helper.to_string()
                },
                required: section.required,
                visible: true,
            },
            "section_sustainability" => DraftFieldSchema {
                key: section.key.to_string(),
                label: section.label.to_string(),
                placeholder: section.placeholder.to_string(),
                helper: format!(
                    "Show how existing programs will sustain the work beyond {}.",
                    grant
                        .and_then(|grant| grant.award_period.as_deref())
                        .unwrap_or("the award period")
                ),
                required: section.required,
                visible: true,
            },
            "section_org_capacity" => DraftFieldSchema {
                key: section.key.to_string(),
                label: section.label.to_string(),
                placeholder: section.placeholder.to_string(),
                helper: format!(
                    "Use staffing, budget, and program depth to prove capacity for {}.",
                    grant.map(|grant| grant.title.as_str()).unwrap_or("the grant")
                ),
                required: section.required,
                visible: true,
            },
            "section_loi_text" => DraftFieldSchema {
                key: section.key.to_string(),
                label: section.label.to_string(),
                placeholder: section.placeholder.to_string(),
                helper: if has_loi_section {
                    "This grant requires a letter of intent, so the section stays visible.".to_string()
                } else {
                    "Hidden unless the grant requires a letter of intent.".to_string()
                },
                required: has_loi_section,
                visible: has_loi_section,
            },
            _ => DraftFieldSchema {
                key: section.key.to_string(),
                label: section.label.to_string(),
                placeholder: section.placeholder.to_string(),
                helper: section.helper.to_string(),
                required: section.required,
                visible: true,
            },
        })
        .filter(|section| section.visible)
        .collect();

    let required_sections = sections.iter().filter(|section| section.required).count();
    let optional_sections = sections.len().saturating_sub(required_sections);

    GrantDraftSchema {
        schema_id: [
            source_family_label.as_str(),
            source_kind.as_str(),
            if has_loi_section { "loi" } else { "no-loi" },
            if matching_funds_required {
                "match"
            } else {
                "no-match"
            },
        ]
        .join(":"),
        schema_name: build_schema_name(
            &source_family_label,
            &source_kind,
            has_loi_section,
            matching_funds_required,
        ),
        source_family: source_family_label,
        source_kind,
        section_count: sections.len(),
        required_sections,
        optional_sections,
        has_loi_section,
        matching_funds_required,
        categories,
        sections,
    }
}

pub fn draft_schema_summary(schema: &GrantDraftSchema) -> Vec<String> {
    [
        format!("{} sections", schema.section_count),
        format!("{} required", schema.required_sections),
        if schema.has_loi_section {
            "LOI".to_string()
        } else {
            "no LOI".to_string()
        },
        if schema.matching_funds_required {
            "match required".to_string()
        } else {
            "no match".to_string()
        },
        schema.source_family.clone(),
    ]
    .into_iter()
    .filter(|part| !part.trim().is_empty())
    .collect()
}

pub fn compose_grant_aware_draft_body(draft: &DraftRecord, grant: Option<&GrantRecord>) -> String {
    let schema = resolve_grant_draft_schema(grant);
    let sections = schema
        .sections
        .iter()
        .filter_map(|section| {
            let value = match section.key.as_str() {
                "section_org_overview" => draft.section_org_overview.as_deref(),
                "section_need_statement" => draft.section_need_statement.as_deref(),
                "section_project_description" => draft.section_project_description.as_deref(),
                "section_goals_objectives" => draft.section_goals_objectives.as_deref(),
                "section_implementation_plan" => draft.section_implementation_plan.as_deref(),
                "section_evaluation_plan" => draft.section_evaluation_plan.as_deref(),
                "section_budget_narrative" => draft.section_budget_narrative.as_deref(),
                "section_sustainability" => draft.section_sustainability.as_deref(),
                "section_org_capacity" => draft.section_org_capacity.as_deref(),
                "section_loi_text" => draft.section_loi_text.as_deref(),
                _ => None,
            };

            value
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| format!("{}:\n{}", section.label, value))
        })
        .collect::<Vec<_>>();

    let grant_context = grant.map(grant_context_block).unwrap_or_default();

    [
        draft
            .title
            .as_deref()
            .map(|title| format!("Title: {title}")),
        (!grant_context.is_empty()).then_some(grant_context),
    ]
    .into_iter()
    .flatten()
    .chain(sections)
    .collect::<Vec<_>>()
    .join("\n\n")
}

pub fn build_local_draft_scaffold(
    grant: &GrantRecord,
    organization: &OrganizationRecord,
) -> DraftRecord {
    let schema = resolve_grant_draft_schema(Some(grant));
    let now = Utc::now();
    let title = format!("Draft: {}", grant.title);
    let org_name = organization
        .name
        .as_deref()
        .unwrap_or("the organization")
        .trim()
        .to_string();
    let service_area = organization
        .service_area
        .as_deref()
        .unwrap_or("California")
        .trim()
        .to_string();
    let target_population = organization
        .target_population
        .as_deref()
        .unwrap_or("the community")
        .trim()
        .to_string();
    let grant_categories = if grant.categories.is_empty() {
        "not specified".to_string()
    } else {
        grant.categories.join(", ")
    };
    let applicant_types = if grant.applicant_types.is_empty() {
        "not specified".to_string()
    } else {
        grant.applicant_types.join(", ")
    };
    let grant_deadline = if grant.deadline_is_ongoing {
        "ongoing".to_string()
    } else {
        grant
            .application_deadline
            .as_deref()
            .unwrap_or("not specified")
            .to_string()
    };
    let grant_link = grant
        .grant_url
        .as_deref()
        .or(grant.elec_submission_url.as_deref())
        .unwrap_or("not specified")
        .to_string();
    let grant_method = grant
        .funding_method
        .as_deref()
        .unwrap_or("not specified")
        .to_string();
    let grant_source = grant
        .funding_source
        .as_deref()
        .unwrap_or("not specified")
        .to_string();

    let section_org_overview = format!(
        "{org_name} is a community organization serving {service_area}. The organization reports a mission of {} and maintains {} program(s) that support {}. This scaffold is being prepared for the {} opportunity from {} and is tailored to the same live grant metadata used throughout the app.",
        organization.mission.as_deref().unwrap_or("not specified"),
        organization.programs.len(),
        target_population,
        grant.title,
        grant.agency_dept.as_deref().unwrap_or("the funding agency")
    );
    let section_need_statement = format!(
        "This proposal responds to the needs of {target_population} in {service_area} by aligning the grant purpose ({}) with the organization's existing work. The funding categories are {} and the applicant types listed for this opportunity are {}. The summary is generated locally so it can be reviewed and edited before any AI pass is used.",
        grant.purpose.as_deref().unwrap_or("not specified"),
        grant_categories,
        applicant_types
    );
    let section_project_description = format!(
        "The project will pursue the activities described by the grant program '{}', with funding expectations of {}, funding method {}, and delivery within the stated deadline window ({}). The live grant link is {}. The opportunity is administered by {} and the visible contact person is {}.",
        grant.title,
        grant
            .est_amounts
            .as_deref()
            .or(grant.est_avail_funds.as_deref())
            .unwrap_or("not specified"),
        grant_method,
        grant_deadline,
        grant_link,
        grant.agency_dept.as_deref().unwrap_or("the funding agency"),
        grant.contact_name.as_deref().unwrap_or("not specified")
    );
    let section_goals_objectives = format!(
        "Goal 1 is to launch the funded work in a way that directly serves {}. Goal 2 is to document outcomes and improve service delivery across the grant period. These goals are tailored to the {} priorities and categories.",
        target_population,
        grant_categories
    );
    let section_implementation_plan = format!(
        "Month 1 focuses on planning and alignment, months 2-3 cover implementation, and the remaining period covers service delivery, monitoring, and reporting. The plan is structured to fit the {} deadline, the grant's award period of {}, and the topical emphasis implied by {}.",
        grant_deadline,
        grant.award_period.as_deref().unwrap_or("not specified"),
        grant_categories
    );
    let section_evaluation_plan = format!(
        "The organization will track participation, outputs, and outcomes tied to the grant's purpose and use that data to adjust delivery throughout the project. Evaluation will focus on the outcomes implied by {}, {}, and the stated grant deadline of {}.",
        grant_categories,
        grant.purpose.as_deref().unwrap_or("not specified"),
        grant_deadline
    );
    let section_budget_narrative = if schema.matching_funds_required {
        format!(
            "Funds will support direct program delivery, staffing, and basic operations tied to the proposal. Matching funds are required by this grant and should be identified explicitly. Matching funds notes: {}. Funding source: {}. Funding source notes: {}. Funding method notes: {}. Estimated amount range: {}. Available funds: {}. The scaffold assumes the current organization budget and staffing data already captured in RTDB.",
            grant.matching_funds_notes.as_deref().unwrap_or("not specified"),
            grant_source,
            grant.matching_funds_notes.as_deref().unwrap_or("not specified"),
            grant.funding_method_notes.as_deref().unwrap_or("not specified"),
            grant.est_amounts.as_deref().unwrap_or("not specified"),
            grant.est_avail_funds.as_deref().unwrap_or("not specified")
        )
    } else {
        format!(
            "Funds will support direct program delivery, staffing, and basic operations tied to the proposal. Matching funds are described by the grant record as {}. Funding source: {}. Funding source notes: {}. Funding method notes: {}. Estimated amount range: {}. Available funds: {}. The scaffold assumes the current organization budget and staffing data already captured in RTDB.",
            grant.matching_funds.as_deref().unwrap_or("not specified"),
            grant_source,
            grant.matching_funds_notes.as_deref().unwrap_or("not specified"),
            grant.funding_method_notes.as_deref().unwrap_or("not specified"),
            grant.est_amounts.as_deref().unwrap_or("not specified"),
            grant.est_avail_funds.as_deref().unwrap_or("not specified")
        )
    };
    let section_sustainability = format!(
        "The organization expects to continue the work through existing programs, community partnerships, and follow-on funding once the grant period ends. The requested work is designed to outlast the period of performance of {} and remains aligned to the live organization profile in RTDB.",
        grant.award_period.as_deref().unwrap_or("not specified")
    );
    let section_org_capacity = format!(
        "{org_name} reports {} staff, {} volunteers, and an annual budget of ${}. These resources support the organization capacity needed to carry the work forward for a {} application to {}. Contact {} at {} for follow-up coordination.",
        organization.staff_count.unwrap_or_default(),
        organization.volunteer_count.unwrap_or_default(),
        organization.annual_budget.unwrap_or_default(),
        grant.title,
        grant.agency_dept.as_deref().unwrap_or("the funding agency"),
        organization
            .contact_name
            .as_deref()
            .unwrap_or("the organization"),
        organization.contact_email.as_deref().unwrap_or("not specified")
    );
    let section_loi_text = if schema.has_loi_section {
        Some(format!(
            "This local scaffold indicates intent to apply for the {} grant on behalf of {}. The organization serves {} and will pursue this opportunity to expand support for {}. The application deadline is {} and the estimated award information is {}.",
            grant.title,
            org_name,
            service_area,
            target_population,
            grant_deadline,
            grant.est_amounts.as_deref().unwrap_or("not specified")
        ))
    } else {
        None
    };

    let draft_id = format!("local-{}", Uuid::new_v4());
    let mut draft = DraftRecord {
        draft_id,
        grant_portal_id: grant.portal_id.clone(),
        status: "draft".to_string(),
        version: 1,
        section_org_overview: Some(section_org_overview),
        section_need_statement: Some(section_need_statement),
        section_project_description: Some(section_project_description),
        section_goals_objectives: Some(section_goals_objectives),
        section_implementation_plan: Some(section_implementation_plan),
        section_evaluation_plan: Some(section_evaluation_plan),
        section_budget_narrative: Some(section_budget_narrative),
        section_sustainability: Some(section_sustainability),
        section_org_capacity: Some(section_org_capacity),
        section_loi_text,
        ai_model_used: Some("local-scaffold".to_string()),
        ai_prompt_version: Some(crate::ai::DRAFT_PROMPT_VERSION),
        generation_tokens: Some(0),
        user_edited: false,
        generation_mode: crate::models::DraftGenerationMode::LocalScaffold,
        provenance_org_uid: Some(organization.uid.clone()),
        provenance_note: None,
        scaffold_template_version: Some(DRAFT_SCHEMA_VERSION),
        created_at: Some(now),
        updated_at: Some(now),
        title: Some(title),
        body: None,
        notes: None,
    };

    let schema_summary = draft_schema_summary(&schema).join(" • ");
    let provenance_note = format!(
        "Schema-driven local scaffold for {} [{}]",
        grant.title, schema_summary
    );
    draft.provenance_note = Some(provenance_note.clone());
    draft.notes = Some(provenance_note);
    draft.body = Some(compose_grant_aware_draft_body(&draft, Some(grant)));
    draft
}

fn grant_context_block(grant: &GrantRecord) -> String {
    [
        "Grant Context:".to_string(),
        format!("Program: {}", grant.title),
        format!("Portal ID: {}", grant.portal_id),
        format!(
            "Agency: {}",
            grant.agency_dept.as_deref().unwrap_or("not set")
        ),
        format!(
            "Deadline: {}",
            if grant.deadline_is_ongoing {
                "Ongoing".to_string()
            } else {
                grant
                    .application_deadline
                    .as_deref()
                    .unwrap_or("not set")
                    .to_string()
            }
        ),
        format!(
            "Funding: {}",
            grant
                .est_amounts
                .as_deref()
                .or(grant.est_avail_funds.as_deref())
                .unwrap_or("not set")
        ),
        format!(
            "Source: {}",
            grant
                .source_name
                .as_deref()
                .or(grant.source_id.as_deref())
                .unwrap_or("not set")
        ),
    ]
    .join("\n")
}

fn normalize_family(value: Option<&str>) -> String {
    let trimmed = value.unwrap_or_default().trim().to_lowercase();
    if trimmed.is_empty() {
        "unclassified".to_string()
    } else {
        trimmed
    }
}

fn source_kind_label(value: &crate::models::GrantSourceKind) -> String {
    match value {
        crate::models::GrantSourceKind::Csv => "csv".to_string(),
        crate::models::GrantSourceKind::Json => "json".to_string(),
        crate::models::GrantSourceKind::Webpage => "webpage".to_string(),
    }
}

fn is_match_required(value: Option<&str>) -> bool {
    match value {
        Some(value) => {
            let lower = value.trim().to_lowercase();
            (lower.contains("required") || lower.contains("match"))
                && !lower.contains("not required")
        }
        None => false,
    }
}

fn build_schema_name(
    source_family: &str,
    source_kind: &str,
    has_loi_section: bool,
    matching_funds_required: bool,
) -> String {
    let base = if source_kind == "webpage" {
        "webpage grant response"
    } else {
        "grant draft"
    };
    let family_part = if source_family == "unclassified" {
        "general".to_string()
    } else {
        source_family.replace(['-', '_'], " ")
    };
    let suffix = [
        has_loi_section.then_some("loi"),
        matching_funds_required.then_some("match aware"),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(", ");

    if suffix.is_empty() {
        format!("{} for {}", base, family_part)
    } else {
        format!("{} for {} ({})", base, family_part, suffix)
    }
}

pub fn render_programs(programs: &[OrganizationProgram]) -> String {
    if programs.is_empty() {
        return "not specified".to_string();
    }

    programs
        .iter()
        .map(|program| {
            let budget = program
                .budget
                .map(|value| value.to_string())
                .unwrap_or_else(|| "not specified".to_string());
            format!(
                "{} (description: {}, budget: {})",
                program.name,
                not_specified(program.description.as_deref()),
                budget
            )
        })
        .collect::<Vec<_>>()
        .join("; ")
}

pub fn render_list(items: &[String]) -> String {
    if items.is_empty() {
        "not specified".to_string()
    } else {
        items.join(", ")
    }
}

pub fn not_specified(value: Option<&str>) -> String {
    value
        .map(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                "not specified".to_string()
            } else {
                trimmed.to_string()
            }
        })
        .unwrap_or_else(|| "not specified".to_string())
}

pub fn optional_number<T: ToString>(value: Option<T>) -> String {
    value
        .map(|value| value.to_string())
        .unwrap_or_else(|| "not specified".to_string())
}

pub fn prompt_required_match_language(matching_funds_required: bool) -> &'static str {
    if matching_funds_required {
        "Also explain the source and nature of matching funds the organization will contribute."
    } else {
        ""
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_grant() -> GrantRecord {
        GrantRecord {
            portal_id: "123".to_string(),
            title: "Community Health Grant".to_string(),
            agency_dept: Some("Health Department".to_string()),
            grant_type: None,
            loi_required: true,
            categories: vec!["health".to_string()],
            matching_funds: Some("Matching funds required".to_string()),
            source_family: Some("California Grants Portal".to_string()),
            source_kind: Some(crate::models::GrantSourceKind::Webpage),
            award_period: Some("12 months".to_string()),
            grant_url: Some("https://example.com/grant".to_string()),
            ..Default::default()
        }
    }

    fn sample_org() -> OrganizationRecord {
        OrganizationRecord {
            uid: "org-1".to_string(),
            name: Some("Example Nonprofit".to_string()),
            mission: Some("Serve the community".to_string()),
            service_area: Some("California".to_string()),
            target_population: Some("families".to_string()),
            staff_count: Some(4),
            volunteer_count: Some(10),
            annual_budget: Some(250000),
            contact_name: Some("Pat Director".to_string()),
            contact_email: Some("pat@example.org".to_string()),
            programs: vec![crate::models::OrganizationProgram {
                name: "Program A".to_string(),
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    #[test]
    fn schema_hides_loi_only_when_not_required() {
        let schema = resolve_grant_draft_schema(Some(&sample_grant()));
        assert!(schema.has_loi_section);
        assert!(schema
            .sections
            .iter()
            .any(|section| section.key == "section_loi_text"));
        assert!(schema
            .sections
            .iter()
            .any(|section| section.label == "Budget Narrative and Match"));
    }

    #[test]
    fn local_scaffold_uses_schema_driven_body() {
        let grant = sample_grant();
        let org = sample_org();
        let draft = build_local_draft_scaffold(&grant, &org);

        let body = draft.body.expect("draft body");
        assert!(body.contains("Grant Context:"));
        assert!(body.contains("Organization Fit"));
        assert!(body.contains("Budget Narrative and Match"));
        assert!(draft
            .provenance_note
            .as_deref()
            .unwrap_or_default()
            .contains("Schema-driven local scaffold"));
    }
}
