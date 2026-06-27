export type LocalConfig = {
  firebase_rtdb_url: string | null;
  firebase_web_api_key: string | null;
  firebase_auth_domain: string | null;
  anthropic_api_key: string | null;
  background_refresh_interval_ms: number | null;
  draft_generation_preference: "local_scaffold" | "ai";
  firebase_uid: string | null;
  organization_uid: string | null;
  setup_complete: boolean;
  last_sync_at: string | null;
};

export type FirebaseSession = {
  email: string;
  uid: string;
  id_token: string;
  refresh_token: string;
  expires_at: string;
};

export type SessionMode = "none" | "firebase" | "workspace_profile" | "dev_profile";

export type StartupState = "needs_workspace" | "needs_login" | "needs_membership" | "ready" | "dev_profile_ready";

export type SessionState = {
  signed_in: boolean;
  mode: SessionMode;
  email: string | null;
  uid: string | null;
  expires_at: string | null;
};

export type AppSnapshot = {
  config: LocalConfig;
  session: SessionState;
  startup_state: StartupState;
  ready_for_setup: boolean;
  current_org_uid: string | null;
  organization_uid: string | null;
  workspace_bootstrap: WorkspaceBootstrapContract;
};

export type SetupValidation = {
  ready: boolean;
  missing_fields: string[];
  signed_in: boolean;
  session_mode: SessionMode;
  workspace_ready: boolean;
  dev_profile_ready: boolean;
};

export type ConfigUpdate = {
  firebase_rtdb_url?: string | null;
  firebase_web_api_key?: string | null;
  firebase_auth_domain?: string | null;
  anthropic_api_key?: string | null;
  background_refresh_interval_ms?: number | null;
  draft_generation_preference?: "local_scaffold" | "ai" | null;
  firebase_uid?: string | null;
  organization_uid?: string | null;
  setup_complete?: boolean | null;
  last_sync_at?: string | null;
};

export type EmailPasswordSignIn = {
  email: string;
  password: string;
};

export type EmailPasswordSignUp = {
  email: string;
  password: string;
};

export type AppCommandError = {
  code?: string | null;
  message: string;
  detail?: string | null;
  retryable?: boolean | null;
  requires_reauth?: boolean | null;
  service?: string | null;
};

export type WorkspaceCreateRequest = {
  email: string;
  password: string;
  organization_name: string;
  workspace_code?: string | null;
};

export type WorkspaceJoinRequest = {
  email: string;
  password: string;
  workspace_code?: string | null;
  invite_token?: string | null;
};

export type WorkspaceInviteRecord = {
  invite_token: string;
  organization_uid: string;
  organization_name?: string | null;
  role: string;
  created_by_uid: string;
  created_by_email: string;
  created_at?: string | null;
  claimed_by_uid?: string | null;
  claimed_by_email?: string | null;
  claimed_at?: string | null;
  active: boolean;
};

export type WorkspaceBootstrapStageId = "create_or_join" | "confirm_ready" | "workspace_home";

export type WorkspaceBootstrapStage = {
  id: WorkspaceBootstrapStageId;
  title: string;
  description: string;
};

export type WorkspaceBootstrapContract = {
  join_model: "self_serve_account_and_workspace";
  required_inputs: Array<"email" | "password" | "organization_name_or_workspace_code">;
  identity_boundary: {
    session_key: "firebase_uid";
    data_key: "organization_uid";
  };
  screens: WorkspaceBootstrapStage[];
};

export type GrantIngestReport = {
  source_id: string | null;
  source_name: string | null;
  source_kind: "csv" | "json" | "webpage";
  source_url: string;
  total_rows: number;
  upserted: number;
  closed_missing: number;
};

export type GrantSourceRecord = {
  source_id: string;
  source_family?: string | null;
  canonical_source_id?: string | null;
  name: string;
  kind: "csv" | "json" | "webpage";
  url: string;
  enabled: boolean;
  jurisdiction?: string | null;
  notes?: string | null;
  last_run_at?: string | null;
  last_status?: string | null;
  last_error?: string | null;
};

export type GrantSourceHealthStatus =
  | "unknown"
  | "healthy"
  | "bad_source"
  | "blocked"
  | "stale"
  | "low_yield"
  | "failing"
  | "pending_adapter";

export type GrantSourceHealthRecord = {
  source_id: string;
  source_family?: string | null;
  canonical_source_id?: string | null;
  name: string;
  kind: "csv" | "json" | "webpage";
  url: string;
  enabled: boolean;
  jurisdiction?: string | null;
  last_run_at?: string | null;
  last_status?: string | null;
  last_error?: string | null;
  grant_count: number;
  health_status: GrantSourceHealthStatus;
  health_note?: string | null;
};

