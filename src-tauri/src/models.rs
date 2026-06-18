use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default)]
pub struct LocalConfig {
    pub firebase_rtdb_url: Option<String>,
    pub firebase_web_api_key: Option<String>,
    pub firebase_auth_domain: Option<String>,
    pub anthropic_api_key: Option<String>,
    pub background_refresh_interval_ms: Option<u32>,
    pub draft_generation_preference: DraftGenerationPreference,
    pub firebase_uid: Option<String>,
    pub organization_uid: Option<String>,
    pub setup_complete: bool,
    pub last_sync_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FirebaseSession {
    pub email: String,
    pub uid: String,
    pub id_token: String,
    pub refresh_token: String,
    pub expires_at: DateTime<Utc>,
}

impl FirebaseSession {
    pub fn is_expiring_soon(&self) -> bool {
        self.expires_at <= Utc::now() + chrono::Duration::minutes(5)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SessionMode {
    #[default]
    None,
    Firebase,
    WorkspaceProfile,
    DevProfile,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DraftGenerationPreference {
    #[default]
    LocalScaffold,
    Ai,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GrantSourceKind {
    #[default]
    Csv,
    Json,
    Webpage,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GrantSourceHealthStatus {
    #[default]
    Unknown,
    Healthy,
    BadSource,
    Blocked,
    Stale,
    LowYield,
    Failing,
    PendingAdapter,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default)]
pub struct GrantSourceHealthRecord {
    pub source_id: String,
    pub source_family: Option<String>,
    pub canonical_source_id: Option<String>,
    pub name: String,
    pub kind: GrantSourceKind,
    pub url: String,
    pub enabled: bool,
    pub jurisdiction: Option<String>,
    pub last_run_at: Option<DateTime<Utc>>,
    pub last_status: Option<String>,
    pub last_error: Option<String>,
    pub grant_count: usize,
    pub health_status: GrantSourceHealthStatus,
    pub health_note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default)]
pub struct GrantSourceSyncOutcome {
    pub source_id: String,
    pub source_name: String,
    pub success: bool,
    pub report: Option<crate::ingest::GrantIngestReport>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default)]
pub struct GrantSourceRecord {
    pub source_id: String,
    pub source_family: Option<String>,
    pub canonical_source_id: Option<String>,
    pub name: String,
    pub kind: GrantSourceKind,
    pub url: String,
    pub enabled: bool,
    pub jurisdiction: Option<String>,
    pub notes: Option<String>,
    pub last_run_at: Option<DateTime<Utc>>,
    pub last_status: Option<String>,
    pub last_error: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default)]
pub struct GrantSummary {
    pub portal_id: String,
    pub title: String,
    pub agency_dept: Option<String>,
    pub status: Option<String>,
    pub deadline: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default)]
pub struct GrantRecord {
    pub portal_id: String,
    pub grant_id_external: Option<String>,
    pub status: Option<String>,
    pub last_updated_source: Option<String>,
    pub change_notes: Option<String>,
    pub title: String,
    pub agency_dept: Option<String>,
    pub grant_type: Option<String>,
    pub loi_required: bool,
    pub categories: Vec<String>,
    pub category_suggestion: Option<String>,
    pub purpose: Option<String>,
    pub description: Option<String>,
    pub source_page_title: Option<String>,
    pub source_page_description: Option<String>,
    pub source_excerpt: Option<String>,
    pub source_highlights: Vec<String>,
    pub applicant_types: Vec<String>,
    pub applicant_type_notes: Option<String>,
    pub geography: Option<String>,
    pub funding_source: Option<String>,
    pub funding_source_notes: Option<String>,
    pub matching_funds: Option<String>,
    pub matching_funds_notes: Option<String>,
    pub est_avail_funds: Option<String>,
    pub est_avail_funds_numeric: Option<i64>,
    pub est_awards: Option<String>,
    pub est_amounts: Option<String>,
    pub est_amount_min: Option<i64>,
    pub est_amount_max: Option<i64>,
    pub funding_method: Option<String>,
    pub funding_method_notes: Option<String>,
    pub open_date: Option<String>,
    pub application_deadline: Option<String>,
    pub deadline_is_ongoing: bool,
    pub award_period: Option<String>,
    pub exp_award_date: Option<String>,
    pub elec_submission_url: Option<String>,
    pub grant_url: Option<String>,
    pub agency_url: Option<String>,
    pub agency_subscribe_url: Option<String>,
    pub grant_events_url: Option<String>,
    pub contact_name: Option<String>,
    pub contact_email: Option<String>,
    pub contact_phone: Option<String>,
    pub award_stats: Option<String>,
    pub organization_uid: Option<String>,
    pub source_id: Option<String>,
    pub source_family: Option<String>,
    pub canonical_source_id: Option<String>,
    pub source_name: Option<String>,
    pub source_kind: Option<GrantSourceKind>,
    pub source_url: Option<String>,
    pub source_record_key: Option<String>,
    pub source_jurisdiction: Option<String>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default)]
pub struct OrganizationRecord {
    pub uid: String,
    pub name: Option<String>,
    pub ein: Option<String>,
    pub ntee_code: Option<String>,
    pub irc_status: Option<String>,
    pub mission: Option<String>,
    pub founded_year: Option<i32>,
    pub address: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub zip: Option<String>,
    pub website: Option<String>,
    pub phone: Option<String>,
    pub contact_name: Option<String>,
    pub contact_email: Option<String>,
    pub annual_budget: Option<i64>,
    pub staff_count: Option<i64>,
    pub volunteer_count: Option<i64>,
    pub service_area: Option<String>,
    pub target_population: Option<String>,
    pub programs: Vec<OrganizationProgram>,
    pub description: Option<String>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default)]
