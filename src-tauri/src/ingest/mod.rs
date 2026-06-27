use crate::{
    db,
    models::{GrantRecord, GrantSourceKind, GrantSourceRecord, GrantSummary},
    rtdb::{RealtimeDatabaseClient, RtdbError},
};
use chrono::Utc;
use csv::StringRecord;
use scraper::{Html, Selector};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    io::Read,
};
use url::Url;

mod web_adapters;

pub const DEFAULT_CA_GRANTS_CSV_URL: &str = "https://data.ca.gov/dataset/e1b1c799-cdd4-4219-af6d-93b79747fffb/resource/111c8c88-21f6-453c-ae2c-b4785a0624f5/download/california-grants-portal-data.csv";

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct GrantIngestReport {
    pub source_id: Option<String>,
    pub source_name: Option<String>,
    pub source_kind: GrantSourceKind,
    pub source_url: String,
    pub total_rows: usize,
    pub upserted: usize,
    pub closed_missing: usize,
}

#[derive(Debug, thiserror::Error)]
pub enum GrantIngestError {
    #[error("{0}")]
    Http(#[from] reqwest::Error),
    #[error("{0}")]
    Csv(#[from] csv::Error),
    #[error("{0}")]
    Rtdb(#[from] RtdbError),
    #[error("{0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Parse(String),
}

pub async fn fetch_grants_from_csv_url(url: &str) -> Result<Vec<GrantRecord>, GrantIngestError> {
    let response = reqwest::get(url).await?;
    let response = response.error_for_status()?;
    let contents = response.text().await?;
    parse_grants_csv(contents.as_bytes())
}

pub async fn fetch_grants_from_json_url(url: &str) -> Result<Vec<GrantRecord>, GrantIngestError> {
    let response = reqwest::get(url).await?;
    let response = response.error_for_status()?;
    let payload: Value = response.json().await?;
    Ok(parse_grant_collection(payload))
}

pub async fn fetch_grants_from_source(
    source: &GrantSourceRecord,
) -> Result<Vec<GrantRecord>, GrantIngestError> {
    match source.kind {
        GrantSourceKind::Csv => fetch_grants_from_csv_url(&source.url).await,
        GrantSourceKind::Json => fetch_grants_from_json_url(&source.url).await,
        GrantSourceKind::Webpage => fetch_grants_from_webpage_url(&source.url, source).await,
    }
}

pub async fn fetch_grants_from_webpage_url(
    url: &str,
    source: &GrantSourceRecord,
) -> Result<Vec<GrantRecord>, GrantIngestError> {
    let response = reqwest::get(url).await?;
    let response = response.error_for_status()?;
    let final_url = response.url().clone();
    let html = response.text().await?;
    Ok(parse_grants_from_webpage_html(
        &html,
        final_url.as_str(),
        source,
    ))
}

pub fn parse_grants_csv<R: Read>(reader: R) -> Result<Vec<GrantRecord>, GrantIngestError> {
    let mut text = String::new();
    let mut reader = std::io::BufReader::new(reader);
    reader.read_to_string(&mut text)?;
    if let Some(stripped) = text.strip_prefix('\u{feff}') {
        text = stripped.to_string();
    }

    let mut csv_reader = csv::ReaderBuilder::new()
        .trim(csv::Trim::All)
        .flexible(true)
        .from_reader(text.as_bytes());

    let headers = csv_reader
        .headers()?
        .iter()
        .map(strip_bom)
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    let header_index = headers
        .iter()
        .enumerate()
        .map(|(index, header)| (header.clone(), index))
        .collect::<HashMap<_, _>>();

    let mut grants = Vec::new();
    for row in csv_reader.records() {
        let record = row?;
        grants.push(parse_grant_record(&header_index, &record)?);
    }

    Ok(grants)
}

pub async fn sync_public_grants(
    client: &RealtimeDatabaseClient,
    source_url: &str,
    mark_missing_closed: bool,
) -> Result<GrantIngestReport, GrantIngestError> {
    let source = GrantSourceRecord {
        source_id: "ca-grants-offered".to_string(),
        source_family: Some("ca-grants-portal-offerings".to_string()),
        canonical_source_id: None,
        name: "California Grants Portal - Grants Offered".to_string(),
        kind: GrantSourceKind::Csv,
        url: source_url.to_string(),
        enabled: true,
        jurisdiction: Some("California".to_string()),
        notes: Some("Primary live CSV feed from data.ca.gov".to_string()),
        last_run_at: None,
        last_status: None,
        last_error: None,
        ..Default::default()
    };
    sync_grant_source(client, &source, mark_missing_closed).await
}

pub async fn sync_grant_source(
    client: &RealtimeDatabaseClient,
    source: &GrantSourceRecord,
    mark_missing_closed: bool,
) -> Result<GrantIngestReport, GrantIngestError> {
    let grants = fetch_grants_from_source(source).await?;
    let current_map: BTreeMap<String, GrantRecord> = grants
        .into_iter()
        .filter(|grant| grant_is_valid_for_source(source, grant))
        .map(|grant| {
            let grant = attach_source_metadata(grant, source);
            (grant.portal_id.clone(), grant)
        })
        .collect();
    let total_rows = current_map.len();
    let current_ids: HashSet<String> = current_map.keys().cloned().collect();
    let existing = client.get_json(db::grants_root()).await?;
    let mut merged_map: BTreeMap<String, GrantRecord> = parse_grant_collection(existing)
        .into_iter()
        .map(|grant| (grant.portal_id.clone(), grant))
        .collect();

    if source.kind == GrantSourceKind::Webpage {
        merged_map.retain(|_, grant| {
            grant.source_id.as_deref() != Some(source.source_id.as_str())
                || grant_is_valid_for_source(source, grant)
        });
    }

    let mut closed_missing = 0usize;
    if mark_missing_closed {
        for grant in merged_map.values_mut() {
            if grant.source_id.as_deref() == Some(source.source_id.as_str())
                && !current_ids.contains(&grant.portal_id)
            {
                grant.status = Some("closed".to_string());
                grant.change_notes = Some(
                    grant
                        .change_notes
                        .clone()
                        .unwrap_or_else(|| "closed by latest source sync".to_string()),
                );
                grant.updated_at = Some(Utc::now());
                closed_missing += 1;
            }
        }
    }

    for (portal_id, grant) in current_map {
        merged_map.insert(portal_id, grant);
    }

    client.put_json(db::grants_root(), &merged_map).await?;

    Ok(GrantIngestReport {
        source_id: Some(source.source_id.clone()),
        source_name: Some(source.name.clone()),
        source_kind: source.kind.clone(),
        source_url: source.url.clone(),
        total_rows,
        upserted: total_rows,
        closed_missing,
    })
}

pub fn parse_grant_collection(payload: Value) -> Vec<GrantRecord> {
    collection_entries(extract_collection_payload(payload))
        .into_iter()
        .filter_map(|(key, value)| parse_grant_value(key, value).ok())
        .collect()
}

#[allow(dead_code)]
pub fn grant_summaries_from_payload(payload: Value) -> Vec<GrantSummary> {
    parse_grant_collection(payload)
        .into_iter()
        .map(GrantSummary::from)
        .collect()
}

pub fn normalize_grant_for_write(mut grant: GrantRecord) -> Result<GrantRecord, GrantIngestError> {
    if grant.portal_id.trim().is_empty() {
        return Err(GrantIngestError::Parse(
            "grant portal_id is required".to_string(),
        ));
    }
    if grant.title.trim().is_empty() {
        grant.title = grant.portal_id.clone();
    }
    grant.updated_at = Some(Utc::now());
    Ok(grant)
}

pub fn parse_grant_value_for_key(
    fallback_portal_id: String,
    value: Value,
) -> Result<GrantRecord, GrantIngestError> {
    parse_grant_value(fallback_portal_id, value)
}

fn parse_grant_record(
    headers: &HashMap<String, usize>,
    record: &StringRecord,
) -> Result<GrantRecord, GrantIngestError> {
    let portal_id = required_string(record, headers, "PortalID")?;
    let title = required_string(record, headers, "Title").unwrap_or_else(|_| portal_id.clone());
    let (contact_name, contact_email, contact_phone) =
        parse_contact(required_string_opt(record, headers, "ContactInfo").as_deref());
    let (est_amount_min, est_amount_max) =
        parse_amount_range(required_string_opt(record, headers, "EstAmounts").as_deref());
    let est_avail_funds_numeric =
        parse_amount(required_string_opt(record, headers, "EstAvailFunds").as_deref());
    let (deadline_is_ongoing, application_deadline) =
        parse_deadline(required_string_opt(record, headers, "ApplicationDeadline").as_deref());

    Ok(GrantRecord {
        portal_id,
        grant_id_external: required_string_opt(record, headers, "GrantID"),
        status: required_string_opt(record, headers, "Status"),
        last_updated_source: required_string_opt(record, headers, "LastUpdated"),
        change_notes: required_string_opt(record, headers, "ChangeNotes"),
        title,
        agency_dept: required_string_opt(record, headers, "AgencyDept"),
        grant_type: required_string_opt(record, headers, "Type"),
        loi_required: parse_bool(required_string_opt(record, headers, "LOI").as_deref()),
        categories: parse_list(required_string_opt(record, headers, "Categories").as_deref()),
        category_suggestion: required_string_opt(record, headers, "CategorySuggestion"),
        purpose: required_string_opt(record, headers, "Purpose"),
        description: required_string_opt(record, headers, "Description"),
        source_page_title: None,
        source_page_description: None,
        source_excerpt: None,
        source_highlights: Vec::new(),
        applicant_types: parse_list(
            required_string_opt(record, headers, "ApplicantType").as_deref(),
        ),
        applicant_type_notes: required_string_opt(record, headers, "ApplicantTypeNotes"),
        geography: required_string_opt(record, headers, "Geography"),
        funding_source: required_string_opt(record, headers, "FundingSource"),
        funding_source_notes: required_string_opt(record, headers, "FundingSourceNotes"),
        matching_funds: required_string_opt(record, headers, "MatchingFunds"),
        matching_funds_notes: required_string_opt(record, headers, "MatchingFundsNotes"),
        est_avail_funds: required_string_opt(record, headers, "EstAvailFunds"),
        est_avail_funds_numeric,
        est_awards: required_string_opt(record, headers, "EstAwards"),
        est_amounts: required_string_opt(record, headers, "EstAmounts"),
        est_amount_min,
        est_amount_max,
        funding_method: required_string_opt(record, headers, "FundingMethod"),
        funding_method_notes: required_string_opt(record, headers, "FundingMethodNotes"),
        open_date: required_string_opt(record, headers, "OpenDate"),
        application_deadline,
        deadline_is_ongoing,
        award_period: required_string_opt(record, headers, "AwardPeriod"),
        exp_award_date: required_string_opt(record, headers, "ExpAwardDate"),
        elec_submission_url: strip_url_prefix(
            required_string_opt(record, headers, "ElecSubmission").as_deref(),
        ),
        grant_url: required_string_opt(record, headers, "GrantURL"),
        agency_url: required_string_opt(record, headers, "AgencyURL"),
        agency_subscribe_url: required_string_opt(record, headers, "AgencySubscribeURL"),
        grant_events_url: required_string_opt(record, headers, "GrantEventsURL"),
        contact_name,
        contact_email,
        contact_phone,
        award_stats: required_string_opt(record, headers, "AwardStats"),
        organization_uid: None,
        source_id: None,
        source_family: None,
        canonical_source_id: None,
        source_name: None,
        source_kind: None,
        source_url: None,
        source_record_key: None,
        source_jurisdiction: None,
        updated_at: Some(Utc::now()),
    })
}

fn parse_grant_value(
    fallback_portal_id: String,
    value: Value,
) -> Result<GrantRecord, GrantIngestError> {
    let mut grant = match value {
        Value::Object(map) => {
            let title = string_field(&map, "title").unwrap_or_else(|| fallback_portal_id.clone());
            let categories = string_list_field(&map, "categories");
            let applicant_types = string_list_field(&map, "applicant_types");
            let loi_required = bool_field(&map, "loi_required").unwrap_or(false);
            let deadline_is_ongoing = bool_field(&map, "deadline_is_ongoing").unwrap_or(false);
            let application_deadline = string_field(&map, "application_deadline");

            GrantRecord {
                portal_id: string_field(&map, "portal_id").unwrap_or(fallback_portal_id),
                grant_id_external: string_field(&map, "grant_id_external"),
                status: string_field(&map, "status"),
                last_updated_source: string_field(&map, "last_updated_source"),
                change_notes: string_field(&map, "change_notes"),
                title,
                agency_dept: string_field(&map, "agency_dept"),
                grant_type: string_field(&map, "grant_type"),
                loi_required,
                categories,
                category_suggestion: string_field(&map, "category_suggestion"),
                purpose: string_field(&map, "purpose"),
                description: string_field(&map, "description"),
                source_page_title: string_field(&map, "source_page_title"),
                source_page_description: string_field(&map, "source_page_description"),
                source_excerpt: string_field(&map, "source_excerpt"),
                source_highlights: string_list_field(&map, "source_highlights"),
                applicant_types,
                applicant_type_notes: string_field(&map, "applicant_type_notes"),
                geography: string_field(&map, "geography"),
                funding_source: string_field(&map, "funding_source"),
                funding_source_notes: string_field(&map, "funding_source_notes"),
                matching_funds: string_field(&map, "matching_funds"),
                matching_funds_notes: string_field(&map, "matching_funds_notes"),
                est_avail_funds: string_field(&map, "est_avail_funds"),
                est_avail_funds_numeric: int_field(&map, "est_avail_funds_numeric"),
                est_awards: string_field(&map, "est_awards"),
                est_amounts: string_field(&map, "est_amounts"),
                est_amount_min: int_field(&map, "est_amount_min"),
                est_amount_max: int_field(&map, "est_amount_max"),
                funding_method: string_field(&map, "funding_method"),
                funding_method_notes: string_field(&map, "funding_method_notes"),
                open_date: string_field(&map, "open_date"),
                application_deadline,
                deadline_is_ongoing,
                award_period: string_field(&map, "award_period"),
                exp_award_date: string_field(&map, "exp_award_date"),
                elec_submission_url: string_field(&map, "elec_submission_url"),
                grant_url: string_field(&map, "grant_url"),
                agency_url: string_field(&map, "agency_url"),
                agency_subscribe_url: string_field(&map, "agency_subscribe_url"),
                grant_events_url: string_field(&map, "grant_events_url"),
                contact_name: string_field(&map, "contact_name"),
                contact_email: string_field(&map, "contact_email"),
                contact_phone: string_field(&map, "contact_phone"),
                award_stats: string_field(&map, "award_stats"),
                organization_uid: string_field(&map, "organization_uid"),
                source_id: string_field(&map, "source_id"),
                source_family: string_field(&map, "source_family"),
                canonical_source_id: string_field(&map, "canonical_source_id"),
                source_name: string_field(&map, "source_name"),
                source_kind: match string_field(&map, "source_kind").as_deref() {
                    Some("csv") => Some(GrantSourceKind::Csv),
                    Some("json") => Some(GrantSourceKind::Json),
                    Some("webpage") => Some(GrantSourceKind::Webpage),
                    _ => None,
                },
                source_url: string_field(&map, "source_url"),
                source_record_key: string_field(&map, "source_record_key"),
                source_jurisdiction: string_field(&map, "source_jurisdiction"),
                updated_at: datetime_field(&map, "updated_at"),
            }
        }
        other => {
            return Err(GrantIngestError::Parse(format!(
                "unsupported grant payload: {other:?}"
            )));
        }
    };

    if grant.title.trim().is_empty() {
        grant.title = grant.portal_id.clone();
    }
    Ok(grant)
}

fn collection_entries(payload: Value) -> Vec<(String, Value)> {
    match payload {
        Value::Null => Vec::new(),
        Value::Object(map) => {
            let mut entries = Vec::with_capacity(map.len());
            for (key, value) in map {
                entries.push((key, value));
            }
            entries
        }
        Value::Array(items) => items
            .into_iter()
            .enumerate()
            .map(|(index, value)| (index.to_string(), value))
            .collect(),
        other => vec![("value".to_string(), other)],
    }
}

fn extract_collection_payload(payload: Value) -> Value {
    match payload {
        Value::Object(map) => {
            for key in ["records", "results", "grants", "items", "data"] {
                if let Some(value) = map.get(key) {
                    if matches!(value, Value::Array(_) | Value::Object(_)) {
                        return value.clone();
                    }
                }
            }
            if let Some(value) = map.get("result") {
                if let Some(inner) = extract_nested_collection(value) {
                    return inner;
                }
            }
            Value::Object(map)
        }
        other => other,
    }
}

fn extract_nested_collection(value: &Value) -> Option<Value> {
    match value {
        Value::Object(map) => {
            for key in ["records", "results", "grants", "items", "data"] {
                if let Some(value) = map.get(key) {
                    if matches!(value, Value::Array(_) | Value::Object(_)) {
                        return Some(value.clone());
                    }
                }
            }
            None
        }
        _ => None,
    }
}

fn required_string(
    record: &StringRecord,
    headers: &HashMap<String, usize>,
    name: &str,
) -> Result<String, GrantIngestError> {
    required_string_opt(record, headers, name)
        .ok_or_else(|| GrantIngestError::Parse(format!("missing required column {name}")))
}

fn required_string_opt(
    record: &StringRecord,
    headers: &HashMap<String, usize>,
    name: &str,
) -> Option<String> {
    headers
        .get(name)
        .and_then(|index| record.get(*index))
        .and_then(normalize_text)
}

fn normalize_text(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_matches('\u{feff}');
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("N/A") {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn parse_bool(value: Option<&str>) -> bool {
    matches!(
        value.map(|text| text.trim().to_ascii_lowercase()),
        Some(ref text) if matches!(text.as_str(), "yes" | "true" | "1" | "y")
    )
}

fn parse_list(value: Option<&str>) -> Vec<String> {
    value
        .map(|text| {
            text.split("; ")
                .map(str::trim)
                .filter(|item| !item.is_empty() && !item.eq_ignore_ascii_case("N/A"))
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn parse_amount(value: Option<&str>) -> Option<i64> {
    value.and_then(|text| {
        let clean = clean_money(text);
        if clean.is_empty() {
            None
        } else {
            clean.parse::<i64>().ok()
        }
    })
}

fn parse_amount_range(value: Option<&str>) -> (Option<i64>, Option<i64>) {
    let Some(text) = value else {
        return (None, None);
    };
    if text.eq_ignore_ascii_case("Dependent") {
        return (None, None);
    }
    for separator in [" – ", " - ", "—", "–", "-"] {
        if let Some((left, right)) = text.split_once(separator) {
            return (parse_amount(Some(left)), parse_amount(Some(right)));
        }
    }
    let amount = parse_amount(Some(text));
    (amount, amount)
}

fn clean_money(text: &str) -> String {
    text.trim()
        .trim_matches('$')
        .replace(',', "")
        .replace(' ', "")
}

fn parse_contact(value: Option<&str>) -> (Option<String>, Option<String>, Option<String>) {
    let Some(text) = value else {
        return (None, None, None);
    };

    let mut name = None;
    let mut email = None;
    let mut phone = None;

    for part in text.split(';') {
        let Some((raw_key, raw_value)) = part.split_once(':') else {
            continue;
        };
        let key = raw_key.trim().to_ascii_lowercase();
        let value = normalize_text(raw_value);
        match key.as_str() {
            "name" => name = value,
            "email" => email = value,
            "tel" | "phone" | "telephone" => phone = value,
            _ => {}
        }
    }

    (name, email, phone)
}

fn strip_url_prefix(value: Option<&str>) -> Option<String> {
    value.and_then(|text| {
        let stripped = text.strip_prefix("url: ").unwrap_or(text);
        normalize_text(stripped)
    })
}

fn parse_deadline(value: Option<&str>) -> (bool, Option<String>) {
    match value {
        Some(text) if text.eq_ignore_ascii_case("ongoing") => (true, None),
        Some(text) => (false, normalize_text(text)),
        None => (false, None),
    }
}

fn strip_bom(value: &str) -> &str {
    value.trim_start_matches('\u{feff}')
}

fn string_field(map: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    map.get(key)
        .and_then(|value| value.as_str().and_then(normalize_text))
}

fn string_list_field(map: &serde_json::Map<String, Value>, key: &str) -> Vec<String> {
    map.get(key)
        .and_then(|value| value.as_array())
        .map(|array| {
            array
                .iter()
                .filter_map(|value| value.as_str())
                .filter_map(normalize_text)
                .collect()
        })
        .unwrap_or_default()
}

fn bool_field(map: &serde_json::Map<String, Value>, key: &str) -> Option<bool> {
    map.get(key).and_then(|value| match value {
        Value::Bool(bool_value) => Some(*bool_value),
        Value::String(text) => Some(parse_bool(Some(text))),
        _ => None,
    })
}

fn int_field(map: &serde_json::Map<String, Value>, key: &str) -> Option<i64> {
    map.get(key).and_then(|value| match value {
        Value::Number(number) => number.as_i64(),
        Value::String(text) => parse_amount(Some(text)),
        _ => None,
    })
}

fn datetime_field(
    map: &serde_json::Map<String, Value>,
    key: &str,
) -> Option<chrono::DateTime<Utc>> {
    map.get(key).and_then(|value| match value {
        Value::String(text) => chrono::DateTime::parse_from_rfc3339(text)
            .ok()
            .map(|dt| dt.with_timezone(&Utc)),
        _ => None,
    })
}

fn attach_source_metadata(mut grant: GrantRecord, source: &GrantSourceRecord) -> GrantRecord {
    grant.source_id = Some(source.source_id.clone());
    grant.source_family = source.source_family.clone();
    grant.canonical_source_id = source.canonical_source_id.clone();
    grant.source_name = Some(source.name.clone());
    grant.source_kind = Some(source.kind.clone());
    grant.source_url = Some(source.url.clone());
    grant.source_record_key = Some(grant.portal_id.clone());
    grant.source_jurisdiction = source.jurisdiction.clone();
    grant
}

fn parse_grants_from_webpage_html(
    html: &str,
    base_url: &str,
    source: &GrantSourceRecord,
) -> Vec<GrantRecord> {
    let spec = web_adapters::spec_for_source(source);
    let document = Html::parse_document(html);
    let page_title = selector_text(&document, "title").unwrap_or_else(|| source.name.clone());
    let page_description = meta_content(&document, "description")
        .or_else(|| meta_content(&document, "og:description"))
        .or_else(|| selector_text(&document, "h1"))
        .unwrap_or_else(|| source.name.clone());
    let page_context = selector_text(&document, "h1")
        .or_else(|| selector_text(&document, "h2"))
        .unwrap_or_else(|| page_title.clone());

    let parser_output = match spec.kind {
        web_adapters::WebpageAdapterKind::CaliforniaGrantsPortal => {
            parse_california_grants_portal_page(
                &spec,
                source,
                base_url,
                &document,
                &page_title,
                &page_description,
                &page_context,
            )
        }
        web_adapters::WebpageAdapterKind::CoastalConservancy => parse_coastal_conservancy_page(
            &spec,
            source,
            base_url,
            &document,
            &page_title,
            &page_description,
            &page_context,
        ),
        web_adapters::WebpageAdapterKind::Hcd => parse_hcd_page(
            &spec,
            source,
            base_url,
            &document,
            &page_title,
            &page_description,
            &page_context,
        ),
        web_adapters::WebpageAdapterKind::CalOes => parse_caloes_page(
            &spec,
            source,
            base_url,
            &document,
            &page_title,
            &page_description,
            &page_context,
        ),
        web_adapters::WebpageAdapterKind::Cnra => parse_cnra_page(
            &spec,
            source,
            base_url,
            &document,
            &page_title,
            &page_description,
            &page_context,
        ),
        web_adapters::WebpageAdapterKind::Calepa => parse_calepa_page(
            &spec,
            source,
            base_url,
            &document,
            &page_title,
            &page_description,
            &page_context,
        ),
        _ => parse_generic_webpage_page(
            &spec,
            source,
            base_url,
            &document,
            &page_title,
            &page_description,
            &page_context,
        ),
    };
    parser_output
}

fn parse_generic_webpage_page(
    spec: &web_adapters::WebpageAdapterSpec,
    source: &GrantSourceRecord,
    base_url: &str,
    document: &Html,
    page_title: &str,
    page_description: &str,
    page_context: &str,
) -> Vec<GrantRecord> {
    let selectors = if spec.link_selectors.is_empty() {
        &["a"][..]
    } else {
        spec.link_selectors
    };
    parse_webpage_links_with_selectors(
        spec,
        source,
        base_url,
        document,
        page_title,
        page_description,
        page_context,
        selectors,
    )
}

fn parse_california_grants_portal_page(
    spec: &web_adapters::WebpageAdapterSpec,
    source: &GrantSourceRecord,
    base_url: &str,
    document: &Html,
    page_title: &str,
    page_description: &str,
    page_context: &str,
) -> Vec<GrantRecord> {
    parse_webpage_links_with_selectors(
        spec,
        source,
        base_url,
        document,
        page_title,
        page_description,
        page_context,
        &[
            "main .view-content a",
            "main .search-results a",
            "main .search-result a",
            "main .grant-card a",
            "main article a",
            "main h2 a",
            "main h3 a",
            "main a",
        ],
    )
}

fn parse_coastal_conservancy_page(
    spec: &web_adapters::WebpageAdapterSpec,
    source: &GrantSourceRecord,
    base_url: &str,
    document: &Html,
    page_title: &str,
    page_description: &str,
    page_context: &str,
) -> Vec<GrantRecord> {
    parse_webpage_links_with_selectors(
        spec,
        source,
        base_url,
        document,
        page_title,
        page_description,
        page_context,
        &[
            "main .views-row a",
            "main .node a",
            "main article a",
            "main .grant a",
            "main h2 a",
            "main h3 a",
            "main p a",
            "main a",
        ],
    )
}

fn parse_hcd_page(
    spec: &web_adapters::WebpageAdapterSpec,
    source: &GrantSourceRecord,
    base_url: &str,
    document: &Html,
    page_title: &str,
    page_description: &str,
    page_context: &str,
) -> Vec<GrantRecord> {
    parse_webpage_links_with_selectors(
        spec,
        source,
        base_url,
        document,
        page_title,
        page_description,
        page_context,
        &[
            "main .views-row a",
            "main .panel a",
            "main .grant-card a",
            "main article a",
            "main h2 a",
            "main h3 a",
            "table a",
            "main a",
        ],
    )
}

fn parse_caloes_page(
    spec: &web_adapters::WebpageAdapterSpec,
    source: &GrantSourceRecord,
    base_url: &str,
    document: &Html,
    page_title: &str,
    page_description: &str,
    page_context: &str,
) -> Vec<GrantRecord> {
    parse_webpage_links_with_selectors(
        spec,
        source,
        base_url,
        document,
        page_title,
        page_description,
        page_context,
        &[
            "main .grant-card a",
            "main .wp-block-group a",
            "main .wp-block-columns a",
            "main .search-results a",
            "main article a",
            "main h2 a",
            "main h3 a",
            "main p a",
            "table a",
            "main a",
        ],
    )
}

fn parse_cnra_page(
    spec: &web_adapters::WebpageAdapterSpec,
    source: &GrantSourceRecord,
    base_url: &str,
    document: &Html,
    page_title: &str,
    page_description: &str,
    page_context: &str,
) -> Vec<GrantRecord> {
    parse_webpage_links_with_selectors(
        spec,
        source,
        base_url,
        document,
        page_title,
        page_description,
        page_context,
        &[
            "main .views-row a",
            "main .card a",
            "main .field--name-body a",
            "main article a",
            "main h2 a",
            "main h3 a",
            "main p a",
            "main a",
        ],
    )
}

fn parse_calepa_page(
    spec: &web_adapters::WebpageAdapterSpec,
    source: &GrantSourceRecord,
    base_url: &str,
    document: &Html,
    page_title: &str,
    page_description: &str,
    page_context: &str,
) -> Vec<GrantRecord> {
    parse_webpage_links_with_selectors(
        spec,
        source,
        base_url,
        document,
        page_title,
        page_description,
        page_context,
        &[
            "main .accordion a",
            "main .card a",
            "main .grant-card a",
            "main article a",
            "main h2 a",
            "main h3 a",
            "main p a",
            "table a",
            "main a",
        ],
    )
}

fn parse_webpage_links_with_selectors(
    spec: &web_adapters::WebpageAdapterSpec,
    source: &GrantSourceRecord,
    base_url: &str,
    document: &Html,
    page_title: &str,
    page_description: &str,
    page_context: &str,
    selectors: &[&str],
) -> Vec<GrantRecord> {
    let base = Url::parse(base_url).or_else(|_| Url::parse(&source.url));
    let Ok(base) = base else {
        return webpage_fallback_record(
            spec,
            source,
            base_url,
            page_title,
            page_description,
            page_context,
            document,
        );
    };

    let mut seen = HashSet::new();
    let mut grants = Vec::new();

    for selector in selectors {
        let Some(selector) = Selector::parse(selector).ok() else {
            continue;
        };
        for anchor in document.select(&selector) {
            let Some(href) = anchor.value().attr("href") else {
                continue;
            };
            let Some(resolved) = resolve_url(&base, href) else {
                continue;
            };
            if should_ignore_webpage_link(&resolved, source, spec) {
                continue;
            }

            let anchor_text = normalize_whitespace(&anchor.text().collect::<Vec<_>>().join(" "))
                .unwrap_or_default();
            if !looks_like_grant_link(&anchor_text, &resolved, page_title, page_description, spec) {
                continue;
            }
            let portal_id =
                stable_web_portal_id(&source.source_id, resolved.as_str(), &anchor_text);
            if !seen.insert(portal_id.clone()) {
                continue;
            }

            grants.push(build_webpage_grant_record(
                spec,
                source,
                &portal_id,
                &anchor_text,
                page_title,
                page_description,
                page_context,
                resolved.as_str(),
                document,
            ));
        }
    }

    if grants.is_empty() {
        webpage_fallback_record(
            spec,
            source,
            base_url,
            page_title,
            page_description,
            page_context,
            document,
        )
    } else {
        grants
    }
}

fn build_webpage_grant_record(
    spec: &web_adapters::WebpageAdapterSpec,
    source: &GrantSourceRecord,
    portal_id: &str,
    title: &str,
    page_title: &str,
    page_description: &str,
    page_context: &str,
    grant_url: &str,
    document: &Html,
) -> GrantRecord {
    let excerpt = extract_webpage_excerpt(spec, source, document, title)
        .or_else(|| Some(page_description.to_string()))
        .unwrap_or_default();
    let highlights = extract_webpage_highlights(
        spec,
        source,
        document,
        page_title,
        page_description,
        page_context,
        title,
    );
    let summary = compose_webpage_summary(
        page_title,
        page_description,
        page_context,
        &excerpt,
        &highlights,
    );
    let amount = extract_first_currency_from_document(spec, source, document);
    let deadline = extract_first_deadline_from_document(spec, source, document);
    let deadline_is_ongoing = deadline.is_none();
    let status = if source.name.to_ascii_lowercase().contains("news")
        || page_title.to_ascii_lowercase().contains("news")
    {
        Some("active".to_string())
    } else {
        None
    };

    let grant = GrantRecord {
        portal_id: portal_id.to_string(),
        grant_id_external: None,
        status,
        last_updated_source: Some(page_title.to_string()),
        change_notes: Some(page_context.to_string()),
        title: normalize_web_title(title).unwrap_or_else(|| page_title.to_string()),
        agency_dept: Some(source.name.clone()),
        grant_type: Some("webpage".to_string()),
        loi_required: false,
        categories: infer_web_categories(spec, &source.name, &page_title, &excerpt),
        category_suggestion: None,
        purpose: Some(summary.clone()),
        description: Some(summary),
        source_page_title: Some(page_title.to_string()),
        source_page_description: Some(page_description.to_string()),
        source_excerpt: Some(excerpt),
        source_highlights: highlights,
        applicant_types: Vec::new(),
        applicant_type_notes: None,
        geography: source.jurisdiction.clone(),
        funding_source: Some(source.name.clone()),
        funding_source_notes: Some(page_context.to_string()),
        matching_funds: None,
        matching_funds_notes: None,
        est_avail_funds: amount.as_ref().map(|value| format!("${value}")),
        est_avail_funds_numeric: amount,
        est_awards: None,
        est_amounts: None,
        est_amount_min: None,
        est_amount_max: None,
        funding_method: None,
        funding_method_notes: None,
        open_date: None,
        application_deadline: deadline,
        deadline_is_ongoing,
        award_period: None,
        exp_award_date: None,
        elec_submission_url: None,
        grant_url: Some(grant_url.to_string()),
        agency_url: Some(source.url.clone()),
        agency_subscribe_url: None,
        grant_events_url: None,
        contact_name: None,
        contact_email: None,
        contact_phone: None,
        award_stats: None,
        organization_uid: None,
        source_id: None,
        source_family: None,
        canonical_source_id: None,
        source_name: None,
        source_kind: None,
        source_url: None,
        source_record_key: None,
        source_jurisdiction: None,
        updated_at: Some(Utc::now()),
    };

    attach_source_metadata(grant, source)
}

fn webpage_fallback_record(
    spec: &web_adapters::WebpageAdapterSpec,
    source: &GrantSourceRecord,
    base_url: &str,
    page_title: &str,
    page_description: &str,
    page_context: &str,
    document: &Html,
) -> Vec<GrantRecord> {
    if !page_looks_like_grant_opportunity(spec, source, page_title, page_description, page_context)
    {
        return Vec::new();
    }

    let portal_id = stable_web_portal_id(&source.source_id, base_url, page_title);
    vec![build_webpage_grant_record(
        spec,
        source,
        &portal_id,
        page_title,
        page_title,
        page_description,
        page_context,
        base_url,
        document,
    )]
}

fn page_looks_like_grant_opportunity(
    spec: &web_adapters::WebpageAdapterSpec,
    source: &GrantSourceRecord,
    page_title: &str,
    page_description: &str,
    page_context: &str,
) -> bool {
    let text = format!("{page_title} {page_description} {page_context}").to_ascii_lowercase();
    let source_name = source.name.to_ascii_lowercase();
    spec.opportunity_terms
        .iter()
        .any(|term| text.contains(term))
        && !source_name.contains("news")
        && !source_name.contains("homepage")
}

fn grant_is_valid_for_source(source: &GrantSourceRecord, grant: &GrantRecord) -> bool {
    if source.kind != GrantSourceKind::Webpage {
        return true;
    }
    let spec = web_adapters::spec_for_source(source);

    let title = grant.title.to_ascii_lowercase();
    let description = grant
        .description
        .as_deref()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let url = grant
        .grant_url
        .as_deref()
        .or(grant.agency_url.as_deref())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let text = format!("{title} {description} {url}");

    if is_obviously_non_grant_link(&title, &url) {
        return false;
    }

    let generic_noise_terms = [
        "follow us",
        "subscribe",
        "privacy policy",
        "accessibility",
        "use policy",
        "conditions of use",
        "contact",
        "about this site",
        "about",
        "newsroom",
        "news",
        "report",
        "annual report",
        "press release",
        "youtube",
        "twitter",
        "linkedin",
        "facebook",
        "instagram",
        "rss",
        "certificate",
        "sitemap",
        "login",
        "signin",
        "sign in",
        "home",
        "feedback",
        "find grants",
        "grant portal",
        "your feedback",
        "a new way to find grants",
    ];
    if generic_noise_terms
        .iter()
        .copied()
        .chain(spec.noise_terms.iter().copied())
        .any(|term| text.contains(term))
    {
        return false;
    }

    let mut opportunity_terms = vec![
        "grant program",
        "grants program",
        "funding opportunity",
        "request for applications",
        "request for proposals",
        "request for partnership proposals",
        "letter of interest",
        "notice of funding",
        "solicitation",
        "application deadline",
        "available funding",
        "award",
    ];
    opportunity_terms.extend(spec.opportunity_terms.iter().copied());
    opportunity_terms.iter().any(|term| text.contains(term))
}

fn selector_text(document: &Html, selector: &str) -> Option<String> {
    let selector = Selector::parse(selector).ok()?;
    let text = document
        .select(&selector)
        .flat_map(|node| node.text())
        .collect::<Vec<_>>()
        .join(" ");
    normalize_whitespace(&text)
}

fn meta_content(document: &Html, name: &str) -> Option<String> {
    let query = format!("meta[name=\"{name}\"], meta[property=\"{name}\"]");
    let selector = Selector::parse(&query).ok()?;
    document.select(&selector).find_map(|node| {
        node.value()
            .attr("content")
            .and_then(|value| normalize_whitespace(value))
    })
}

fn resolve_url(base: &Url, href: &str) -> Option<Url> {
    let href = href.trim();
    if href.is_empty() || href.starts_with("javascript:") || href.starts_with("mailto:") {
        return None;
    }
    base.join(href).ok()
}

fn should_ignore_webpage_link(
    url: &Url,
    source: &GrantSourceRecord,
    spec: &web_adapters::WebpageAdapterSpec,
) -> bool {
    let path = url.path().to_ascii_lowercase();
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let source_host = Url::parse(&source.url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(|value| value.to_ascii_lowercase()))
        .unwrap_or_default();

    if host != source_host {
        return false;
    }

    let standard_match = matches!(
        path.as_str(),
        "/" | "/privacy-policy/"
            | "/accessibility/"
            | "/contact/"
            | "/about-this-site/"
            | "/use-policy/"
            | "/conditions-of-use/"
    );
    standard_match || spec.noise_terms.iter().any(|term| path.contains(term))
}

fn looks_like_grant_link(
    anchor_text: &str,
    url: &Url,
    page_title: &str,
    page_description: &str,
    spec: &web_adapters::WebpageAdapterSpec,
) -> bool {
    let anchor = anchor_text.to_ascii_lowercase();
    let url_text = url.as_str().to_ascii_lowercase();
    let page_text = format!("{page_title} {page_description}").to_ascii_lowercase();

    if is_obviously_non_grant_link(&anchor, &url_text) {
        return false;
    }

    let mut grant_keywords = vec![
        "grant",
        "grants",
        "funding",
        "fund",
        "loan",
        "award",
        "rfa",
        "rfp",
        "cfo",
        "subgrant",
        "opportunity",
        "opportunities",
        "application",
    ];
    grant_keywords.extend(spec.opportunity_terms.iter().copied());
    let opportunity_keywords = [
        "grant program",
        "grants program",
        "funding opportunity",
        "request for applications",
        "request for proposals",
        "request for partnership proposals",
        "notice of funding",
        "solicitation",
        "award",
        "available funding",
    ];

    let anchor_is_grantish = grant_keywords
        .iter()
        .any(|keyword| anchor.contains(keyword))
        && !anchor.contains("find grants")
        && !anchor.contains("grant portal")
        && !anchor.contains("your feedback");
    let url_is_grantish = grant_keywords
        .iter()
        .any(|keyword| url_text.contains(keyword));
    let page_has_grant_context = grant_keywords
        .iter()
        .any(|keyword| page_text.contains(keyword));
    let page_has_opportunity_context = opportunity_keywords
        .iter()
        .any(|keyword| page_text.contains(keyword));

    (anchor_is_grantish && (page_has_grant_context || page_has_opportunity_context))
        || (url_is_grantish && page_has_opportunity_context)
}

fn is_obviously_non_grant_link(anchor_text: &str, url_text: &str) -> bool {
    let anchor = anchor_text.trim();
    let anchor_lower = anchor.to_ascii_lowercase();
    let url_lower = url_text.to_ascii_lowercase();
    let non_grant_terms = [
        "follow us",
        "subscribe",
        "privacy",
        "accessibility",
        "use policy",
        "conditions of use",
        "contact",
        "about this site",
        "about",
        "data",
        "newsroom",
        "news",
        "report",
        "annual report",
        "press release",
        "youtube",
        "twitter",
        "x (twitter)",
        "linkedin",
        "facebook",
        "instagram",
        "rss",
        "certificate",
        "sitemap",
        "login",
        "signin",
        "sign in",
        "home",
        "feedback",
    ];

    if non_grant_terms
        .iter()
        .any(|term| anchor_lower.contains(term))
    {
        return true;
    }

    let url_exclusions = [
        "/privacy",
        "/privacy-policy",
        "/accessibility",
        "/use-policy",
        "/conditions-of-use",
        "/contact",
        "/about",
        "/newsroom",
        "/social",
        "/youtube",
        "/twitter",
        "/linkedin",
        "/facebook",
        "/instagram",
        "/feed",
        "/rss",
    ];

    url_exclusions.iter().any(|term| url_lower.contains(term))
}

fn normalize_web_title(title: &str) -> Option<String> {
    let normalized = normalize_whitespace(title)?;
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn normalize_whitespace(text: &str) -> Option<String> {
    let collapsed = text
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string();
    if collapsed.is_empty() {
        None
    } else {
        Some(collapsed)
    }
}

fn stable_web_portal_id(source_id: &str, url: &str, title: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(source_id.as_bytes());
    hasher.update(b"|");
    hasher.update(url.as_bytes());
    hasher.update(b"|");
    hasher.update(title.as_bytes());
    let digest = hasher.finalize();
    let short_hex = digest[..16]
        .iter()
        .map(|byte| format!("{:02x}", byte))
        .collect::<String>();
    format!("web-{short_hex}")
}

fn extract_webpage_excerpt(
    spec: &web_adapters::WebpageAdapterSpec,
    source: &GrantSourceRecord,
    document: &Html,
    fallback: &str,
) -> Option<String> {
    let mut pieces = Vec::new();
    if let Some(title) = selector_text(document, "main h1, article h1, h1") {
        pieces.push(title);
    }
    if let Some(description) =
        meta_content(document, "description").or_else(|| meta_content(document, "og:description"))
    {
        pieces.push(description);
    }
    if is_high_value_webpage_source(source) {
        pieces.extend(extract_text_candidates(
            document,
            &[
                "main table tr",
                "article table tr",
                "section table tr",
                "main dl dd",
                "article dl dd",
            ],
            12,
        ));
        pieces.extend(extract_text_candidates(
            document,
            spec.highlight_selectors,
            12,
        ));
    }
    pieces.extend(
        selector_text(document, "main p, article p, section p")
            .map(|text| {
                text.split_terminator('.')
                    .map(str::trim)
                    .filter(|sentence| sentence.len() > 40)
                    .map(ToOwned::to_owned)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default(),
    );

    let fallback = fallback.trim();
    for piece in pieces {
        let lower = piece.to_ascii_lowercase();
        if lower.contains("grant")
            || lower.contains("funding")
            || lower.contains("opportunity")
            || spec
                .category_hints
                .iter()
                .any(|(needle, _)| lower.contains(needle))
        {
            return Some(piece);
        }
    }

    if fallback.is_empty() {
        None
    } else {
        Some(fallback.to_string())
    }
}

fn extract_first_currency_from_document(
    spec: &web_adapters::WebpageAdapterSpec,
    source: &GrantSourceRecord,
    document: &Html,
) -> Option<i64> {
    let mut text = selector_text(document, "body").unwrap_or_default();
    text.push(' ');
    text.push_str(&meta_content(document, "description").unwrap_or_default());
    text.push(' ');
    text.push_str(&meta_content(document, "og:description").unwrap_or_default());
    if is_high_value_webpage_source(source) {
        text.push(' ');
        text.push_str(
            &extract_text_candidates(
                document,
                &[
                    "main table tr",
                    "article table tr",
                    "section table tr",
                    "main dl dd",
                    "article dl dd",
                ],
                16,
            )
            .join(" "),
        );
        text.push(' ');
        text.push_str(&extract_text_candidates(document, spec.highlight_selectors, 16).join(" "));
    }
    let text = text.replace(',', " ");
    for token in text.split_whitespace() {
        let cleaned = token.trim_matches(|ch: char| !ch.is_ascii_digit() && ch != '$');
        if let Some(amount) = cleaned
            .strip_prefix('$')
            .or_else(|| cleaned.strip_prefix("USD"))
        {
            let amount = amount.trim();
            if let Ok(value) = amount.replace([',', ' '], "").parse::<i64>() {
                return Some(value);
            }
        }
    }
    None
}

fn extract_first_deadline_from_document(
    spec: &web_adapters::WebpageAdapterSpec,
    source: &GrantSourceRecord,
    document: &Html,
) -> Option<String> {
    let mut text = selector_text(document, "body").unwrap_or_default();
    text.push(' ');
    text.push_str(&meta_content(document, "description").unwrap_or_default());
    text.push(' ');
    text.push_str(&meta_content(document, "og:description").unwrap_or_default());
    if is_high_value_webpage_source(source) {
        text.push(' ');
        text.push_str(
            &extract_text_candidates(
                document,
                &[
                    "main table tr",
                    "article table tr",
                    "section table tr",
                    "main dl dd",
                    "article dl dd",
                ],
                16,
            )
            .join(" "),
        );
        text.push(' ');
        text.push_str(&extract_text_candidates(document, spec.highlight_selectors, 16).join(" "));
    }
    let lower = text.to_ascii_lowercase();
    for label in ["due date", "deadline", "application due", "apply by"] {
        if let Some(index) = lower.find(label) {
            let slice = &text[index..];
            let value = slice
                .splitn(2, ':')
                .nth(1)
                .unwrap_or(slice)
                .split_whitespace()
                .take(8)
                .collect::<Vec<_>>()
                .join(" ");
            if !value.trim().is_empty() {
                return Some(
                    value
                        .trim()
                        .trim_matches(|ch: char| ch == '.' || ch == ',')
                        .to_string(),
                );
            }
        }
    }
    None
}

fn extract_webpage_highlights(
    spec: &web_adapters::WebpageAdapterSpec,
    _source: &GrantSourceRecord,
    document: &Html,
    page_title: &str,
    page_description: &str,
    page_context: &str,
    anchor_text: &str,
) -> Vec<String> {
    let mut selectors = spec.highlight_selectors.to_vec();
    selectors.extend([
        "main h2",
        "main h3",
        "article h2",
        "article h3",
        "section h2",
        "section h3",
        "main li",
        "article li",
        "section li",
    ]);
    let mut highlights = Vec::new();
    for selector in selectors {
        let Some(selector) = Selector::parse(selector).ok() else {
            continue;
        };
        for node in document.select(&selector).take(4) {
            let text = normalize_whitespace(&node.text().collect::<Vec<_>>().join(" "))
                .unwrap_or_default();
            if text.len() < 30 {
                continue;
            }
            let lower = text.to_ascii_lowercase();
            if !(lower.contains("grant")
                || lower.contains("funding")
                || lower.contains("opportun")
                || lower.contains("application"))
            {
                continue;
            }
            if !highlights.iter().any(|existing| existing == &text) {
                highlights.push(text);
            }
            if highlights.len() >= 4 {
                break;
            }
        }
        if highlights.len() >= 4 {
            break;
        }
    }

    let context_candidates = [
        page_context.to_string(),
        page_title.to_string(),
        page_description.to_string(),
        anchor_text.to_string(),
    ];
    for candidate in context_candidates {
        let trimmed = candidate.trim();
        if trimmed.len() >= 20
            && !highlights
                .iter()
                .any(|existing| existing.eq_ignore_ascii_case(trimmed))
        {
            highlights.push(trimmed.to_string());
        }
        if highlights.len() >= 4 {
            break;
        }
    }

    highlights.truncate(4);
    highlights
}

fn extract_text_candidates(document: &Html, selectors: &[&str], limit: usize) -> Vec<String> {
    let mut values = Vec::with_capacity(limit);
    for selector in selectors {
        let Some(selector) = Selector::parse(selector).ok() else {
            continue;
        };
        for node in document.select(&selector).take(limit) {
            let text = normalize_whitespace(&node.text().collect::<Vec<_>>().join(" "))
                .unwrap_or_default();
            if text.len() >= 10 && !values.iter().any(|existing| existing == &text) {
                values.push(text);
            }
            if values.len() >= limit {
                return values;
            }
        }
    }
    values
}

fn is_high_value_webpage_source(source: &GrantSourceRecord) -> bool {
    web_adapters::supports_rich_sections_for_source(source)
}

fn compose_webpage_summary(
    page_title: &str,
    page_description: &str,
    page_context: &str,
    excerpt: &str,
    highlights: &[String],
) -> String {
    let mut parts = Vec::new();
    if !page_title.trim().is_empty() {
        parts.push(page_title.trim().to_string());
    }
    if !page_description.trim().is_empty()
        && !parts.iter().any(|value| value == page_description.trim())
    {
        parts.push(page_description.trim().to_string());
    }
    if !page_context.trim().is_empty() && !parts.iter().any(|value| value == page_context.trim()) {
        parts.push(page_context.trim().to_string());
    }
    if !excerpt.trim().is_empty() && !parts.iter().any(|value| value == excerpt.trim()) {
        parts.push(excerpt.trim().to_string());
    }
    if !highlights.is_empty() {
        parts.push(format!("Highlights: {}", highlights.join(" | ")));
    }
    parts.join(" ")
}

fn infer_web_categories(
    spec: &web_adapters::WebpageAdapterSpec,
    source_name: &str,
    page_title: &str,
    excerpt: &str,
) -> Vec<String> {
    let text = format!(
        "{} {} {}",
        source_name.to_ascii_lowercase(),
        page_title.to_ascii_lowercase(),
        excerpt.to_ascii_lowercase()
    );
    let mut categories = Vec::new();
    let mappings = [
        ("education", "Education"),
        ("arts", "Libraries and Arts"),
        ("water", "Environment & Water"),
        ("environment", "Environment & Water"),
        ("justice", "Law, Justice, and Legal Services"),
        ("housing", "Housing, Community and Economic Development"),
        ("community", "Housing, Community and Economic Development"),
        ("transport", "Transportation"),
        ("energy", "Energy"),
        ("health", "Health & Human Services"),
        ("small business", "Employment, Labor & Training"),
        ("nonprofit", "Disadvantaged Communities"),
    ];

    for (needle, label) in mappings {
        if text.contains(needle) && !categories.iter().any(|value| value == label) {
            categories.push(label.to_string());
        }
    }

    for (needle, label) in spec.category_hints {
        if text.contains(needle) && !categories.iter().any(|value| value == label) {
            categories.push((*label).to_string());
        }
    }

    categories
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    const HEADER: &str = "PortalID,GrantID,Status,LastUpdated,ChangeNotes,AgencyDept,Title,Type,LOI,Categories,CategorySuggestion,Purpose,Description,ApplicantType,ApplicantTypeNotes,Geography,FundingSource,FundingSourceNotes,MatchingFunds,MatchingFundsNotes,EstAvailFunds,EstAwards,EstAmounts,FundingMethod,FundingMethodNotes,OpenDate,ApplicationDeadline,AwardPeriod,ExpAwardDate,ElecSubmission,GrantURL,AgencyURL,AgencySubscribeURL,GrantEventsURL,ContactInfo,AwardStats";

    #[test]
    fn parse_grant_csv_strips_bom_and_parses_core_fields() {
        let csv = format!(
            "\u{feff}{}\n171870,GR-1,active,2026-06-12T22:47:04,N/A,CA Department of Education,Grant Title,Grant,Yes,Education; Health,Education,Program purpose,Full description,Nonprofit; Public Agency,N/A,State,State; Federal,notes,Required,match notes,\"$34,000,000\",Dependent,\"$250,000 – $1,900,000\",Reimbursement(s),funding note,2026-06-12T15:41:00,Ongoing,10/01/26 - 09/30/29,10/21/26,url: https://example.com/app,https://grant.example,https://agency.example,https://subscribe.example,https://events.example,name: Jane Doe; email: jane@example.org; tel: 1-800-555-1212;,N/A",
            HEADER
        );

        let grants = parse_grants_csv(csv.as_bytes()).unwrap();
        assert_eq!(grants.len(), 1);
        let grant = &grants[0];
        assert_eq!(grant.portal_id, "171870");
        assert_eq!(grant.grant_id_external.as_deref(), Some("GR-1"));
        assert_eq!(grant.loi_required, true);
        assert_eq!(grant.categories, vec!["Education", "Health"]);
        assert_eq!(grant.applicant_types, vec!["Nonprofit", "Public Agency"]);
        assert_eq!(grant.est_avail_funds_numeric, Some(34000000));
        assert_eq!(grant.est_amount_min, Some(250000));
        assert_eq!(grant.est_amount_max, Some(1900000));
        assert!(grant.deadline_is_ongoing);
        assert_eq!(grant.application_deadline, None);
        assert_eq!(
            grant.elec_submission_url.as_deref(),
            Some("https://example.com/app")
        );
        assert_eq!(grant.contact_name.as_deref(), Some("Jane Doe"));
        assert_eq!(grant.contact_email.as_deref(), Some("jane@example.org"));
        assert_eq!(grant.contact_phone.as_deref(), Some("1-800-555-1212"));
    }

    #[test]
    fn parse_webpage_grants_extracts_grant_like_links() {
        let html = r#"
            <html>
              <head>
                <title>California Grants Portal</title>
                <meta name="description" content="Official grant opportunities and funding notices" />
              </head>
              <body>
                <h1>California Grants Portal</h1>
                <a href="/grants/sample-grant-program/">Sample Grant Program</a>
                <a href="/contact/">Contact</a>
              </body>
            </html>
        "#;
        let source = GrantSourceRecord {
            source_id: "ca-grants-portal-homepage".to_string(),
            name: "California Grants Portal Homepage".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://www.grants.ca.gov/".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: None,
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        };

        let grants = parse_grants_from_webpage_html(html, "https://www.grants.ca.gov/", &source);
        assert_eq!(grants.len(), 1);
        assert!(grants[0].portal_id.starts_with("web-"));
        assert_eq!(
            grants[0].source_kind.as_ref(),
            Some(&GrantSourceKind::Webpage)
        );
        assert_eq!(
            grants[0].grant_url.as_deref(),
            Some("https://www.grants.ca.gov/grants/sample-grant-program/")
        );
    }

    #[test]
    fn parse_webpage_grants_ignores_social_footer_links() {
        let html = r#"
            <html>
              <head>
                <title>California Grants Portal News</title>
                <meta name="description" content="Latest portal updates and announcements" />
              </head>
              <body>
                <h1>California Grants Portal News</h1>
                <a href="https://www.youtube.com/calgrants">Follow us on YouTube</a>
                <a href="https://www.linkedin.com/company/calgrants">Follow us on LinkedIn</a>
                <a href="/grants/funding-opportunity">Funding Opportunity: Example Program</a>
              </body>
            </html>
        "#;
        let source = GrantSourceRecord {
            source_id: "ca-grants-portal-news".to_string(),
            name: "California Grants Portal News".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://www.grants.ca.gov/news/".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: None,
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        };

        let grants =
            parse_grants_from_webpage_html(html, "https://www.grants.ca.gov/news/", &source);
        assert_eq!(grants.len(), 1);
        assert!(grants[0].title.contains("Funding Opportunity"));
        assert_eq!(
            grants[0].grant_url.as_deref(),
            Some("https://www.grants.ca.gov/grants/funding-opportunity")
        );
    }

    #[test]
    fn parse_webpage_grants_skips_generic_news_fallback() {
        let html = r#"
            <html>
              <head>
                <title>California Grants Portal News</title>
                <meta name="description" content="Latest portal updates and announcements" />
              </head>
              <body>
                <h1>California Grants Portal News</h1>
                <a href="/news/a-new-way-to-find-grants/">A New Way to Find Grants</a>
                <a href="/news/your-feedback-in-action/">Your Feedback in Action</a>
              </body>
            </html>
        "#;
        let source = GrantSourceRecord {
            source_id: "ca-grants-portal-news".to_string(),
            name: "California Grants Portal News".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://www.grants.ca.gov/news/".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: None,
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        };

        let grants =
            parse_grants_from_webpage_html(html, "https://www.grants.ca.gov/news/", &source);
        assert!(grants.is_empty());
    }

    #[test]
    fn parse_helpers_handle_na_and_ranges() {
        assert_eq!(normalize_text("N/A"), None);
        assert_eq!(parse_amount(Some("$34,000,000")), Some(34000000));
        assert_eq!(parse_amount_range(Some("Dependent")), (None, None));
        assert_eq!(
            parse_amount_range(Some("$250,000 – $1,900,000")),
            (Some(250000), Some(1900000))
        );
    }

    #[test]
    fn parse_contact_and_list_helpers_split_values() {
        let contact = parse_contact(Some("name: X; email: Y; tel: Z;"));
        assert_eq!(contact.0.as_deref(), Some("X"));
        assert_eq!(contact.1.as_deref(), Some("Y"));
        assert_eq!(contact.2.as_deref(), Some("Z"));
        assert_eq!(
            parse_list(Some("Nonprofit; Public Agency")),
            vec!["Nonprofit", "Public Agency"]
        );
    }

    #[test]
    fn parse_deadline_handles_ongoing() {
        assert_eq!(parse_deadline(Some("Ongoing")), (true, None));
        assert_eq!(
            parse_deadline(Some("2026-08-14T00:00:00")),
            (false, Some("2026-08-14T00:00:00".to_string()))
        );
    }

    #[test]
    fn parse_existing_collection_falls_back_to_key() {
        let payload = serde_json::json!({
            "171870": {
                "title": "Grant Title",
                "status": "active",
                "application_deadline": "2026-08-14"
            }
        });

        let grants = parse_grant_collection(payload);
        assert_eq!(grants.len(), 1);
        assert_eq!(grants[0].portal_id, "171870");
        assert_eq!(grants[0].title, "Grant Title");
    }

    // ── additional CSV parsing ─────────────────────────────────────────────

    #[test]
    fn parse_grant_csv_only_header_returns_empty() {
        let csv = HEADER.as_bytes();
        let grants = parse_grants_csv(csv).unwrap();
        assert!(grants.is_empty());
    }

    #[test]
    fn parse_grant_csv_multiple_rows_returns_all() {
        let row = "171870,GR-1,active,2026-06-12T22:47:04,N/A,CA Dept of Ed,Grant A,Grant,No,Education,,Purpose,Desc,Nonprofit,N/A,State,State,,Not Required,,\"$1,000,000\",Dependent,$50000,Reimbursement,,2026-01-01,2026-08-14,12 months,2026-10-01,url: https://example.com,https://grant.example,,,, ,N/A";
        let row2 = "171871,GR-2,active,2026-06-12T22:47:04,N/A,CA EPA,Grant B,Grant,No,Environment,,Protect water,Full desc,Public Agency,N/A,Statewide,State,,Not Required,,\"$500,000\",10,\"$25,000 – $75,000\",Grant,,2026-02-01,Ongoing,24 months,2027-01-01,,https://epa.example,,,,name: Bob; email: bob@ca.gov;,N/A";
        let csv = format!("{HEADER}\n{row}\n{row2}");
        let grants = parse_grants_csv(csv.as_bytes()).unwrap();
        assert_eq!(grants.len(), 2);
        assert_eq!(grants[0].portal_id, "171870");
        assert_eq!(grants[1].portal_id, "171871");
        assert!(grants[1].deadline_is_ongoing);
    }

    #[test]
    fn parse_amount_returns_none_for_blank() {
        assert_eq!(parse_amount(None), None);
        assert_eq!(parse_amount(Some("")), None);
        assert_eq!(parse_amount(Some("N/A")), None);
        assert_eq!(parse_amount(Some("Dependent")), None);
    }

    #[test]
    fn parse_amount_handles_dollar_amounts() {
        assert_eq!(parse_amount(Some("$1,000")), Some(1000));
        assert_eq!(parse_amount(Some("$34,000,000")), Some(34_000_000));
        assert_eq!(parse_amount(Some("$0")), Some(0));
    }

    #[test]
    fn parse_list_handles_edge_cases() {
        assert!(parse_list(None).is_empty());
        assert!(parse_list(Some("")).is_empty());
        assert!(parse_list(Some("N/A")).is_empty());
        assert_eq!(parse_list(Some("Single")), vec!["Single"]);
        assert_eq!(parse_list(Some("A; B; C")), vec!["A", "B", "C"]);
    }

    #[test]
    fn parse_deadline_handles_various_formats() {
        assert_eq!(parse_deadline(Some("Ongoing")), (true, None));
        assert_eq!(parse_deadline(Some("ongoing")), (true, None));
        assert_eq!(parse_deadline(Some("ONGOING")), (true, None));
        assert_eq!(parse_deadline(None), (false, None));
        assert_eq!(parse_deadline(Some("N/A")), (false, None));
        let (ongoing, deadline) = parse_deadline(Some("2026-12-31T00:00:00"));
        assert!(!ongoing);
        assert!(deadline.is_some());
    }

    #[test]
    fn parse_contact_handles_missing_fields() {
        let (name, email, phone) = parse_contact(None);
        assert!(name.is_none());
        assert!(email.is_none());
        assert!(phone.is_none());

        let (name2, email2, phone2) = parse_contact(Some(""));
        assert!(name2.is_none());
        assert!(email2.is_none());
        assert!(phone2.is_none());
    }

    #[test]
    fn parse_collection_null_value_returns_empty() {
        let grants = parse_grant_collection(serde_json::Value::Null);
        assert!(grants.is_empty());
    }

    #[test]
    fn parse_collection_array_value_returns_empty() {
        let grants = parse_grant_collection(serde_json::json!([]));
        assert!(grants.is_empty());
    }

    // ── security boundary tests ────────────────────────────────────────────

    #[test]
    fn parse_grant_csv_with_xss_in_title_preserves_literal_value() {
        let xss_title = "<script>alert(1)</script>";
        let row = format!("99999,GR-XSS,active,2026-01-01,N/A,Agency,{xss_title},Grant,No,Education,,Purpose,Desc,Nonprofit,N/A,State,State,,Not Required,,$100000,1,$50000,Reimbursement,,2026-01-01,2026-12-31,12 months,2027-01-01,,https://example.com,,,,name: A; email: a@b.com;,N/A");
        let csv = format!("{HEADER}\n{row}");
        let grants = parse_grants_csv(csv.as_bytes()).unwrap();
        assert_eq!(grants.len(), 1);
        assert_eq!(
            grants[0].title, xss_title,
            "XSS payload should be stored literally"
        );
    }

    #[test]
    fn parse_grant_csv_with_sql_injection_in_portal_id_preserves_literal() {
        let injection_id = "'; DROP TABLE grants; --";
        let row = format!("{injection_id},GR-1,active,2026-01-01,N/A,Agency,Title,Grant,No,Education,,Purpose,Desc,Nonprofit,N/A,State,State,,Not Required,,$100000,1,$50000,Reimbursement,,2026-01-01,2026-12-31,12 months,2027-01-01,,https://example.com,,,,name: A; email: a@b.com;,N/A");
        let csv = format!("{HEADER}\n{row}");
        // Should not panic; the injection is just a string in the data
        let grants = parse_grants_csv(csv.as_bytes()).unwrap();
        assert_eq!(grants.len(), 1);
        assert_eq!(grants[0].portal_id, injection_id);
    }

    #[test]
    fn parse_grant_csv_with_path_traversal_in_url_preserves_literal() {
        let traversal_url = "https://example.com/../../../etc/passwd";
        let row = format!("99998,GR-T,active,2026-01-01,N/A,Agency,Title,Grant,No,Education,,Purpose,Desc,Nonprofit,N/A,State,State,,Not Required,,$100000,1,$50000,Reimbursement,,2026-01-01,2026-12-31,12 months,2027-01-01,,{traversal_url},https://agency.example,,,,name: A; email: a@b.com;,N/A");
        let csv = format!("{HEADER}\n{row}");
        let grants = parse_grants_csv(csv.as_bytes()).unwrap();
        assert_eq!(grants.len(), 1);
        assert_eq!(grants[0].grant_url.as_deref(), Some(traversal_url));
    }

    #[test]
    fn parse_contact_with_injection_in_email_preserves_literal() {
        let (name, email, _phone) =
            parse_contact(Some("name: Admin; email: ' OR 1=1; --; tel: 555;"));
        assert_eq!(name.as_deref(), Some("Admin"));
        assert_eq!(email.as_deref(), Some("' OR 1=1"));
    }

    #[test]
    fn parse_grant_csv_with_unicode_characters_does_not_panic() {
        let unicode_title = "Субсидия для 教育 🎓 Förderung";
        let row = format!("11111,GR-U,active,2026-01-01,N/A,Agency,{unicode_title},Grant,No,Education,,Purpose,Desc,Nonprofit,N/A,State,State,,Not Required,,$100000,1,$50000,Reimbursement,,2026-01-01,2026-12-31,12 months,2027-01-01,,https://example.com,,,,name: A; email: a@b.com;,N/A");
        let csv = format!("{HEADER}\n{row}");
        let grants = parse_grants_csv(csv.as_bytes()).unwrap();
        assert_eq!(grants.len(), 1);
        assert_eq!(grants[0].title, unicode_title);
    }

    #[test]
    fn parse_grant_csv_with_very_long_description_does_not_panic() {
        let long_desc = "X".repeat(50_000);
        let row = format!("22222,GR-L,active,2026-01-01,N/A,Agency,Title,Grant,No,Education,,Purpose,{long_desc},Nonprofit,N/A,State,State,,Not Required,,$100000,1,$50000,Reimbursement,,2026-01-01,2026-12-31,12 months,2027-01-01,,https://example.com,,,,name: A; email: a@b.com;,N/A");
        let csv = format!("{HEADER}\n{row}");
        let grants = parse_grants_csv(csv.as_bytes()).unwrap();
        assert_eq!(grants.len(), 1);
        assert!(
            grants[0]
                .description
                .as_deref()
                .map(|d| d.len())
                .unwrap_or(0)
                > 1_000
        );
    }

    #[test]
    fn parse_webpage_grants_absolute_urls_not_doubled() {
        let html = r#"
            <html>
              <head>
                <title>Grants</title>
                <meta name="description" content="Grant opportunities" />
              </head>
              <body>
                <a href="https://external.example.com/grants/my-grant/">External Grant</a>
              </body>
            </html>
        "#;
        let source = GrantSourceRecord {
            source_id: "test".to_string(),
            name: "Test".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://www.grants.ca.gov/".to_string(),
            enabled: true,
            ..Default::default()
        };
        let grants = parse_grants_from_webpage_html(html, "https://www.grants.ca.gov/", &source);
        // External URLs should not be doubled up
        for grant in &grants {
            if let Some(url) = &grant.grant_url {
                assert!(
                    !url.contains("https://https://"),
                    "URL should not be doubled: {url}"
                );
            }
        }
    }

    // ── performance ───────────────────────────────────────────────────────

    #[test]
    fn parse_large_csv_batch_completes_within_budget() {
        // Generate a CSV with 500 rows
        let mut rows = vec![HEADER.to_string()];
        for i in 0..500 {
            rows.push(format!(
                "{i},GR-{i},active,2026-06-12T22:47:04,N/A,Agency {i},Grant Title {i},Grant,No,Education,,Purpose,Description,Nonprofit,N/A,State,State,,Not Required,,$100000,10,$50000,Reimbursement,,2026-01-01,2026-12-31,12 months,2027-01-01,,https://example.com/{i},https://agency.example,,,,name: Contact {i}; email: c{i}@example.com;,N/A"
            ));
        }
        let csv = rows.join("\n");
        let start = std::time::Instant::now();
        let grants = parse_grants_csv(csv.as_bytes()).unwrap();
        let elapsed = start.elapsed();
        assert_eq!(grants.len(), 500);
        assert!(
            elapsed.as_millis() < 500,
            "Parsing 500 CSV rows should complete under 500ms, took {}ms",
            elapsed.as_millis()
        );
    }

    #[test]
    fn parse_amount_range_is_fast() {
        let start = std::time::Instant::now();
        for _ in 0..1_000_000 {
            let _ = parse_amount_range(Some("$250,000 – $1,900,000"));
            let _ = parse_amount_range(Some("Dependent"));
            let _ = parse_amount_range(None);
        }
        // The parser is exercised on hot paths, but this threshold allows for
        // normal workstation and CI variance while still catching regressions.
        assert!(
            start.elapsed().as_millis() < 2500,
            "1M parse_amount_range calls should complete under 2500ms"
        );
    }

    #[tokio::test]
    #[ignore]
    async fn live_california_csv_sync_smoke() {
        let database_url = env::var("GRANT_KEEPER_DEFAULT_FIREBASE_RTD_URL")
            .expect("GRANT_KEEPER_DEFAULT_FIREBASE_RTD_URL must be set");
        let service_account = env::var("GRANT_KEEPER_FIREBASE_SERVICE_ACCOUNT_JSON")
            .expect("GRANT_KEEPER_FIREBASE_SERVICE_ACCOUNT_JSON must be set");
        let token = crate::rtdb::service_account_access_token(service_account)
            .await
            .expect("service account token");
        let client = RealtimeDatabaseClient::new(database_url, Some(token));

        let report = sync_public_grants(&client, DEFAULT_CA_GRANTS_CSV_URL, false)
            .await
            .expect("sync succeeded");
        assert!(report.total_rows > 0);
        assert_eq!(report.total_rows, report.upserted);

        let grants = fetch_grants_from_csv_url(DEFAULT_CA_GRANTS_CSV_URL)
            .await
            .expect("csv fetched");
        let sample = grants.first().expect("at least one grant");

        let stored = client
            .get_json(&db::grant_path(&sample.portal_id))
            .await
            .expect("stored grant fetched");
        let stored = parse_grant_value_for_key(sample.portal_id.clone(), stored)
            .expect("stored grant parsed");
        assert_eq!(stored.portal_id, sample.portal_id);
        assert!(!stored.title.trim().is_empty());
        assert!(stored.updated_at.is_some());
    }
}
