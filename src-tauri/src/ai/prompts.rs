use crate::{
    draft_schema,
    models::{GrantRecord, OrganizationRecord},
};

pub const DRAFT_PROMPT_VERSION: u32 = 2;
pub const DRAFT_MODEL: &str = "claude-sonnet-4-6";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DraftPromptBundle {
    pub system_prompt: String,
    pub section_org_overview: String,
    pub section_need_statement: String,
    pub section_project_description: String,
    pub section_goals_objectives: String,
    pub section_implementation_plan: String,
    pub section_evaluation_plan: String,
    pub section_budget_narrative: String,
    pub section_sustainability: String,
    pub section_org_capacity: String,
    pub section_loi_text: Option<String>,
}

pub fn build_draft_prompt_bundle(
    grant: &GrantRecord,
    org: &OrganizationRecord,
) -> DraftPromptBundle {
    let system_prompt = "You are an expert nonprofit grant writer with 15 years of experience winning California state grant applications. You write clearly, specifically, and persuasively. You always tie the organization's work directly to the funder's stated priorities and the source evidence provided for this exact grant. You must write each section as if it will be submitted to the named organization by the named funder. Do not produce a generic template. Ground every section in the specific funder priorities, grant source excerpts, applicant notes, and the organization's actual programs. You write in professional prose - no headers, no bullet points, no markdown formatting of any kind. Each section is a self-contained paragraph or set of paragraphs.".to_string();
    let schema = draft_schema::resolve_grant_draft_schema(Some(grant));

    let org_name = draft_schema::not_specified(org.name.as_deref());
    let grant_title = draft_schema::not_specified(Some(&grant.title));
    let funder = draft_schema::not_specified(grant.agency_dept.as_deref());
    let purpose = draft_schema::not_specified(grant.purpose.as_deref());
    let description = draft_schema::not_specified(grant.description.as_deref());
    let source_excerpt = draft_schema::not_specified(grant.source_excerpt.as_deref());
    let source_highlights = draft_schema::render_list(&grant.source_highlights);
    let applicant_type_notes = draft_schema::not_specified(grant.applicant_type_notes.as_deref());
    let programs = draft_schema::render_programs(&org.programs);
    let matching_funds = draft_schema::not_specified(grant.matching_funds.as_deref());
    let matching_notes = draft_schema::not_specified(grant.matching_funds_notes.as_deref());
    let prompt_budget_amounts = draft_schema::not_specified(grant.est_amounts.as_deref());
    let award_period = draft_schema::not_specified(grant.award_period.as_deref());
    let geography = draft_schema::not_specified(grant.geography.as_deref());
    let categories = draft_schema::render_list(&grant.categories);
    let applicant_types = draft_schema::render_list(&grant.applicant_types);
    let funding_method = draft_schema::not_specified(grant.funding_method.as_deref());
    let funding_method_notes = draft_schema::not_specified(grant.funding_method_notes.as_deref());
    let org_overview_focus = format!(
        "Use the source excerpt and highlights to prove why {org_name} is a fit for {grant_title} from {funder}. Do not summarize the organization in general terms; connect mission, programs, and service area to this exact opportunity."
    );
    let need_statement_focus = format!(
        "Tie the community need to the grant's applicant guidance, eligible geography, and source highlights. Show why this organization is a credible applicant for {grant_title}."
    );
    let project_description_focus = format!(
        "Make the work plan specific to {grant_title}: cite the funder, funding method, source evidence, and the organization's named programs. If reimbursement is involved, reflect that operationally."
    );
    let goals_focus = format!(
        "Every goal should map to the grant categories and produce an outcome that responds to the source highlights. Keep the outcome language specific to the organization's target population."
    );
    let implementation_focus = format!(
        "Align the timeline to the period of performance and the funding method. Break the work into realistic phases that the named staff and programs can actually deliver."
    );
    let evaluation_focus = format!(
        "Measure outcomes that directly reflect the grant purpose and source evidence. Use reporting and data collection that fit the organization's actual programs."
    );
    let sustainability_focus = format!(
        "Show how existing programs, mission, and funding strategy will carry the work after the grant ends. Reference the funder context instead of writing a generic continuity paragraph."
    );
    let capacity_focus = format!(
        "Prove capacity for this exact grant by tying staff, budget, and programs to the funder's priorities and applicant expectations."
    );
    let required_match_language =
        draft_schema::prompt_required_match_language(schema.matching_funds_required);

    let section_org_overview = format!(
        "Grant Program: {grant_title}\nFunder: {funder}\nGrant Purpose: {purpose}\nSource Excerpt: {source_excerpt}\nSource Highlights: {source_highlights}\nApplicant Type Notes: {applicant_type_notes}\n\nWrite a compelling organizational overview for a grant application to the above program. Use only these facts:\n\nOrganization: {org_name}\nEIN: {}\nTax Status: {}\nFounded: {}\nMission: {}\nAnnual Budget: ${}\nStaff: {} staff, {} volunteers\nService Area: {}\nTarget Population: {}\nPrograms: {programs}\n\nWrite 2-3 focused paragraphs emphasizing how the organization's track record aligns with the funder's stated purpose. Reference the grant title and agency explicitly, keep the language tied to this specific opportunity rather than a generic organizational summary, and follow this instruction closely: {org_overview_focus}",
        draft_schema::not_specified(org.ein.as_deref()),
        draft_schema::not_specified(org.irc_status.as_deref()),
        draft_schema::optional_number(org.founded_year),
        draft_schema::not_specified(org.mission.as_deref()),
        draft_schema::optional_number(org.annual_budget.map(|value| value as i128)),
        draft_schema::optional_number(org.staff_count.map(|value| value as i128)),
        draft_schema::optional_number(org.volunteer_count.map(|value| value as i128)),
        draft_schema::not_specified(org.service_area.as_deref()),
        draft_schema::not_specified(org.target_population.as_deref()),
    );

    let section_need_statement = format!(
        "Grant Program: {grant_title}\nGrant Purpose: {purpose}\nGrant Categories: {categories}\nEligible Geography: {geography}\nApplicant Types: {applicant_types}\nApplicant Type Notes: {applicant_type_notes}\nSource Excerpt: {source_excerpt}\nSource Highlights: {source_highlights}\n\nWrite a compelling need statement establishing the documented problem in the community, why the target population is underserved, and how this connects directly to the funder's stated categories and purpose. Anchor the argument to the grant's source evidence and applicant guidance so it reads as an application for this exact opportunity. Follow this instruction closely: {need_statement_focus}\n\nOrganization: {org_name}\nTarget Population: {}\nService Area: {}\nMission: {}",
        draft_schema::not_specified(org.target_population.as_deref()),
        draft_schema::not_specified(org.service_area.as_deref()),
        draft_schema::not_specified(org.mission.as_deref()),
    );

    let section_project_description = format!(
        "Grant Program: {grant_title}\nFunder: {funder}\nGrant Purpose: {purpose}\nGrant Description: {description}\nFunding Amount Range: {prompt_budget_amounts}\nPeriod of Performance: {award_period}\nFunding Method: {funding_method}\nFunding Method Notes: {funding_method_notes}\nSource Excerpt: {source_excerpt}\nSource Highlights: {source_highlights}\n\nWrite a project description section describing specifically what activities will be funded, how they align with the funder's priorities, and who will benefit. All described activities must be completable within the period of performance. Reference the grant title and agency explicitly, and make the narrative specific to this opportunity rather than a reusable template. Follow this instruction closely: {project_description_focus}\n\nOrganization: {org_name}\nPrograms: {programs}\nTarget Population: {}\nService Area: {}",
        draft_schema::not_specified(org.target_population.as_deref()),
        draft_schema::not_specified(org.service_area.as_deref()),
    );

    let section_goals_objectives = format!(
        "Grant Program: {grant_title}\nGrant Categories: {categories}\nPeriod of Performance: {award_period}\n\nWrite a goals and objectives section. Frame 2-3 goals, each with 2 measurable objectives achievable within the performance period. Connect each goal to the funder's categories. Write in flowing professional prose - no numbered lists, no bullet points. Follow this instruction closely: {goals_focus}\n\nOrganization Programs: {programs}\nTarget Population: {}",
        draft_schema::not_specified(org.target_population.as_deref()),
    );

    let section_implementation_plan = format!(
        "Grant Program: {grant_title}\nPeriod of Performance: {award_period}\n\nWrite a realistic implementation plan with phases referencing specific timeframes (Quarter 1, Month 1-3, etc.) that fit within the period of performance. Include: planning phase, service delivery, and evaluation. Write in professional prose, no headers or bullets. Follow this instruction closely: {implementation_focus}\n\nOrganization: {org_name}\nStaff: {}\nPrograms: {programs}",
        draft_schema::optional_number(org.staff_count.map(|value| value as i128)),
    );

    let section_evaluation_plan = format!(
        "Grant Program: {grant_title}\nGrant Categories: {categories}\n\nWrite an evaluation plan describing how {org_name} will measure the success of this grant-funded project. Include: data collection methods, reporting frequency, and how results drive improvement. Reference target population: {}. Write in professional prose, no bullets. Follow this instruction closely: {evaluation_focus}",
        draft_schema::not_specified(org.target_population.as_deref()),
    );

    let section_budget_narrative = format!(
        "Grant Program: {grant_title}\nFunding Amount Range: {prompt_budget_amounts}\nFunding Method: {funding_method}\nFunding Method Notes: {funding_method_notes}\nMatching Funds Required: {matching_funds}\nMatching Funds Notes: {matching_notes}\nSource Excerpt: {source_excerpt}\nSource Highlights: {source_highlights}\n\nWrite a budget narrative describing how grant funds will be allocated across personnel, operations, and direct program costs. Describe proportional allocation and justification - do not provide specific dollar amounts.\n{required_match_language}\nOrganization Annual Budget: ${}\nStaff: {}\nPrograms: {programs}",
        draft_schema::optional_number(org.annual_budget.map(|value| value as i128)),
        draft_schema::optional_number(org.staff_count.map(|value| value as i128)),
    );

    let section_sustainability = format!(
        "Grant Program: {grant_title}\nPeriod of Performance: {award_period}\n\nWrite a sustainability section explaining how {org_name} will continue this work after the grant period ends. Reference: existing programs ({programs}), annual budget (${budget}), and mission ({mission}). Follow this instruction closely: {sustainability_focus}",
        budget = draft_schema::optional_number(org.annual_budget.map(|value| value as i128)),
        mission = draft_schema::not_specified(org.mission.as_deref()),
    );

    let section_org_capacity = format!(
        "Grant Program: {grant_title}\nFunder: {funder}\n\nWrite an organizational capacity section demonstrating that {org_name} has the infrastructure, staff, and experience to successfully implement this grant.\n\nStaff: {} staff, {} volunteers\nFounded: {}\nAnnual Budget: ${}\nPrograms: {programs}\nTax Status: {}\n\nFollow this instruction closely: {capacity_focus}",
        draft_schema::optional_number(org.staff_count.map(|value| value as i128)),
        draft_schema::optional_number(org.volunteer_count.map(|value| value as i128)),
        draft_schema::optional_number(org.founded_year),
        draft_schema::optional_number(org.annual_budget.map(|value| value as i128)),
        draft_schema::not_specified(org.irc_status.as_deref()),
    );

    let section_loi_text = if grant.loi_required {
        Some(format!(
            "Grant Program: {grant_title}\nFunder: {funder}\nGrant Purpose: {purpose}\nApplication Deadline: {}\n\nWrite a formal Letter of Intent for this grant program on behalf of {org_name} (EIN: {}). The letter must:\n1. State intent to apply by the deadline\n2. Briefly describe the organization (mission, tax status, budget)\n3. Describe the proposed project in 2-3 sentences\n4. Confirm geographic eligibility: {geography}\n5. Provide contact: {}, {}\n\nFormat as a formal business letter in professional prose. No headers, no bullets.",
            draft_schema::not_specified(grant.application_deadline.as_deref()),
            draft_schema::not_specified(org.ein.as_deref()),
            draft_schema::not_specified(org.contact_name.as_deref()),
            draft_schema::not_specified(org.contact_email.as_deref()),
        ))
    } else {
        None
    };

    DraftPromptBundle {
        system_prompt,
        section_org_overview,
        section_need_statement,
        section_project_description,
        section_goals_objectives,
        section_implementation_plan,
        section_evaluation_plan,
        section_budget_narrative,
        section_sustainability,
        section_org_capacity,
        section_loi_text,
    }
}