export type AppHealthSnapshot = {
  setup: SetupValidation | null;
  sources: GrantSourceHealthRecord[];
  sync: GrantSourceSyncOutcome[] | null;
  snapshot: AppSnapshot | null;
  config: LocalConfig | null;
  last_checked_at: string;
};

export type GrantSourceSyncOutcome = {
  source_id: string;
  source_name: string;
  success: boolean;
  report?: GrantIngestReport | null;
  error?: string | null;
};

export type GrantSummary = {
  portal_id: string;
  title: string;
  agency_dept?: string | null;
  status?: string | null;
  deadline?: string | null;
};

export type GrantRecord = GrantSummary & {
  grant_id_external?: string | null;
  last_updated_source?: string | null;
  change_notes?: string | null;
  grant_type?: string | null;
  loi_required: boolean;
  categories: string[];
  category_suggestion?: string | null;
  purpose?: string | null;
  description?: string | null;
  source_page_title?: string | null;
  source_page_description?: string | null;
  source_excerpt?: string | null;
  source_highlights: string[];
  applicant_types: string[];
  applicant_type_notes?: string | null;
  geography?: string | null;
  funding_source?: string | null;
  funding_source_notes?: string | null;
  matching_funds?: string | null;
  matching_funds_notes?: string | null;
  est_avail_funds?: string | null;
  est_avail_funds_numeric?: number | null;
  est_awards?: string | null;
  est_amounts?: string | null;
  est_amount_min?: number | null;
  est_amount_max?: number | null;
  funding_method?: string | null;
  funding_method_notes?: string | null;
  open_date?: string | null;
  application_deadline?: string | null;
  deadline_is_ongoing: boolean;
  award_period?: string | null;
  exp_award_date?: string | null;
  elec_submission_url?: string | null;
  grant_url?: string | null;
  agency_url?: string | null;
  agency_subscribe_url?: string | null;
  grant_events_url?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  award_stats?: string | null;
  organization_uid?: string | null;
  source_id?: string | null;
  source_family?: string | null;
  canonical_source_id?: string | null;
  source_name?: string | null;
  source_kind?: "csv" | "json" | "webpage" | null;
  source_url?: string | null;
  source_record_key?: string | null;
  source_jurisdiction?: string | null;
  updated_at?: string | null;
};

export type DraftSummary = {
  draft_id: string;
  grant_portal_id: string;
  status: string;
  version: number;
  generation_mode: "unknown" | "ai" | "local_scaffold" | "manual";
  provenance_note?: string | null;
};

export type DraftRecord = DraftSummary & {
  section_org_overview?: string | null;
  section_need_statement?: string | null;
  section_project_description?: string | null;
  section_goals_objectives?: string | null;
  section_implementation_plan?: string | null;
  section_evaluation_plan?: string | null;
  section_budget_narrative?: string | null;
  section_sustainability?: string | null;
  section_org_capacity?: string | null;
  section_loi_text?: string | null;
  ai_model_used?: string | null;
  ai_prompt_version?: number | null;
  generation_tokens?: number | null;
  user_edited?: boolean;
  provenance_org_uid?: string | null;
  scaffold_template_version?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  title?: string | null;
  body?: string | null;
  notes?: string | null;
};

export type DraftFieldKey =
  | "section_org_overview"
  | "section_need_statement"
  | "section_project_description"
  | "section_goals_objectives"
  | "section_implementation_plan"
  | "section_evaluation_plan"
  | "section_budget_narrative"
  | "section_sustainability"
  | "section_org_capacity"
  | "section_loi_text";

export type DraftFieldSchema = {
  key: DraftFieldKey;
  label: string;
  placeholder: string;
  helper: string;
  required: boolean;
  visible: boolean;
};

export type GrantDraftSchema = {
  schema_id: string;
  schema_name: string;
  source_family: string;
  source_kind: "csv" | "json" | "webpage" | "unknown";
  section_count: number;
  required_sections: number;
  optional_sections: number;
  has_loi_section: boolean;
  matching_funds_required: boolean;
  categories: string[];
  sections: DraftFieldSchema[];
};

export type WatchlistEntry = {
  portal_id: string;
  saved: boolean;
  note?: string | null;
  updated_at?: string | null;
};

export type OrganizationSummary = {
  uid: string;
  name?: string | null;
  city?: string | null;
  state?: string | null;
};

export type OrganizationRecord = OrganizationSummary & {
  ein?: string | null;
  ntee_code?: string | null;
  irc_status?: string | null;
  mission?: string | null;
  founded_year?: number | null;
  address?: string | null;
  zip?: string | null;
  website?: string | null;
  phone?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  annual_budget?: number | null;
  staff_count?: number | null;
  volunteer_count?: number | null;
  service_area?: string | null;
  target_population?: string | null;
  programs?: OrganizationProgram[];
  description?: string | null;
  updated_at?: string | null;
};

export type OrganizationProgram = {
  name: string;
  description?: string | null;
  budget?: number | null;
};
