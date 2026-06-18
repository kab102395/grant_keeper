use crate::{
    models::{GrantSourceKind, GrantSourceRecord},
    source_adapters::supports_rich_webpage_extraction,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WebpageAdapterKind {
    Generic,
    CaliforniaGrantsPortal,
    CoastalConservancy,
    CalFire,
    Hcd,
    Cdfa,
    Cdfw,
    Carb,
    Calepa,
    CalOes,
    Cnra,
    ArtsCouncil,
    CalOSBA,
}

#[derive(Debug, Clone, Copy)]
pub struct WebpageAdapterSpec {
    pub kind: WebpageAdapterKind,
    pub opportunity_terms: &'static [&'static str],
    pub noise_terms: &'static [&'static str],
    pub link_selectors: &'static [&'static str],
    pub highlight_selectors: &'static [&'static str],
    pub category_hints: &'static [(&'static str, &'static str)],
    pub supports_rich_sections: bool,
}

pub fn spec_for_source(source: &GrantSourceRecord) -> WebpageAdapterSpec {
    let kind = kind_for_source(source);
    let base = match kind {
        WebpageAdapterKind::CaliforniaGrantsPortal => WebpageAdapterSpec {
            kind,
            opportunity_terms: &[
                "show me the opportunities",
                "recently posted",
                "find grants",
                "grant opportunities",
                "funding notices",
                "application deadline",
            ],
            noise_terms: &["subscribe", "news", "glossary", "faq", "statistics dashboard"],
            link_selectors: &[
                "main a",
                "main li a",
                "article a",
                "section a",
                "main h2 a",
                "main h3 a",
            ],
            highlight_selectors: &[
                "main h2",
                "main h3",
                "main li",
                "article h2",
                "article h3",
                "article li",
                "section h2",
                "section h3",
                "section li",
            ],
            category_hints: &[
                ("disadvantaged communities", "Disadvantaged Communities"),
                ("housing", "Housing, Community and Economic Development"),
                ("environment", "Environment & Water"),
                ("water", "Environment & Water"),
                ("education", "Education"),
                ("health", "Health & Human Services"),
                ("arts", "Libraries and Arts"),
                ("wildfire", "Disaster Prevention & Relief"),
            ],
            supports_rich_sections: true,
        },
        WebpageAdapterKind::CoastalConservancy => WebpageAdapterSpec {
            kind,
            opportunity_terms: &[
                "proposition 1 grants",
                "proposal solicitation",
                "request for partnership proposals",
                "letter of interest",
                "grant program",
                "funding available",
            ],
            noise_terms: &["news", "staff directory", "project viewer", "meetings", "notices"],
            link_selectors: &[
                "main a",
                "main li a",
                "article a",
                "section a",
                "main h2 a",
                "main h3 a",
                "main p a",
            ],
            highlight_selectors: &[
                "main h2",
                "main h3",
                "main p",
                "article h2",
                "article h3",
                "article p",
                "section h2",
                "section h3",
                "section p",
                "main li",
                "article li",
            ],
            category_hints: &[
                ("watershed", "Environment & Water"),
                ("coast", "Environment & Water"),
                ("wetland", "Environment & Water"),
                ("restoration", "Environment & Water"),
                ("public access", "Parks & Recreation"),
                ("green", "Environment & Water"),
            ],
            supports_rich_sections: true,
        },
        WebpageAdapterKind::CalFire => WebpageAdapterSpec {
            kind,
            opportunity_terms: &[
                "grant guidelines",
                "grant forms",
                "solicitation",
                "funding",
                "application list",
                "recipient list",
            ],
            noise_terms: &["tutorial", "video", "press release", "youtube"],
            link_selectors: &[
                "main a",
                "main li a",
                "main p a",
                "article a",
                "section a",
                "table a",
            ],
            highlight_selectors: &[
                "main h2",
                "main h3",
                "main p",
                "main li",
                "article h2",
                "article h3",
                "article p",
                "article li",
                "section h2",
                "section h3",
                "section p",
                "table tr",
            ],
            category_hints: &[
                ("wildfire", "Disaster Prevention & Relief"),
                ("forest", "Environment & Water"),
                ("defensible space", "Disaster Prevention & Relief"),
                ("suppression", "Disaster Prevention & Relief"),
            ],
            supports_rich_sections: true,
        },
        WebpageAdapterKind::Hcd => WebpageAdapterSpec {
            kind,
            opportunity_terms: &[
                "nofa calendar",
                "grant and funding",
                "programs: state",
                "programs: federal",
                "super nofa",
                "grant program",
            ],
            noise_terms: &["archive", "reporting and compliance", "income limits"],
            link_selectors: &[
                "main a",
                "main li a",
                "main p a",
                "article a",
                "section a",
                "table a",
            ],
            highlight_selectors: &[
                "main h2",
                "main h3",
                "main p",
                "main li",
                "article h2",
                "article h3",
                "article p",
                "article li",
                "section h2",
                "section h3",
                "section p",
                "table tr",
            ],
            category_hints: &[
                ("housing", "Housing, Community and Economic Development"),
                ("homeless", "Housing, Community and Economic Development"),
                ("community development", "Housing, Community and Economic Development"),
                ("tribal", "Housing, Community and Economic Development"),
            ],
            supports_rich_sections: true,
        },
        WebpageAdapterKind::Cdfa => WebpageAdapterSpec {
            kind,
            opportunity_terms: &[
                "open application",
                "upcoming cdaf grant application periods",
                "catalogue of grant programs",
                "grant programs",
                "application open",
                "concept proposals due",
            ],
            noise_terms: &["create an account", "goats", "grant opportunity and administration and tracking system"],
            link_selectors: &[
                "main a",
                "main li a",
                "main p a",
                "article a",
                "section a",
                "table a",
            ],
            highlight_selectors: &[
                "main h2",
                "main h3",
                "main p",
                "main li",
                "article h2",
                "article h3",
                "article p",
                "article li",
                "section h2",
                "section h3",
                "section p",
                "table tr",
            ],
            category_hints: &[
                ("agriculture", "Agriculture"),
                ("food", "Food & Nutrition"),
                ("ranch", "Agriculture"),
                ("climate smart", "Environment & Water"),
            ],
            supports_rich_sections: true,
        },
        WebpageAdapterKind::CalOes => WebpageAdapterSpec {
            kind,
            opportunity_terms: &[
                "grant announcements",
                "search for grants",
                "funding opportunities",
                "program guidelines",
                "application due",
            ],
            noise_terms: &["news", "training", "calendar", "contact"],
            link_selectors: &[
                "main .grant-card a",
                "main .search-results a",
                "main .views-row a",
                "main article a",
                "main h2 a",
                "main h3 a",
                "main p a",
                "table a",
            ],
            highlight_selectors: &[
                "main h2",
                "main h3",
                "main p",
                "main li",
                "article h2",
                "article h3",
                "article p",
                "article li",
                "section h2",
                "section h3",
                "section p",
                "table tr",
            ],
            category_hints: &[
                ("emergency management", "Disaster Prevention & Relief"),
                ("preparedness", "Disaster Prevention & Relief"),
                ("recovery", "Disaster Prevention & Relief"),
                ("resilience", "Disaster Prevention & Relief"),
            ],
            supports_rich_sections: true,
        },
        WebpageAdapterKind::Cnra => WebpageAdapterSpec {
            kind,
            opportunity_terms: &[
                "grant programs",
                "funding opportunities",
                "program overview",
                "solicitation",
                "request for proposals",
            ],
            noise_terms: &["news", "meeting", "archive", "contact"],
            link_selectors: &[
                "main .views-row a",
                "main .card a",
                "main article a",
                "main h2 a",
                "main h3 a",
                "main p a",
                "table a",
            ],
            highlight_selectors: &[
                "main h2",
                "main h3",
                "main p",
                "main li",
                "article h2",
                "article h3",
                "article p",
                "article li",
                "section h2",
                "section h3",
                "section p",
            ],
            category_hints: &[
                ("conservation", "Environment & Water"),
                ("wildlife", "Environment & Water"),
                ("resources", "Environment & Water"),
                ("tribal", "Disadvantaged Communities"),
            ],
            supports_rich_sections: true,
        },
        WebpageAdapterKind::Calepa => WebpageAdapterSpec {
            kind,
            opportunity_terms: &[
                "grants and loans",
                "grant opportunities",
                "funding",
                "application",
                "funding available",
            ],
            noise_terms: &["news", "archive", "contact us", "staff"],
            link_selectors: &[
                "main .accordion a",
                "main .card a",
                "main .grant-card a",
                "main article a",
                "main h2 a",
                "main h3 a",
                "main p a",
                "table a",
            ],
            highlight_selectors: &[
                "main h2",
                "main h3",
                "main p",
                "main li",
                "article h2",
                "article h3",
                "article p",
                "article li",
                "section h2",
                "section h3",
                "section p",
                "table tr",
            ],
            category_hints: &[
                ("environmental justice", "Disadvantaged Communities"),
                ("cleanup", "Environment & Water"),
                ("air quality", "Environment & Water"),
                ("water", "Environment & Water"),
            ],
            supports_rich_sections: true,
        },
        WebpageAdapterKind::Cdfw
        | WebpageAdapterKind::Carb
        | WebpageAdapterKind::ArtsCouncil
        | WebpageAdapterKind::CalOSBA => WebpageAdapterSpec {
            kind,
            opportunity_terms: &[
                "grant program",
                "funding opportunity",
                "application",
                "solicitation",
                "funding available",
            ],
            noise_terms: &["news", "archive", "subscribe", "contact us"],
            link_selectors: &[
                "main a",
                "main li a",
                "main p a",
                "article a",
                "section a",
                "table a",
            ],
            highlight_selectors: &[
                "main h2",
                "main h3",
                "main p",
                "main li",
                "article h2",
                "article h3",
                "article p",
                "article li",
                "section h2",
                "section h3",
                "section p",
                "table tr",
            ],
            category_hints: &[
                ("wildlife", "Environment & Water"),
                ("air", "Environment & Water"),
                ("energy", "Energy"),
                ("justice", "Law, Justice, and Legal Services"),
                ("arts", "Libraries and Arts"),
                ("business", "Employment, Labor & Training"),
                ("small business", "Employment, Labor & Training"),
                ("nonprofit", "Disadvantaged Communities"),
            ],
            supports_rich_sections: true,
        },
        WebpageAdapterKind::Generic => WebpageAdapterSpec {
            kind,
            opportunity_terms: &[
                "grant program",
                "funding opportunity",
                "request for applications",
                "request for proposals",
                "notice of funding",
                "solicitation",
                "available funding",
            ],
            noise_terms: &[
                "subscribe",
                "news",
                "privacy policy",
                "accessibility",
                "contact",
                "about this site",
                "home",
            ],
            link_selectors: &["a"],
            highlight_selectors: &[
                "main h2",
                "main h3",
                "article h2",
                "article h3",
                "section h2",
                "section h3",
                "main li",
                "article li",
                "section li",
            ],
            category_hints: &[
                ("education", "Education"),
                ("environment", "Environment & Water"),
                ("housing", "Housing, Community and Economic Development"),
                ("health", "Health & Human Services"),
            ],
            supports_rich_sections: supports_rich_webpage_extraction(source),
        },
    };

    base
}