pub fn missing_org_fields_for_generation(org: &OrganizationRecord) -> Vec<String> {
    let mut missing = Vec::new();
    if missing_text(org.name.as_deref()) {
        missing.push("name".to_string());
    }
    if missing_text(org.ein.as_deref()) {
        missing.push("ein".to_string());
    }
    if missing_text(org.irc_status.as_deref()) {
        missing.push("irc_status".to_string());
    }
    if missing_text(org.mission.as_deref()) {
        missing.push("mission".to_string());
    }
    if missing_text(org.target_population.as_deref()) {
        missing.push("target_population".to_string());
    }
    if missing_text(org.service_area.as_deref()) {
        missing.push("service_area".to_string());
    }
    if org.annual_budget.is_none() {
        missing.push("annual_budget".to_string());
    }
    if org.programs.is_empty() {
        missing.push("programs".to_string());
    }
    if missing_text(org.contact_name.as_deref()) {
        missing.push("contact_name".to_string());
    }
    if missing_text(org.contact_email.as_deref()) {
        missing.push("contact_email".to_string());
    }
    missing
}

pub fn missing_grant_fields_for_generation(grant: &GrantRecord) -> Vec<String> {
    let mut missing = Vec::new();
    if missing_text(Some(&grant.title)) {
        missing.push("title".to_string());
    }
    if missing_text(grant.agency_dept.as_deref()) {
        missing.push("agency_dept".to_string());
    }
    if missing_text(grant.purpose.as_deref()) {
        missing.push("purpose".to_string());
    }
    if missing_text(grant.description.as_deref()) {
        missing.push("description".to_string());
    }
    if grant.applicant_types.is_empty() {
        missing.push("applicant_types".to_string());
    }
    if missing_text(grant.geography.as_deref()) {
        missing.push("geography".to_string());
    }
    if grant.categories.is_empty() {
        missing.push("categories".to_string());
    }
    if missing_text(grant.funding_source.as_deref()) {
        missing.push("funding_source".to_string());
    }
    if missing_text(grant.matching_funds.as_deref()) {
        missing.push("matching_funds".to_string());
    }
    if missing_text(grant.funding_method.as_deref()) {
        missing.push("funding_method".to_string());
    }
    if missing_text(grant.application_deadline.as_deref()) && !grant.deadline_is_ongoing {
        missing.push("application_deadline".to_string());
    }
    if missing_text(grant.award_period.as_deref()) {
        missing.push("award_period".to_string());
    }
    if grant.loi_required && missing_text(grant.application_deadline.as_deref()) {
        missing.push("application_deadline".to_string());
    }
    missing
}

