use crate::{
    ai, db, draft_schema, ingest,
    models::{
        AppSnapshot, ConfigUpdate, DraftRecord, DraftSummary, EmailPasswordSignIn,
        EmailPasswordSignUp, FirebaseSession,
        GrantRecord, GrantSourceHealthRecord, GrantSourceRecord, GrantSourceSyncOutcome,
        LocalConfig, OrganizationRecord, SetupValidation, WatchlistEntry, WorkspaceCreateRequest,
        WorkspaceInviteRecord, WorkspaceJoinRequest,
    },
    state::AppState,
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use std::process::Command as StdCommand;
use tauri::State;
use tokio::process::Command;

#[tauri::command]
pub async fn get_app_snapshot(state: State<'_, AppState>) -> Result<AppSnapshot, String> {
    Ok(state.snapshot().await)
}

#[tauri::command]
pub async fn get_local_config(state: State<'_, AppState>) -> Result<LocalConfig, String> {
    Ok(state.config().await)
}

#[tauri::command]
pub async fn update_local_config(
    state: State<'_, AppState>,
    update: ConfigUpdate,
) -> Result<LocalConfig, String> {
    state.update_config(update).await.map_err(error_string)
}

#[tauri::command]
pub async fn sign_in_with_email_password(
    state: State<'_, AppState>,
    request: EmailPasswordSignIn,
) -> Result<FirebaseSession, String> {
    state
        .sign_in_with_email_password(request)
        .await
        .map_err(error_string)
}

#[tauri::command]
pub async fn sign_up_with_email_password(
    state: State<'_, AppState>,
    request: EmailPasswordSignUp,
) -> Result<FirebaseSession, String> {
    state
        .sign_up_with_email_password(request)
        .await
        .map_err(error_string)
}

#[tauri::command]
pub async fn start_dev_profile(state: State<'_, AppState>) -> Result<FirebaseSession, String> {
    state.start_dev_profile().await.map_err(error_string)
}

#[tauri::command]
pub async fn create_workspace_account(
    state: State<'_, AppState>,
    request: WorkspaceCreateRequest,
) -> Result<FirebaseSession, String> {
    state
        .create_workspace_account(request)
        .await
        .map_err(error_string)
}

#[tauri::command]
pub async fn sign_in_to_workspace(
    state: State<'_, AppState>,
    request: WorkspaceJoinRequest,
) -> Result<FirebaseSession, String> {
    state
        .sign_in_to_workspace(request)
        .await
        .map_err(error_string)
}

#[tauri::command]
pub async fn sign_up_to_join_workspace(
    state: State<'_, AppState>,
    request: WorkspaceJoinRequest,
) -> Result<FirebaseSession, String> {
    state
        .sign_up_to_join_workspace(request)
        .await
        .map_err(error_string)
}

#[tauri::command]
pub async fn create_workspace_invite(
    state: State<'_, AppState>,
) -> Result<WorkspaceInviteRecord, String> {
    state.create_workspace_invite().await.map_err(error_string)
}

#[tauri::command]
pub async fn refresh_session(
    state: State<'_, AppState>,
) -> Result<Option<FirebaseSession>, String> {
    let auth = state.firebase_auth_client().await.map_err(error_string)?;
    state
        .ensure_valid_session(&auth)
        .await
        .map_err(error_string)
}

#[tauri::command]
pub async fn send_password_reset_email(
    state: State<'_, AppState>,
    email: String,
) -> Result<(), String> {
    state
        .send_password_reset_email(email.trim())
        .await
        .map_err(error_string)
}

#[tauri::command]
pub async fn validate_anthropic_api_key(api_key: String) -> Result<(), String> {
    let client = ai::AnthropicClient::new(api_key);
    client.validate_api_key().await.map_err(error_string)
}

#[tauri::command]
pub async fn clear_session(state: State<'_, AppState>) -> Result<(), String> {
    state.clear_session().await.map_err(error_string)
}

#[tauri::command]
pub async fn validate_setup(state: State<'_, AppState>) -> Result<SetupValidation, String> {
    Ok(state.validate_setup().await)
}

#[tauri::command]
pub async fn list_grant_sources(
    state: State<'_, AppState>,
) -> Result<Vec<GrantSourceRecord>, String> {
    state.grant_sources().await.map_err(error_string)
}

#[tauri::command]
pub async fn list_grant_source_health(
    state: State<'_, AppState>,
) -> Result<Vec<GrantSourceHealthRecord>, String> {
    state.grant_source_health().await.map_err(error_string)
}

#[tauri::command]
pub async fn upsert_grant_source(
    state: State<'_, AppState>,
    source: GrantSourceRecord,
) -> Result<GrantSourceRecord, String> {
    state
        .upsert_grant_source(source)
        .await
        .map_err(error_string)
}

#[tauri::command]
pub async fn delete_grant_source(
    state: State<'_, AppState>,
    source_id: String,
) -> Result<(), String> {
    state
        .delete_grant_source(&source_id)
        .await
        .map_err(error_string)
}

#[tauri::command]
pub async fn sync_grant_source(
    state: State<'_, AppState>,
    source_id: String,
    mark_missing_closed: Option<bool>,
) -> Result<ingest::GrantIngestReport, String> {
    state
        .sync_grant_source(&source_id, mark_missing_closed.unwrap_or(false))
        .await
        .map_err(error_string)
}

#[tauri::command]
pub async fn sync_enabled_grant_sources(
    state: State<'_, AppState>,
    mark_missing_closed: Option<bool>,
) -> Result<Vec<GrantSourceSyncOutcome>, String> {
    state
        .sync_enabled_grant_sources(mark_missing_closed.unwrap_or(false))
        .await
        .map_err(error_string)
}

#[tauri::command]
pub async fn list_grants(state: State<'_, AppState>) -> Result<Vec<GrantRecord>, String> {
    state.grant_catalog().await.map_err(error_string)
}

#[tauri::command]
pub async fn get_grant(
    state: State<'_, AppState>,
    portal_id: String,
) -> Result<Option<GrantRecord>, String> {
    state.grant_record(&portal_id).await.map_err(error_string)
}

#[tauri::command]
pub async fn upsert_grant(
    state: State<'_, AppState>,
    grant: GrantRecord,
) -> Result<GrantRecord, String> {
    let client = state.rtdb_client().await.map_err(error_string)?;
    let normalized = ingest::normalize_grant_for_write(grant).map_err(error_string)?;
    client
        .put_json(&db::grant_path(&normalized.portal_id), &normalized)
        .await
        .map_err(error_string)?;
    state.invalidate_grant_cache().await;
    Ok(normalized)
}

#[tauri::command]
pub async fn delete_grant(state: State<'_, AppState>, portal_id: String) -> Result<(), String> {
    let client = state.rtdb_client().await.map_err(error_string)?;
    client
        .delete(&db::grant_path(&portal_id))
        .await
        .map_err(error_string)?;
    state.invalidate_grant_cache().await;
    Ok(())
}

#[tauri::command]
pub async fn sync_public_grants(
    state: State<'_, AppState>,
    source_url: Option<String>,
    mark_missing_closed: Option<bool>,
) -> Result<ingest::GrantIngestReport, String> {
    let client = state.rtdb_service_client().await.map_err(error_string)?;
    let source_url = source_url.unwrap_or_else(|| ingest::DEFAULT_CA_GRANTS_CSV_URL.to_string());
    let report =
        ingest::sync_public_grants(&client, &source_url, mark_missing_closed.unwrap_or(false))
            .await
            .map_err(error_string)?;
    state.invalidate_grant_cache().await;
    state
        .update_config(crate::models::ConfigUpdate {
            last_sync_at: Some(Utc::now()),
            ..Default::default()
        })
        .await
        .map_err(error_string)?;
    Ok(report)
}

#[tauri::command]
pub async fn list_organization(
    state: State<'_, AppState>,
) -> Result<Option<OrganizationRecord>, String> {
    let uid = state
        .require_workspace_access()
        .await
        .map_err(error_string)?;
    load_organization_record(&state, &uid).await
}

#[tauri::command]
pub async fn upsert_organization(
    state: State<'_, AppState>,
    organization: OrganizationRecord,
) -> Result<OrganizationRecord, String> {
    let uid = state
        .require_workspace_access()
        .await
        .map_err(error_string)?;
    let client = state.rtdb_client().await.map_err(error_string)?;
    let normalized = normalize_organization_write(uid, organization)?;
    client
        .put_json(&db::organization_path(&normalized.uid), &normalized)
        .await
        .map_err(error_string)?;
    Ok(normalized)
}

#[tauri::command]
pub async fn delete_organization(state: State<'_, AppState>) -> Result<(), String> {
    let uid = state
        .require_workspace_access()
        .await
        .map_err(error_string)?;
    let client = state.rtdb_client().await.map_err(error_string)?;
    client
        .delete(&db::organization_path(&uid))
        .await
        .map_err(error_string)
}

#[tauri::command]
pub async fn list_watchlist(state: State<'_, AppState>) -> Result<Vec<WatchlistEntry>, String> {
    let uid = state
        .require_workspace_access()
        .await
        .map_err(error_string)?;
    load_watchlist_collection(&state, &uid).await
}

#[tauri::command]
pub async fn upsert_watchlist_entry(
    state: State<'_, AppState>,
    entry: WatchlistEntry,
) -> Result<WatchlistEntry, String> {
    let uid = state
        .require_workspace_access()
        .await
        .map_err(error_string)?;
    let client = state.rtdb_client().await.map_err(error_string)?;
    let normalized = normalize_watchlist_write(entry)?;
    client
        .put_json(
            &db::watchlist_entry_path(&uid, &normalized.portal_id),
            &normalized,
        )
        .await
        .map_err(error_string)?;
    Ok(normalized)
}

#[tauri::command]
pub async fn delete_watchlist_entry(
    state: State<'_, AppState>,
    portal_id: String,
) -> Result<(), String> {
    let uid = state
        .require_workspace_access()
        .await
        .map_err(error_string)?;
    let client = state.rtdb_client().await.map_err(error_string)?;
    client
        .delete(&db::watchlist_entry_path(&uid, &portal_id))
        .await
        .map_err(error_string)
}

#[tauri::command]
pub async fn list_drafts(state: State<'_, AppState>) -> Result<Vec<DraftSummary>, String> {
    let uid = state
        .require_workspace_access()
        .await
        .map_err(error_string)?;
    load_draft_collection(&state, &uid).await
}

#[tauri::command]
pub async fn get_draft(
    state: State<'_, AppState>,
    draft_id: String,
) -> Result<Option<DraftRecord>, String> {
    let uid = state
        .require_workspace_access()
        .await
        .map_err(error_string)?;
    let client = state.rtdb_client().await.map_err(error_string)?;
    let payload = client
        .get_json(&db::draft_path(&uid, &draft_id))
        .await
        .map_err(error_string)?;
    Ok(match payload {
        Value::Null => None,
        value => Some(normalize_draft(draft_id, value)?),
    })
}

#[tauri::command]
pub async fn upsert_draft(
    state: State<'_, AppState>,
    draft: DraftRecord,
) -> Result<DraftRecord, String> {
    let uid = state
        .require_workspace_access()
        .await
        .map_err(error_string)?;
    let client = state.rtdb_client().await.map_err(error_string)?;
    let normalized = normalize_draft_write(draft)?;
    client
        .put_json(&db::draft_path(&uid, &normalized.draft_id), &normalized)
        .await
        .map_err(error_string)?;
    Ok(normalized)
}

#[tauri::command]
pub async fn generate_draft(
    state: State<'_, AppState>,
    grant_portal_id: String,
) -> Result<DraftRecord, String> {
    let org_uid = state
        .require_workspace_access()
        .await
        .map_err(error_string)?;
    let grant_fut = load_grant_record(&state, &grant_portal_id);
    let organization_fut = load_organization_record(&state, &org_uid);
    let (grant, organization) = tokio::try_join!(grant_fut, organization_fut)?;
    let organization = organization.ok_or_else(|| format!("organization {org_uid} not found"))?;
    let client = state.rtdb_client().await.map_err(error_string)?;

    let config = state.config().await;
    let api_key = config.anthropic_api_key.unwrap_or_default();
    if matches!(
        config.draft_generation_preference,
        crate::models::DraftGenerationPreference::LocalScaffold
    ) || api_key.trim().is_empty()
    {
        let generated = build_local_draft_scaffold(&grant, &organization);
        client
            .put_json(&db::draft_path(&org_uid, &generated.draft_id), &generated)
            .await
            .map_err(error_string)?;
        return Ok(generated);
    }

    let missing_org = ai::missing_org_fields_for_generation(&organization);
    if !missing_org.is_empty() {
        return Err(format!(
            "organization is missing required fields: {}",
            missing_org.join(", ")
        ));
    }

    let missing_grant = ai::missing_grant_fields_for_generation(&grant);
    if !missing_grant.is_empty() {
        return Err(format!(
            "grant is missing required fields: {}",
            missing_grant.join(", ")
        ));
    }

    let prompt_bundle = ai::build_draft_prompt_bundle(&grant, &organization);
    let llm_client = ai::AnthropicClient::new(api_key);

    let (
        org_overview,
        need_statement,
        project_description,
        goals_objectives,
        implementation_plan,
        evaluation_plan,
        budget_narrative,
        sustainability,
        org_capacity,
    ) = tokio::try_join!(
        llm_client.generate_section(
            &prompt_bundle.system_prompt,
            &prompt_bundle.section_org_overview,
        ),
        llm_client.generate_section(
            &prompt_bundle.system_prompt,
            &prompt_bundle.section_need_statement,
        ),
        llm_client.generate_section(
            &prompt_bundle.system_prompt,
            &prompt_bundle.section_project_description,
        ),
        llm_client.generate_section(
            &prompt_bundle.system_prompt,
            &prompt_bundle.section_goals_objectives,
        ),
        llm_client.generate_section(
            &prompt_bundle.system_prompt,
            &prompt_bundle.section_implementation_plan,
        ),
        llm_client.generate_section(
            &prompt_bundle.system_prompt,
            &prompt_bundle.section_evaluation_plan,
        ),
        llm_client.generate_section(
            &prompt_bundle.system_prompt,
            &prompt_bundle.section_budget_narrative,
        ),
        llm_client.generate_section(
            &prompt_bundle.system_prompt,
            &prompt_bundle.section_sustainability,
        ),
        llm_client.generate_section(
            &prompt_bundle.system_prompt,
            &prompt_bundle.section_org_capacity,
        ),
    )
    .map_err(error_string)?;
    let mut section_budget_tokens: u32 = [
        &org_overview,
        &need_statement,
        &project_description,
        &goals_objectives,
        &implementation_plan,
        &evaluation_plan,
        &budget_narrative,
        &sustainability,
        &org_capacity,
    ]
    .into_iter()
    .fold(0u32, |acc, generation| acc.saturating_add(token_count(generation)));
    let loi_text = if let Some(loi_prompt) = &prompt_bundle.section_loi_text {
        let section = llm_client
            .generate_section(&prompt_bundle.system_prompt, loi_prompt)
            .await
            .map_err(error_string)?;
        section_budget_tokens = section_budget_tokens.saturating_add(token_count(&section));
        Some(section.text)
    } else {
        None
    };

    let mut generated = DraftRecord {
        draft_id: uuid::Uuid::new_v4().to_string(),
        grant_portal_id: grant.portal_id.clone(),
        status: "draft".to_string(),
        version: 1,
        section_org_overview: Some(org_overview.text.clone()),
        section_need_statement: Some(need_statement.text.clone()),
        section_project_description: Some(project_description.text.clone()),
        section_goals_objectives: Some(goals_objectives.text.clone()),
        section_implementation_plan: Some(implementation_plan.text.clone()),
        section_evaluation_plan: Some(evaluation_plan.text.clone()),
        section_budget_narrative: Some(budget_narrative.text.clone()),
        section_sustainability: Some(sustainability.text.clone()),
        section_org_capacity: Some(org_capacity.text.clone()),
        section_loi_text: loi_text.clone(),
        ai_model_used: Some(ai::prompts::DRAFT_MODEL.to_string()),
        ai_prompt_version: Some(ai::DRAFT_PROMPT_VERSION),
        generation_tokens: Some(section_budget_tokens),
        user_edited: false,
        generation_mode: crate::models::DraftGenerationMode::Ai,
        provenance_org_uid: Some(org_uid.clone()),
        provenance_note: Some("Generated from live AI sections".to_string()),
        scaffold_template_version: None,
        created_at: Some(Utc::now()),
        updated_at: Some(Utc::now()),
        title: Some(grant.title.clone()),
        body: None,
        notes: Some(format!(
            "Generated from live AI sections for {} ({})",
            grant.title, grant.portal_id
        )),
    };

    generated.body = Some(draft_schema::compose_grant_aware_draft_body(
        &generated,
        Some(&grant),
    ));

    client
        .put_json(&db::draft_path(&org_uid, &generated.draft_id), &generated)
        .await
        .map_err(error_string)?;
    Ok(generated)
}

#[tauri::command]
pub async fn delete_draft(state: State<'_, AppState>, draft_id: String) -> Result<(), String> {
    let uid = state
        .require_workspace_access()
        .await
        .map_err(error_string)?;
    let client = state.rtdb_client().await.map_err(error_string)?;
    client
        .delete(&db::draft_path(&uid, &draft_id))
        .await
        .map_err(error_string)
}

#[tauri::command]
pub async fn export_draft(
    state: State<'_, AppState>,
    draft_id: String,
    output_path: Option<String>,
) -> Result<String, String> {
    let uid = state
        .require_workspace_access()
        .await
        .map_err(error_string)?;
    let draft = load_draft_record(&state, &uid, &draft_id).await?;
    let grant_fut = load_grant_record(&state, &draft.grant_portal_id);
    let organization_fut = load_organization_record(&state, &uid);
    let (grant, organization) = tokio::try_join!(grant_fut, organization_fut)?;
    let organization = organization.ok_or_else(|| format!("organization {uid} not found"))?;

    let payload = DraftExportPayload {
        draft,
        grant,
        organization,
        generated_at: Utc::now(),
    };
    let payload_path = write_export_payload(&payload).await?;
    let output_target = output_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(export_output_dir);
    let worker_script = export_worker_script_path()?;

    let output = Command::new("node")
        .arg(worker_script)
        .arg(&payload_path)
        .arg(&output_target)
        .output()
        .await
        .map_err(error_string)?;

    let _ = tokio::fs::remove_file(&payload_path).await;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let message = if stderr.is_empty() { stdout } else { stderr };
        return Err(if message.is_empty() {
            "docx export worker failed".to_string()
        } else {
            message
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        return Err("docx export worker did not return an output path".to_string());
    }

    let output_path = PathBuf::from(&stdout);
    if tokio::fs::metadata(&output_path).await.is_err() {
        return Err(format!(
            "docx export worker reported missing output file at {}",
            output_path.display()
        ));
    }

    Ok(stdout)
}

#[tauri::command]
pub async fn ping() -> Result<&'static str, String> {
    Ok("ok")
}

#[tauri::command]
pub async fn reveal_path_in_folder(path: String) -> Result<(), String> {
    let target = PathBuf::from(path);
    let metadata = tokio::fs::metadata(&target).await.map_err(error_string)?;
    if !metadata.is_file() {
        return Err(format!("path is not a file: {}", target.display()));
    }

    let status = reveal_file_command(&target)
        .status()
        .map_err(error_string)?;
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "failed to reveal file in folder: {}",
            target.display()
        ))
    }
}