pub fn kind_for_source(source: &GrantSourceRecord) -> WebpageAdapterKind {
    match source.source_family.as_deref() {
        Some("ca-grants-portal") => WebpageAdapterKind::CaliforniaGrantsPortal,
        Some("scc-grants") => WebpageAdapterKind::CoastalConservancy,
        Some("calfire-grants") => WebpageAdapterKind::CalFire,
        Some("hcd-grants") => WebpageAdapterKind::Hcd,
        Some("cdfa-grants") => WebpageAdapterKind::Cdfa,
        Some("cdfw-grants") => WebpageAdapterKind::Cdfw,
        Some("carb-grants") => WebpageAdapterKind::Carb,
        Some("calepa-grants") => WebpageAdapterKind::Calepa,
        Some("caloes-grants") => WebpageAdapterKind::CalOes,
        Some("cnra-grants") => WebpageAdapterKind::Cnra,
        Some("arts-council-grants") => WebpageAdapterKind::ArtsCouncil,
        Some("calosba-grants") => WebpageAdapterKind::CalOSBA,
        _ => WebpageAdapterKind::Generic,
    }
}

pub fn supports_rich_sections_for_source(source: &GrantSourceRecord) -> bool {
    spec_for_source(source).supports_rich_sections
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source(source_id: &str, family: Option<&str>) -> GrantSourceRecord {
        GrantSourceRecord {
            source_id: source_id.to_string(),
            source_family: family.map(ToOwned::to_owned),
            name: "Example source".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://example.org/grants".to_string(),
            enabled: true,
            ..Default::default()
        }
    }

    #[test]
    fn grants_portal_maps_to_specific_adapter() {
        let spec = spec_for_source(&source("ca-grants-portal-homepage", Some("ca-grants-portal")));
        assert_eq!(spec.kind, WebpageAdapterKind::CaliforniaGrantsPortal);
        assert!(spec.supports_rich_sections);
        assert!(spec.opportunity_terms.contains(&"recently posted"));
    }

    #[test]
    fn cdfa_maps_to_specific_adapter() {
        let spec = spec_for_source(&source("ca-cdfa-grants", Some("cdfa-grants")));
        assert_eq!(spec.kind, WebpageAdapterKind::Cdfa);
        assert!(spec.opportunity_terms.contains(&"catalogue of grant programs"));
        assert!(spec.category_hints.iter().any(|(needle, _)| *needle == "agriculture"));
    }

    #[test]
    fn caloes_maps_to_specific_adapter() {
        let spec = spec_for_source(&source("ca-caloes-grant-announcements", Some("caloes-grants")));
        assert_eq!(spec.kind, WebpageAdapterKind::CalOes);
        assert!(spec.opportunity_terms.contains(&"search for grants"));
    }

    #[test]
    fn cnra_maps_to_specific_adapter() {
        let spec = spec_for_source(&source("ca-cnra-grants", Some("cnra-grants")));
        assert_eq!(spec.kind, WebpageAdapterKind::Cnra);
        assert!(spec.category_hints.iter().any(|(needle, _)| *needle == "conservation"));
    }

    #[test]
    fn calepa_maps_to_specific_adapter() {
        let spec = spec_for_source(&source("ca-calepa-loans-grants", Some("calepa-grants")));
        assert_eq!(spec.kind, WebpageAdapterKind::Calepa);
        assert!(spec.opportunity_terms.contains(&"grants and loans"));
    }

    #[test]
    fn generic_sources_remain_generic() {
        let spec = spec_for_source(&source("example", None));
        assert_eq!(spec.kind, WebpageAdapterKind::Generic);
    }
}