fn missing_text(value: Option<&str>) -> bool {
    value.map(|value| value.trim().is_empty()).unwrap_or(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::OrganizationProgram;

    fn full_grant() -> GrantRecord {
        GrantRecord {
            portal_id: "1".into(),
            title: "Education Grant".into(),
            agency_dept: Some("CA Dept of Education".into()),
            purpose: Some("Support K-12 programs".into()),
            description: Some("Full description of the grant.".into()),
            source_excerpt: Some(
                "This program supports organizations delivering youth education services.".into(),
            ),
            source_highlights: vec![
                "Priority for organizations serving low-income communities".into(),
                "Reimbursement-only funding method".into(),
            ],
            applicant_types: vec!["Nonprofit".into(), "Public Agency".into()],
            applicant_type_notes: Some(
                "Eligible applicants include 501(c)(3) nonprofits and public agencies.".into(),
            ),
            geography: Some("California".into()),
            categories: vec!["Education".into(), "Youth".into()],
            funding_source: Some("State".into()),
            matching_funds: Some("Required".into()),
            matching_funds_notes: Some("Must show 25% match".into()),
            funding_method: Some("Reimbursement".into()),
            funding_method_notes: Some("Reimbursement after quarterly reporting.".into()),
            application_deadline: Some("2026-08-14".into()),
            award_period: Some("2026-2027".into()),
            est_amounts: Some("$50,000 – $250,000".into()),
            loi_required: true,
            ..Default::default()
        }
    }

    fn full_org() -> OrganizationRecord {
        OrganizationRecord {
            uid: "uid".into(),
            name: Some("Community Partners".into()),
            ein: Some("12-3456789".into()),
            irc_status: Some("501(c)(3)".into()),
            mission: Some("Empower underserved youth.".into()),
            target_population: Some("At-risk youth ages 12-18".into()),
            service_area: Some("Los Angeles County".into()),
            annual_budget: Some(750_000),
            staff_count: Some(12),
            volunteer_count: Some(45),
            founded_year: Some(2005),
            programs: vec![
                OrganizationProgram {
                    name: "After School Program".into(),
                    description: Some("Tutoring and mentorship".into()),
                    budget: Some(200_000),
                },
                OrganizationProgram {
                    name: "Summer Camp".into(),
                    description: None,
                    budget: None,
                },
            ],
            contact_name: Some("Alice Smith".into()),
            contact_email: Some("alice@communitypartners.org".into()),
            ..Default::default()
        }
    }

    #[test]
    fn missing_org_fields_follow_spec() {
        let org = OrganizationRecord::default();
        let missing = missing_org_fields_for_generation(&org);
        assert!(missing.contains(&"name".to_string()));
        assert!(missing.contains(&"programs".to_string()));
    }

    #[test]
    fn missing_org_fields_detects_all_blank_fields() {
        let org = OrganizationRecord::default();
        let missing = missing_org_fields_for_generation(&org);
        for field in &[
            "name",
            "ein",
            "irc_status",
            "mission",
            "target_population",
            "service_area",
            "annual_budget",
            "programs",
            "contact_name",
            "contact_email",
        ] {
            assert!(
                missing.contains(&field.to_string()),
                "expected '{field}' in missing fields"
            );
        }
    }

    #[test]
    fn missing_org_fields_empty_when_all_provided() {
        let missing = missing_org_fields_for_generation(&full_org());
        assert!(
            missing.is_empty(),
            "expected no missing fields but got: {missing:?}"
        );
    }

    #[test]
    fn missing_grant_fields_detects_all_blank() {
        let grant = GrantRecord {
            portal_id: "1".into(),
            title: "".into(),
            ..Default::default()
        };
        let missing = missing_grant_fields_for_generation(&grant);
        assert!(missing.contains(&"title".to_string()));
        assert!(missing.contains(&"agency_dept".to_string()));
        assert!(missing.contains(&"purpose".to_string()));
    }

    #[test]
    fn missing_grant_fields_ongoing_deadline_skips_deadline_check() {
        let grant = GrantRecord {
            portal_id: "1".into(),
            title: "T".into(),
            agency_dept: Some("A".into()),
            purpose: Some("P".into()),
            description: Some("D".into()),
            applicant_types: vec!["Nonprofit".into()],
            geography: Some("CA".into()),
            categories: vec!["Education".into()],
            funding_source: Some("State".into()),
            matching_funds: Some("Not required".into()),
            funding_method: Some("Grant".into()),
            award_period: Some("2026".into()),
            deadline_is_ongoing: true,
            application_deadline: None,
            loi_required: false,
            ..Default::default()
        };
        let missing = missing_grant_fields_for_generation(&grant);
        assert!(
            !missing.contains(&"application_deadline".to_string()),
            "ongoing deadline should not flag application_deadline as missing"
        );
    }

    #[test]
    fn bundle_includes_loi_when_required() {
        let bundle = build_draft_prompt_bundle(&full_grant(), &full_org());
        assert!(bundle.section_loi_text.is_some());
        assert!(bundle.section_budget_narrative.contains("matching funds"));
    }

    #[test]
    fn bundle_excludes_loi_when_not_required() {
        let mut grant = full_grant();
        grant.loi_required = false;
        let bundle = build_draft_prompt_bundle(&grant, &full_org());
        assert!(bundle.section_loi_text.is_none());
    }

    #[test]
    fn bundle_contains_org_name_in_multiple_sections() {
        let bundle = build_draft_prompt_bundle(&full_grant(), &full_org());
        assert!(bundle.section_org_overview.contains("Community Partners"));
        assert!(bundle.section_sustainability.contains("Community Partners"));
        assert!(bundle.section_org_capacity.contains("Community Partners"));
    }

    #[test]
    fn bundle_contains_grant_title_in_all_sections() {
        let bundle = build_draft_prompt_bundle(&full_grant(), &full_org());
        let title = "Education Grant";
        assert!(bundle.section_org_overview.contains(title));
        assert!(bundle.section_need_statement.contains(title));
        assert!(bundle.section_project_description.contains(title));
        assert!(bundle.section_goals_objectives.contains(title));
        assert!(bundle.section_implementation_plan.contains(title));
        assert!(bundle.section_evaluation_plan.contains(title));
        assert!(bundle.section_budget_narrative.contains(title));
        assert!(bundle.section_sustainability.contains(title));
        assert!(bundle.section_org_capacity.contains(title));
    }

    #[test]
    fn prompt_version_reflects_section_specific_tightening() {
        assert_eq!(DRAFT_PROMPT_VERSION, 2);
    }

    #[test]
    fn bundle_grounds_sections_in_source_evidence() {
        let bundle = build_draft_prompt_bundle(&full_grant(), &full_org());
        assert!(bundle
            .section_org_overview
            .contains("This program supports organizations delivering youth education services."));
        assert!(bundle
            .section_need_statement
            .contains("Priority for organizations serving low-income communities"));
        assert!(bundle
            .section_need_statement
            .contains("Eligible applicants include 501(c)(3) nonprofits and public agencies."));
        assert!(bundle
            .section_project_description
            .contains("Reimbursement after quarterly reporting."));
        assert!(bundle
            .section_budget_narrative
            .contains("Reimbursement after quarterly reporting."));
        assert!(bundle
            .section_project_description
            .contains("Reference the grant title and agency explicitly"));
    }

    #[test]
    fn bundle_threads_section_specific_focus_into_all_sections() {
        let bundle = build_draft_prompt_bundle(&full_grant(), &full_org());
        assert!(bundle
            .section_org_overview
            .contains("Use the source excerpt and highlights"));
        assert!(bundle
            .section_need_statement
            .contains("Tie the community need"));
        assert!(bundle
            .section_project_description
            .contains("Make the work plan specific"));
        assert!(bundle
            .section_goals_objectives
            .contains("Every goal should map"));
        assert!(bundle
            .section_implementation_plan
            .contains("Align the timeline"));
        assert!(bundle.section_evaluation_plan.contains("Measure outcomes"));
        assert!(bundle
            .section_sustainability
            .contains("Show how existing programs"));
        assert!(bundle.section_org_capacity.contains("Prove capacity"));
    }

    #[test]
    fn bundle_includes_required_match_language_when_matching_required() {
        let bundle = build_draft_prompt_bundle(&full_grant(), &full_org());
        assert!(
            bundle.section_budget_narrative.contains("matching funds"),
            "required matching funds note should appear in budget narrative"
        );
    }

    #[test]
    fn bundle_no_required_match_language_when_not_required() {
        let mut grant = full_grant();
        grant.matching_funds = Some("Not Required".into());
        let bundle = build_draft_prompt_bundle(&grant, &full_org());
        assert!(
            !bundle
                .section_budget_narrative
                .contains("Also explain the source"),
            "no matching-funds prompt when not required"
        );
    }

    #[test]
    fn bundle_loi_contains_contact_info() {
        let bundle = build_draft_prompt_bundle(&full_grant(), &full_org());
        let loi = bundle.section_loi_text.unwrap();
        assert!(loi.contains("Alice Smith"));
        assert!(loi.contains("alice@communitypartners.org"));
    }

    #[test]
    fn render_programs_multiple_programs_semicolon_joined() {
        let org = full_org();
        let bundle = build_draft_prompt_bundle(&full_grant(), &org);
        // Both program names should appear in at least one section
        assert!(
            bundle.section_org_overview.contains("After School Program"),
            "first program appears in org overview"
        );
        assert!(
            bundle.section_org_overview.contains("Summer Camp"),
            "second program appears in org overview"
        );
    }

    #[test]
    fn bundle_with_empty_programs_shows_not_specified() {
        let mut org = full_org();
        org.programs = vec![];
        let bundle = build_draft_prompt_bundle(&full_grant(), &org);
        assert!(bundle.section_org_overview.contains("not specified"));
    }

    // ── security boundary ──────────────────────────────────────────────────

    #[test]
    fn bundle_with_xss_in_org_name_preserves_literal_value() {
        let mut org = full_org();
        org.name = Some("<script>alert(1)</script>".into());
        let bundle = build_draft_prompt_bundle(&full_grant(), &org);
        // The XSS string should be embedded literally, not evaluated or stripped
        assert!(bundle
            .section_org_overview
            .contains("<script>alert(1)</script>"));
    }

    #[test]
    fn bundle_with_sql_injection_in_grant_title_preserves_literal_value() {
        let mut grant = full_grant();
        grant.title = "'; DROP TABLE grants; --".into();
        let bundle = build_draft_prompt_bundle(&grant, &full_org());
        assert!(bundle
            .section_org_overview
            .contains("'; DROP TABLE grants; --"));
    }

    #[test]
    fn bundle_with_very_long_org_description_does_not_panic() {
        let mut org = full_org();
        org.mission = Some("A".repeat(100_000));
        // Should not panic or OOM
        let bundle = build_draft_prompt_bundle(&full_grant(), &org);
        assert!(bundle.section_org_overview.len() > 100_000);
    }

    // ── performance ───────────────────────────────────────────────────────

    #[test]
    fn build_draft_prompt_bundle_is_fast() {
        let grant = full_grant();
        let org = full_org();
        let start = std::time::Instant::now();
        for _ in 0..10_000 {
            let _ = build_draft_prompt_bundle(&grant, &org);
        }
        assert!(
            start.elapsed().as_millis() < 1000,
            "10k bundle builds should complete in under 1s"
        );
    }
}