fn error_string<E: std::fmt::Display>(err: E) -> String {
    let raw = err.to_string();
    let normalized = raw.to_ascii_lowercase();

    let payload = if normalized.contains("invalid_grant")
        || normalized.contains("token expired")
        || normalized.contains("invalid refresh token")
        || normalized.contains("missing active session")
        || normalized.contains("missing refresh token")
    {
        CommandErrorPayload {
            code: "session_expired",
            message: "Your session expired or is no longer valid. Sign in again to continue."
                .to_string(),
            detail: Some(raw),
            retryable: false,
            requires_reauth: true,
            service: Some("firebase"),
        }
    } else if normalized.contains("firebase auth request failed") {
        CommandErrorPayload {
            code: "firebase_unavailable",
            message: "Grant Keeper could not reach Firebase right now. Retry in a moment."
                .to_string(),
            detail: Some(raw),
            retryable: true,
            requires_reauth: false,
            service: Some("firebase"),
        }
    } else if normalized.contains("rtdb request failed")
        || normalized.contains("service account auth failed")
    {
        CommandErrorPayload {
            code: "rtdb_unavailable",
            message:
                "Grant Keeper could not reach the grants database right now. Retry in a moment."
                    .to_string(),
            detail: Some(raw),
            retryable: true,
            requires_reauth: false,
            service: Some("rtdb"),
        }
    } else if normalized.contains("anthropic request failed")
        || normalized.contains("anthropic returned an error")
    {
        CommandErrorPayload {
            code: "anthropic_unavailable",
            message: "Grant Keeper could not reach Anthropic right now. Retry in a moment or use local scaffold mode."
                .to_string(),
            detail: Some(raw),
            retryable: true,
            requires_reauth: false,
            service: Some("anthropic"),
        }
    } else if normalized.contains("email_not_found") {
        CommandErrorPayload {
            code: "email_not_found",
            message: "That work email does not match an existing account yet.".to_string(),
            detail: Some(raw),
            retryable: false,
            requires_reauth: false,
            service: Some("firebase"),
        }
    } else {
        CommandErrorPayload {
            code: "unknown",
            message: raw.clone(),
            detail: Some(raw),
            retryable: false,
            requires_reauth: false,
            service: None,
        }
    };

    serde_json::to_string(&payload).unwrap_or(payload.message)
}

