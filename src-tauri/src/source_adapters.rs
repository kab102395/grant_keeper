use crate::models::{GrantSourceHealthStatus, GrantSourceKind, GrantSourceRecord};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceAdapterStatus {
    Auto,
    PendingAdapter(&'static str),
    Blocked(&'static str),
}

impl SourceAdapterStatus {
    pub fn is_auto(self) -> bool {
        matches!(self, Self::Auto)
    }

    pub fn health_status(self) -> GrantSourceHealthStatus {
        match self {
            Self::Auto => GrantSourceHealthStatus::Healthy,
            Self::PendingAdapter(_) => GrantSourceHealthStatus::PendingAdapter,
            Self::Blocked(_) => GrantSourceHealthStatus::Blocked,
        }
    }

    pub fn note(self) -> Option<&'static str> {
        match self {
            Self::Auto => None,
            Self::PendingAdapter(note) | Self::Blocked(note) => Some(note),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SourceAdapterProfile {
    pub family: Option<&'static str>,
    pub canonical_source_id: Option<&'static str>,
    pub status: SourceAdapterStatus,
    pub low_yield_threshold: usize,
    pub supports_rich_webpage_extraction: bool,
}

pub fn profile_for(source: &GrantSourceRecord) -> SourceAdapterProfile {
    let family = source_family_for_id(&source.source_id);
    let canonical_source_id = canonical_source_id_for_id(&source.source_id);
    let status = adapter_status_for(source);
    let name_lower = source.name.to_ascii_lowercase();
    let low_yield_threshold = low_yield_threshold_for(source.kind.clone(), &name_lower);
    let supports_rich_webpage_extraction = matches!(
        family,
        Some("ca-grants-portal")
            | Some("caloes-grants")
            | Some("cdfa-grants")
            | Some("cdfw-grants")
            | Some("carb-grants")
            | Some("calepa-grants")
            | Some("cnra-grants")
            | Some("calfire-grants")
            | Some("hcd-grants")
            | Some("sgc-grants")
    );

    SourceAdapterProfile {
        family,
        canonical_source_id,
        status,
        low_yield_threshold,
        supports_rich_webpage_extraction,
    }
}

pub fn source_requires_auto_sync(source: &GrantSourceRecord) -> bool {
    profile_for(source).status.is_auto()
}

pub fn supports_rich_webpage_extraction(source: &GrantSourceRecord) -> bool {
    profile_for(source).supports_rich_webpage_extraction
}

pub fn source_family_for_id(source_id: &str) -> Option<&'static str> {
    match source_id {
        "ca-grants-offered" | "ca-grants-csv" => Some("ca-grants-portal-offerings"),
        s if s.starts_with("ca-grants-awards") => Some("ca-grants-portal-awards"),
        s if s.starts_with("ca-grants-portal") => Some("ca-grants-portal"),
        "ca-coastal-conservancy-grants" => Some("scc-grants"),
        s if s.starts_with("ca-cdfa-") => Some("cdfa-grants"),
        s if s.starts_with("ca-cdfw-") => Some("cdfw-grants"),
        s if s.starts_with("ca-carb-") => Some("carb-grants"),
        s if s.starts_with("ca-scc-") => Some("scc-grants"),
        s if s.starts_with("ca-calfire-") => Some("calfire-grants"),
        s if s.starts_with("ca-hcd-") => Some("hcd-grants"),
        s if s.starts_with("ca-csd-") => Some("csd-grants"),
        s if s.starts_with("ca-sgc-") => Some("sgc-grants"),
        s if s.starts_with("ca-cnra-museum-") => Some("cnra-grants"),
        s if s.starts_with("ca-cde-") => Some("cde-grants"),
        s if s.starts_with("ca-caloes-") => Some("caloes-grants"),
        s if s.starts_with("ca-calepa-") => Some("calepa-grants"),
        s if s.starts_with("ca-cnra-") => Some("cnra-grants"),
        s if s.starts_with("ca-arts-council-") => Some("arts-council-grants"),
        s if s.starts_with("ca-calosba-") => Some("calosba-grants"),
        _ => None,
    }
}

pub fn canonical_source_id_for_id(source_id: &str) -> Option<&'static str> {
    match source_id {
        "ca-grants-csv" => Some("ca-grants-offered"),
        _ => None,
    }
}

fn adapter_status_for(source: &GrantSourceRecord) -> SourceAdapterStatus {
    match source.source_id.as_str() {
        "ca-coastal-conservancy-grants" => SourceAdapterStatus::PendingAdapter(
            "official root grants page is blocked; use program-level SCC pages or add a dedicated adapter",
        ),
        "ca-csac-cal-grant" => SourceAdapterStatus::PendingAdapter(
            "CSAC Cal Grant page is not a public opportunity feed and is blocked for automation",
        ),
        _ => {
            let last_error = source.last_error.as_deref().unwrap_or_default();
            if source.kind == GrantSourceKind::Webpage
                && (last_error.contains("403 Forbidden")
                    || last_error.contains("401 Unauthorized")
                    || last_error.contains("blocked")
                    || last_error.contains("robot")
                    || last_error.contains("captcha"))
            {
                SourceAdapterStatus::Blocked("site blocked automated access; source needs a dedicated adapter")
            } else {
                SourceAdapterStatus::Auto
            }
        }
    }
}

fn low_yield_threshold_for(kind: GrantSourceKind, name_lower: &str) -> usize {
    match kind {
        GrantSourceKind::Webpage => {
            if name_lower.contains("search") {
                10
            } else if name_lower.contains("news") || name_lower.contains("homepage") {
                12
            } else {
                5
            }
        }
        GrantSourceKind::Csv | GrantSourceKind::Json => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source(source_id: &str, kind: GrantSourceKind) -> GrantSourceRecord {
        GrantSourceRecord {
            source_id: source_id.to_string(),
            name: "Example source".to_string(),
            kind,
            url: "https://example.org/grants".to_string(),
            enabled: true,
            ..Default::default()
        }
    }

    #[test]
    fn known_blocked_sources_are_pending_adapter() {
        let profile = profile_for(&source("ca-csac-cal-grant", GrantSourceKind::Webpage));
        assert!(matches!(
            profile.status,
            SourceAdapterStatus::PendingAdapter(_)
        ));
        assert_eq!(
            profile.status.health_status(),
            GrantSourceHealthStatus::PendingAdapter
        );
    }

    #[test]
    fn blocked_web_sources_from_error_are_blocked() {
        let mut source = source("ca-example-grants", GrantSourceKind::Webpage);
        source.last_error = Some("403 Forbidden".to_string());
        let profile = profile_for(&source);
        assert!(matches!(profile.status, SourceAdapterStatus::Blocked(_)));
        assert_eq!(
            profile.status.health_status(),
            GrantSourceHealthStatus::Blocked
        );
    }

    #[test]
    fn csv_sources_auto_sync() {
        let profile = profile_for(&source("ca-grants-offered", GrantSourceKind::Csv));
        assert!(profile.status.is_auto());
        assert!(source_requires_auto_sync(&source(
            "ca-grants-offered",
            GrantSourceKind::Csv
        )));
        assert_eq!(profile.low_yield_threshold, 0);
    }
}