pub struct OrganizationProgram {
    pub name: String,
    pub description: Option<String>,
    pub budget: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default)]
pub struct WorkspaceMembershipRecord {
    pub firebase_uid: String,
    pub email: String,
    pub organization_uid: String,
    pub role: String,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default)]
pub struct DraftSummary {
    pub draft_id: String,
    pub grant_portal_id: String,
    pub status: String,
    pub version: u32,
    pub generation_mode: DraftGenerationMode,
    pub provenance_note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DraftGenerationMode {
    #[default]
    Unknown,
    Ai,
    LocalScaffold,
    Manual,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default)]
pub struct DraftRecord {
    pub draft_id: String,
    pub grant_portal_id: String,
    pub status: String,
    pub version: u32,
    pub section_org_overview: Option<String>,
    pub section_need_statement: Option<String>,
    pub section_project_description: Option<String>,
    pub section_goals_objectives: Option<String>,
    pub section_implementation_plan: Option<String>,
    pub section_evaluation_plan: Option<String>,
    pub section_budget_narrative: Option<String>,
    pub section_sustainability: Option<String>,
    pub section_org_capacity: Option<String>,
    pub section_loi_text: Option<String>,
    pub ai_model_used: Option<String>,
    pub ai_prompt_version: Option<u32>,
    pub generation_tokens: Option<u32>,
    pub user_edited: bool,
    pub generation_mode: DraftGenerationMode,
    pub provenance_org_uid: Option<String>,
    pub provenance_note: Option<String>,
    pub scaffold_template_version: Option<u32>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
    pub title: Option<String>,
    pub body: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default)]
pub struct WatchlistEntry {
    pub portal_id: String,
    pub saved: bool,
    pub note: Option<String>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default)]
pub struct SessionState {
    pub signed_in: bool,
    pub mode: SessionMode,
    pub email: Option<String>,
    pub uid: Option<String>,
    pub expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default)]
pub struct AppSnapshot {
    pub config: LocalConfig,
    pub session: SessionState,
    pub startup_state: StartupState,
    pub ready_for_setup: bool,
    pub current_org_uid: Option<String>,
    pub organization_uid: Option<String>,
    pub workspace_bootstrap: WorkspaceBootstrapContract,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StartupState {
    #[default]
    NeedsWorkspace,
    NeedsLogin,
    NeedsMembership,
    Ready,
    DevProfileReady,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default)]
pub struct SetupValidation {
    pub ready: bool,
    pub missing_fields: Vec<String>,
    pub signed_in: bool,
    pub session_mode: SessionMode,
    pub workspace_ready: bool,
    pub dev_profile_ready: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default)]
pub struct ConfigUpdate {
    pub firebase_rtdb_url: Option<String>,
    pub firebase_web_api_key: Option<String>,
    pub firebase_auth_domain: Option<String>,
    pub anthropic_api_key: Option<String>,
    pub background_refresh_interval_ms: Option<u32>,
    pub draft_generation_preference: Option<DraftGenerationPreference>,
    pub firebase_uid: Option<String>,
    pub organization_uid: Option<String>,
    pub setup_complete: Option<bool>,
    pub last_sync_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(default)]
pub struct WorkspaceStartRequest {
    pub email: String,
    pub organization_name: String,
    pub workspace_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default)]
pub struct WorkspaceBootstrapContract {
    pub join_model: String,
    pub required_inputs: Vec<String>,
    pub identity_boundary_session_key: String,
    pub identity_boundary_data_key: String,
    pub screens: Vec<WorkspaceBootstrapStage>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default)]
pub struct WorkspaceBootstrapStage {
    pub id: String,
    pub title: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EmailPasswordSignIn {
    pub email: String,
    pub password: String,
}

impl Default for EmailPasswordSignIn {
    fn default() -> Self {
        Self {
            email: String::new(),
            password: String::new(),
        }
    }
}

impl From<GrantRecord> for GrantSummary {
    fn from(value: GrantRecord) -> Self {
        let deadline = if value.deadline_is_ongoing {
            Some("Ongoing".to_string())
        } else {
            value.application_deadline.clone()
        };
        Self {
            portal_id: value.portal_id,
            title: value.title,
            agency_dept: value.agency_dept,
            status: value.status,
            deadline,
        }
    }
}

impl From<&GrantRecord> for GrantSummary {
    fn from(value: &GrantRecord) -> Self {
        let deadline = if value.deadline_is_ongoing {
            Some("Ongoing".to_string())
        } else {
            value.application_deadline.clone()
        };
        Self {
            portal_id: value.portal_id.clone(),
            title: value.title.clone(),
            agency_dept: value.agency_dept.clone(),
            status: value.status.clone(),
            deadline,
        }
    }
}

impl From<DraftRecord> for DraftSummary {
    fn from(value: DraftRecord) -> Self {
        Self {
            draft_id: value.draft_id,
            grant_portal_id: value.grant_portal_id,
            status: value.status,
            version: value.version,
            generation_mode: value.generation_mode,
            provenance_note: value.provenance_note,
        }
    }
}

impl From<&DraftRecord> for DraftSummary {
    fn from(value: &DraftRecord) -> Self {
        Self {
            draft_id: value.draft_id.clone(),
            grant_portal_id: value.grant_portal_id.clone(),
            status: value.status.clone(),
            version: value.version,
            generation_mode: value.generation_mode.clone(),
            provenance_note: value.provenance_note.clone(),
        }
    }
}