#[derive(Debug, Serialize)]
struct CommandErrorPayload {
    code: &'static str,
    message: String,
    detail: Option<String>,
    retryable: bool,
    requires_reauth: bool,
    service: Option<&'static str>,
}

async fn load_grant_record(
    state: &State<'_, AppState>,
    portal_id: &str,
) -> Result<GrantRecord, String> {
    state
        .grant_record(portal_id)
        .await
        .map_err(error_string)?
        .ok_or_else(|| format!("grant {portal_id} not found"))
}

async fn load_organization_record(
    state: &State<'_, AppState>,
    uid: &str,
) -> Result<Option<OrganizationRecord>, String> {
    let client = state.rtdb_client().await.map_err(error_string)?;
    let legacy_uid = legacy_workspace_uid(state, uid).await?;
    let primary_path = db::organization_path(uid);
    let fallback_path = legacy_uid
        .as_deref()
        .filter(|legacy_uid| *legacy_uid != uid)
        .map(db::organization_path);

    let primary = client.get_json(&primary_path).await.map_err(error_string)?;
    if !matches!(primary, Value::Null) {
        return normalize_organization(uid.to_string(), primary).map(Some);
    }

    if let Some(fallback_path) = fallback_path {
        let fallback = client
            .get_json(&fallback_path)
            .await
            .map_err(error_string)?;
        if !matches!(fallback, Value::Null) {
            let normalized = normalize_organization(uid.to_string(), fallback)?;
            client
                .put_json(&primary_path, &normalized)
                .await
                .map_err(error_string)?;
            return Ok(Some(normalized));
        }
    }

    Ok(None)
}

async fn load_draft_record(
    state: &State<'_, AppState>,
    uid: &str,
    draft_id: &str,
) -> Result<DraftRecord, String> {
    let client = state.rtdb_client().await.map_err(error_string)?;
    let legacy_uid = legacy_workspace_uid(state, uid).await?;
    let primary_path = db::draft_path(uid, draft_id);
    let fallback_path = legacy_uid
        .as_deref()
        .filter(|legacy_uid| *legacy_uid != uid)
        .map(|legacy_uid| db::draft_path(legacy_uid, draft_id));

    let primary = client.get_json(&primary_path).await.map_err(error_string)?;
    if !matches!(primary, Value::Null) {
        return normalize_draft(draft_id.to_string(), primary);
    }

    if let Some(fallback_path) = fallback_path {
        let fallback = client
            .get_json(&fallback_path)
            .await
            .map_err(error_string)?;
        if !matches!(fallback, Value::Null) {
            let normalized = normalize_draft(draft_id.to_string(), fallback)?;
            client
                .put_json(&primary_path, &normalized)
                .await
                .map_err(error_string)?;
            return Ok(normalized);
        }
    }

    Err(format!("draft {draft_id} not found"))
}

async fn load_watchlist_collection(
    state: &State<'_, AppState>,
    uid: &str,
) -> Result<Vec<WatchlistEntry>, String> {
    let client = state.rtdb_client().await.map_err(error_string)?;
    let legacy_uid = legacy_workspace_uid(state, uid).await?;
    let primary_path = db::watchlist_path(uid);
    let fallback_path = legacy_uid
        .as_deref()
        .filter(|legacy_uid| *legacy_uid != uid)
        .map(db::watchlist_path);

    let primary = client.get_json(&primary_path).await.map_err(error_string)?;
    if let Some(fallback_path) = fallback_path {
        let fallback = client
            .get_json(&fallback_path)
            .await
            .map_err(error_string)?;
        if !matches!(primary, Value::Null) {
            let merged = merge_workspace_collections(primary, fallback);
            client
                .put_json(&primary_path, &merged)
                .await
                .map_err(error_string)?;
            return Ok(normalize_watchlist_collection(merged));
        }
        if !matches!(fallback, Value::Null) {
            client
                .put_json(&primary_path, &fallback)
                .await
                .map_err(error_string)?;
            return Ok(normalize_watchlist_collection(fallback));
        }
    } else if !matches!(primary, Value::Null) {
        return Ok(normalize_watchlist_collection(primary));
    }

    Ok(Vec::new())
}

async fn load_draft_collection(
    state: &State<'_, AppState>,
    uid: &str,
) -> Result<Vec<DraftSummary>, String> {
    let client = state.rtdb_client().await.map_err(error_string)?;
    let legacy_uid = legacy_workspace_uid(state, uid).await?;
    let primary_path = db::drafts_path(uid);
    let fallback_path = legacy_uid
        .as_deref()
        .filter(|legacy_uid| *legacy_uid != uid)
        .map(db::drafts_path);

    let primary = client.get_json(&primary_path).await.map_err(error_string)?;
    if let Some(fallback_path) = fallback_path {
        let fallback = client
            .get_json(&fallback_path)
            .await
            .map_err(error_string)?;
        if !matches!(primary, Value::Null) {
            let merged = merge_workspace_collections(primary, fallback);
            client
                .put_json(&primary_path, &merged)
                .await
                .map_err(error_string)?;
            return Ok(normalize_draft_collection(merged));
        }
        if !matches!(fallback, Value::Null) {
            client
                .put_json(&primary_path, &fallback)
                .await
                .map_err(error_string)?;
            return Ok(normalize_draft_collection(fallback));
        }
    } else if !matches!(primary, Value::Null) {
        return Ok(normalize_draft_collection(primary));
    }

    Ok(Vec::new())
}

async fn legacy_workspace_uid(
    state: &State<'_, AppState>,
    current_uid: &str,
) -> Result<Option<String>, String> {
    let config_uid = state.config().await.firebase_uid;
    let session_uid = state.current_session().await.map(|session| session.uid);
    Ok(legacy_workspace_uid_from(
        current_uid,
        config_uid,
        session_uid,
    ))
}

fn legacy_workspace_uid_from(
    current_uid: &str,
    config_uid: Option<String>,
    session_uid: Option<String>,
) -> Option<String> {
    config_uid
        .into_iter()
        .chain(session_uid)
        .find(|uid| uid != current_uid)
}

fn merge_workspace_collections(primary: Value, fallback: Value) -> Value {
    match (primary, fallback) {
        (Value::Null, Value::Null) => Value::Null,
        (Value::Null, value) | (value, Value::Null) => value,
        (Value::Object(mut primary), Value::Object(fallback)) => {
            for (key, value) in fallback {
                primary.entry(key).or_insert(value);
            }
            Value::Object(primary)
        }
        (value, _) => value,
    }
}

fn export_worker_script_path() -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace_root = manifest_dir
        .parent()
        .ok_or_else(|| "unable to locate workspace root".to_string())?;
    let worker = workspace_root.join("docx-sidecar").join("worker.mjs");
    if worker.exists() {
        Ok(worker)
    } else {
        Err(format!("docx worker not found at {}", worker.display()))
    }
}

fn export_output_dir() -> PathBuf {
    dirs::download_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("Grant Keeper")
}

fn reveal_file_command(path: &PathBuf) -> StdCommand {
    let mut command = StdCommand::new(reveal_file_program());
    for arg in reveal_file_arguments(path) {
        command.arg(arg);
    }
    command
}

fn reveal_file_program() -> &'static str {
    if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(target_os = "windows") {
        "explorer"
    } else {
        "xdg-open"
    }
}

fn reveal_file_arguments(path: &PathBuf) -> Vec<String> {
    if cfg!(target_os = "macos") {
        vec!["-R".to_string(), path.display().to_string()]
    } else if cfg!(target_os = "windows") {
        vec![format!("/select,{}", path.display())]
    } else {
        vec![path
            .parent()
            .unwrap_or(path.as_path())
            .display()
            .to_string()]
    }
}

async fn write_export_payload(payload: &DraftExportPayload) -> Result<PathBuf, String> {
    let temp_dir = std::env::temp_dir().join("grant-keeper-exports");
    tokio::fs::create_dir_all(&temp_dir)
        .await
        .map_err(error_string)?;
    let file_name = format!("{}.json", payload.draft.draft_id);
    let path = temp_dir.join(file_name);
    let json = serde_json::to_string_pretty(payload).map_err(error_string)?;
    tokio::fs::write(&path, json).await.map_err(error_string)?;
    Ok(path)
}

#[derive(Debug, Serialize)]
struct DraftExportPayload {
    draft: DraftRecord,
    grant: GrantRecord,
    organization: OrganizationRecord,
    generated_at: DateTime<Utc>,
}

fn token_count(generation: &ai::SectionGeneration) -> u32 {
    generation
        .input_tokens
        .unwrap_or(0)
        .saturating_add(generation.output_tokens.unwrap_or(0))
}

fn build_local_draft_scaffold(
    grant: &GrantRecord,
    organization: &OrganizationRecord,
) -> DraftRecord {
    draft_schema::build_local_draft_scaffold(grant, organization)
}

fn normalize_organization(
    fallback_uid: String,
    value: Value,
) -> Result<OrganizationRecord, String> {
    let mut raw: OrganizationRecord = serde_json::from_value(value).map_err(error_string)?;
    if raw.uid.trim().is_empty() {
        raw.uid = fallback_uid;
    }
    Ok(raw)
}

fn normalize_organization_write(
    fallback_uid: String,
    mut organization: OrganizationRecord,
) -> Result<OrganizationRecord, String> {
    if organization.uid.trim().is_empty() {
        organization.uid = fallback_uid;
    }
    if organization.uid.trim().is_empty() {
        return Err("organization uid is required".to_string());
    }
    organization.updated_at = Some(Utc::now());
    Ok(organization)
}

fn normalize_watchlist_collection(payload: Value) -> Vec<WatchlistEntry> {
    collection_entries(payload)
        .into_iter()
        .filter_map(|(key, value)| normalize_watchlist(key, value).ok())
        .collect()
}

fn normalize_watchlist(fallback_portal_id: String, value: Value) -> Result<WatchlistEntry, String> {
    let mut raw: WatchlistEntry = serde_json::from_value(value).map_err(error_string)?;
    if raw.portal_id.trim().is_empty() {
        raw.portal_id = fallback_portal_id;
    }
    if !raw.saved {
        raw.saved = true;
    }
    Ok(raw)
}

fn normalize_watchlist_write(mut entry: WatchlistEntry) -> Result<WatchlistEntry, String> {
    if entry.portal_id.trim().is_empty() {
        return Err("watchlist portal_id is required".to_string());
    }
    entry.updated_at = Some(Utc::now());
    Ok(entry)
}

fn normalize_draft_collection(payload: Value) -> Vec<DraftSummary> {
    collection_entries(payload)
        .into_iter()
        .filter_map(|(key, value)| normalize_draft(key, value).ok())
        .map(DraftSummary::from)
        .collect()
}

fn normalize_draft(fallback_draft_id: String, value: Value) -> Result<DraftRecord, String> {
    let mut raw: DraftRecord = serde_json::from_value(value).map_err(error_string)?;
    if raw.draft_id.trim().is_empty() {
        raw.draft_id = fallback_draft_id;
    }
    if raw.status.trim().is_empty() {
        raw.status = "draft".to_string();
    }
    if raw.version == 0 {
        raw.version = 1;
    }
    Ok(raw)
}

fn normalize_draft_write(mut draft: DraftRecord) -> Result<DraftRecord, String> {
    if draft.draft_id.trim().is_empty() {
        return Err("draft_id is required".to_string());
    }
    if draft.status.trim().is_empty() {
        draft.status = "draft".to_string();
    }
    if draft.version == 0 {
        draft.version = 1;
    }
    draft.updated_at = Some(Utc::now());
    Ok(draft)
}

fn collection_entries(payload: Value) -> Vec<(String, Value)> {
    match payload {
        Value::Null => Vec::new(),
        Value::Object(map) => map.into_iter().collect(),
        Value::Array(items) => items
            .into_iter()
            .enumerate()
            .map(|(index, value)| (index.to_string(), value))
            .collect(),
        other => vec![("value".to_string(), other)],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn watchlist_collection_uses_saved_default() {
        let payload = json!({
            "1001": {
                "note": "review later"
            }
        });

        let watchlist = normalize_watchlist_collection(payload);
        assert_eq!(watchlist.len(), 1);
        assert_eq!(watchlist[0].portal_id, "1001");
        assert!(watchlist[0].saved);
        assert_eq!(watchlist[0].note.as_deref(), Some("review later"));
    }

    #[test]
    fn organization_write_applies_fallback_uid() {
        let organization = OrganizationRecord::default();
        let normalized = normalize_organization_write("org-1".into(), organization).unwrap();
        assert_eq!(normalized.uid, "org-1");
    }

    #[test]
    fn collection_entries_handles_null_and_arrays() {
        assert!(collection_entries(Value::Null).is_empty());
        let array = collection_entries(json!([{"title": "A"}]));
        assert_eq!(array.len(), 1);
        assert_eq!(array[0].0, "0");
    }

    #[test]
    fn merge_workspace_collections_prefers_primary_and_fills_missing_entries() {
        let primary = json!({
            "a": { "saved": true, "note": "primary" }
        });
        let fallback = json!({
            "a": { "saved": false, "note": "legacy" },
            "b": { "saved": true, "note": "legacy only" }
        });

        let merged = merge_workspace_collections(primary, fallback);
        let merged_entries = collection_entries(merged);
        assert_eq!(merged_entries.len(), 2);
        let merged_map = merged_entries
            .into_iter()
            .collect::<std::collections::BTreeMap<_, _>>();
        assert_eq!(merged_map["a"]["note"], "primary");
        assert_eq!(merged_map["b"]["note"], "legacy only");
    }

    #[test]
    fn legacy_workspace_uid_from_prefers_config_before_session() {
        let legacy = legacy_workspace_uid_from(
            "org-current",
            Some("org-legacy-config".to_string()),
            Some("org-legacy-session".to_string()),
        );

        assert_eq!(legacy.as_deref(), Some("org-legacy-config"));
    }

    #[test]
    fn legacy_workspace_uid_from_falls_back_to_session_when_config_matches_current() {
        let legacy = legacy_workspace_uid_from(
            "org-current",
            Some("org-current".to_string()),
            Some("org-legacy-session".to_string()),
        );

        assert_eq!(legacy.as_deref(), Some("org-legacy-session"));
    }

    #[test]
    fn legacy_workspace_uid_from_returns_none_when_everything_matches_current() {
        let legacy = legacy_workspace_uid_from(
            "org-current",
            Some("org-current".to_string()),
            Some("org-current".to_string()),
        );

        assert_eq!(legacy, None);
    }
}
