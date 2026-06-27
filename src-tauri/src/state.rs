use crate::{
    config::{ConfigError, ConfigStore, SessionStore},
    firebase::{FirebaseAuthClient, FirebaseError},
    ingest,
    models::{
        AppSnapshot, ConfigUpdate, EmailPasswordSignIn, EmailPasswordSignUp, FirebaseSession, GrantRecord,
        GrantSourceHealthRecord, GrantSourceHealthStatus, GrantSourceKind, GrantSourceRecord,
        GrantSourceSyncOutcome, LocalConfig, OrganizationProgram, OrganizationRecord, SessionMode,
        SessionState, SetupValidation, StartupState, WorkspaceBootstrapContract,
        WorkspaceBootstrapStage, WorkspaceCreateRequest, WorkspaceJoinRequest,
        WorkspaceInviteRecord, WorkspaceMembershipRecord,
    },
    source_adapters::{
        canonical_source_id_for_id, source_family_for_id, source_requires_auto_sync,
    },
    rtdb::{service_account_access_token, RealtimeDatabaseClient, RtdbError},
};
use chrono::{Duration, Utc};
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::RwLock;
use url::Url;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum AppStateError {
    #[error("{0}")]
    Config(#[from] ConfigError),
    #[error("{0}")]
    Firebase(#[from] FirebaseError),
    #[error("{0}")]
    Rtdb(#[from] RtdbError),
}

#[derive(Debug, Clone)]
pub struct AppState {
    inner: Arc<RwLock<AppStateInner>>,
}

#[derive(Debug)]
struct AppStateInner {
    config_store: ConfigStore,
    session_store: SessionStore,
    config: LocalConfig,
    session: Option<FirebaseSession>,
    grant_cache: Option<GrantCacheEntry>,
}

#[derive(Debug, Clone)]
struct GrantCacheEntry {
    grants: Vec<GrantRecord>,
    fetched_at: chrono::DateTime<Utc>,
}

const GRANT_CACHE_TTL: Duration = Duration::minutes(2);

impl AppState {
    pub async fn load() -> Result<Self, AppStateError> {
        let store_path = ConfigStore::default_path()?;
        let session_path = SessionStore::default_path()?;
        let config_store = ConfigStore::new(store_path);
        let session_store = SessionStore::new(session_path);
        let mut config = Self::apply_env_defaults(config_store.load().await?);
        let session = match session_store.load().await {
            Ok(session) => session,
            Err(err) => {
                tracing::warn!("failed to restore persisted session: {err}");
                None
            }
        };
        if let Some(session_ref) = session.as_ref() {
            if config.firebase_uid.as_deref() != Some(session_ref.uid.as_str()) {
                config.firebase_uid = Some(session_ref.uid.clone());
                let _ = config_store.save(&config).await;
            }
            if config.organization_uid.is_none() {
                config.organization_uid = Some(
                    config
                        .firebase_uid
                        .clone()
                        .unwrap_or_else(|| session_ref.uid.clone()),
                );
                let _ = config_store.save(&config).await;
            }
            if !config.setup_complete {
                config.setup_complete = true;
                let _ = config_store.save(&config).await;
            }
        }

        Ok(Self {
            inner: Arc::new(RwLock::new(AppStateInner {
                config_store,
                session_store,
                config,
                session,
                grant_cache: None,
            })),
        })
    }

    pub async fn snapshot(&self) -> AppSnapshot {
        let guard = self.inner.read().await;
        let validation = Self::validate_setup_state(&guard.config, guard.session.as_ref());
        let current_org_uid = guard
            .config
            .organization_uid
            .clone()
            .or_else(|| guard.config.firebase_uid.clone())
            .or_else(|| guard.session.as_ref().map(|session| session.uid.clone()));
        AppSnapshot {
            startup_state: startup_state(&guard.config, guard.session.as_ref()),
            ready_for_setup: !validation.ready,
            current_org_uid,
            organization_uid: guard.config.organization_uid.clone(),
            workspace_bootstrap: workspace_bootstrap_contract(),
            session: SessionState {
                signed_in: guard.session.is_some(),
                mode: session_mode(guard.session.as_ref()),
                email: guard.session.as_ref().map(|s| s.email.clone()),
                uid: guard.session.as_ref().map(|s| s.uid.clone()),
                expires_at: guard.session.as_ref().map(|s| s.expires_at),
            },
            config: guard.config.clone(),
        }
    }

    pub async fn validate_setup(&self) -> SetupValidation {
        let guard = self.inner.read().await;
        Self::validate_setup_state(&guard.config, guard.session.as_ref())
    }

    pub async fn config(&self) -> LocalConfig {
        self.inner.read().await.config.clone()
    }

    pub async fn update_config(&self, update: ConfigUpdate) -> Result<LocalConfig, AppStateError> {
        let mut guard = self.inner.write().await;
        guard.config = ConfigStore::apply_update(&guard.config, &update);
        guard.config_store.save(&guard.config).await?;
        Ok(guard.config.clone())
    }

    pub async fn set_session(&self, session: FirebaseSession) -> Result<(), AppStateError> {
        let mut guard = self.inner.write().await;
        guard.config.firebase_uid = Some(session.uid.clone());
        guard.session = Some(session);
        guard.config_store.save(&guard.config).await?;
        if let Some(session) = guard.session.as_ref() {
            guard.session_store.save(session).await?;
        }
        Ok(())
    }

    pub async fn clear_session(&self) -> Result<(), AppStateError> {
        let mut guard = self.inner.write().await;
        guard.session = None;
        guard.config.firebase_uid = None;
        guard.config_store.save(&guard.config).await?;
        guard.session_store.clear().await?;
        Ok(())
    }

    pub async fn current_session(&self) -> Option<FirebaseSession> {
        self.inner.read().await.session.clone()
    }

    pub async fn current_org_uid(&self) -> Option<String> {
        let guard = self.inner.read().await;
        guard
            .config
            .organization_uid
            .clone()
            .or_else(|| guard.config.firebase_uid.clone())
            .or_else(|| guard.session.as_ref().map(|session| session.uid.clone()))
    }

    pub async fn require_org_uid(&self) -> Result<String, AppStateError> {
        self.current_org_uid().await.ok_or_else(|| {
            FirebaseError::Auth("missing active organization uid".to_string()).into()
        })
    }

    pub async fn require_workspace_access(&self) -> Result<String, AppStateError> {
        let org_uid = self.require_org_uid().await?;
        let session = self.current_session().await.ok_or_else(|| {
            FirebaseError::Auth("missing active session for workspace access".to_string())
        })?;
        if self
            .workspace_membership(&org_uid, &session.uid)
            .await?
            .is_some()
        {
            return Ok(org_uid);
        }

        if org_uid == session.uid {
            let membership = WorkspaceMembershipRecord {
                firebase_uid: session.uid.clone(),
                email: session.email.clone(),
                organization_uid: org_uid.clone(),
                role: "owner".to_string(),
                updated_at: Some(Utc::now()),
            };
            let client = self.rtdb_client().await?;
            client
                .put_json(
                    &crate::db::organization_member_path(&org_uid, &session.uid),
                    &membership,
                )
                .await?;
            client
                .put_json(
                    &crate::db::membership_path(&session.uid, &org_uid),
                    &membership,
                )
                .await?;
            return Ok(org_uid);
        }

        Err(FirebaseError::Auth(format!(
            "workspace membership not found for session {} and organization {}",
            session.uid, org_uid
        ))
        .into())
    }

    pub async fn require_owner_workspace_access(&self) -> Result<String, AppStateError> {
        let org_uid = self.require_workspace_access().await?;
        let session = self.current_session().await.ok_or_else(|| {
            FirebaseError::Auth("missing active session for owner access".to_string())
        })?;
        let membership = self
            .workspace_membership(&org_uid, &session.uid)
            .await?
            .ok_or_else(|| {
                FirebaseError::Auth("workspace membership was not found".to_string())
            })?;
        if membership.role != "owner" {
            return Err(FirebaseError::Auth(
                "owner access is required for this workspace action".to_string(),
            )
            .into());
        }
        Ok(org_uid)
    }

    pub async fn ensure_valid_session(
        &self,
        auth: &FirebaseAuthClient,
    ) -> Result<Option<FirebaseSession>, AppStateError> {
        let current_session = self.current_session().await;
        let maybe_refresh_token = current_session
            .as_ref()
            .and_then(|session: &FirebaseSession| {
                if is_local_session_ref(session) || !session.is_expiring_soon() {
                    None
                } else {
                    Some(session.refresh_token.clone())
                }
            });

        let Some(refresh_token) = maybe_refresh_token else {
            return Ok(current_session);
        };

        let email = current_session
            .as_ref()
            .map(|session| session.email.clone())
            .unwrap_or_default();

        match auth.refresh_session(&refresh_token).await {
            Ok(refreshed) => {
                let refreshed = FirebaseSession { email, ..refreshed };
                self.set_session(refreshed.clone()).await?;
                Ok(Some(refreshed))
            }
            Err(err) if session_refresh_requires_reauth(&err) => {
                self.clear_session().await?;
                Err(err.into())
            }
            Err(err) => Err(err.into()),
        }
    }

    pub async fn firebase_auth_client(&self) -> Result<FirebaseAuthClient, AppStateError> {
        let guard = self.inner.read().await;
        let api_key = guard
            .config
            .firebase_web_api_key
            .clone()
            .unwrap_or_default();
        Ok(FirebaseAuthClient::new(api_key))
    }

    pub async fn rtdb_client(&self) -> Result<RealtimeDatabaseClient, AppStateError> {
        let guard = self.inner.read().await;
        let database_url = guard.config.firebase_rtdb_url.clone().unwrap_or_default();
        let token = resolve_service_account_token(true, guard.session.as_ref()).await?;
        Ok(RealtimeDatabaseClient::new(database_url, token))
    }

    pub async fn rtdb_service_client(&self) -> Result<RealtimeDatabaseClient, AppStateError> {
        let guard = self.inner.read().await;
        let database_url = guard.config.firebase_rtdb_url.clone().unwrap_or_default();
        let token = resolve_service_account_token(true, guard.session.as_ref()).await?;
        Ok(RealtimeDatabaseClient::new(database_url, token))
    }

    pub async fn sign_in_with_email_password(
        &self,
        request: EmailPasswordSignIn,
    ) -> Result<FirebaseSession, AppStateError> {
        let auth = self.firebase_auth_client().await?;
        let session: FirebaseSession = auth
            .sign_in_with_email_password(&request.email, &request.password)
            .await?;
        self.set_session(session.clone()).await?;
        Ok(session)
    }

    pub async fn sign_up_with_email_password(
        &self,
        request: EmailPasswordSignUp,
    ) -> Result<FirebaseSession, AppStateError> {
        let auth = self.firebase_auth_client().await?;
        let session = auth
            .sign_up_with_email_password(&request.email, &request.password)
            .await?;
        self.set_session(session.clone()).await?;
        Ok(session)
    }

    pub async fn send_password_reset_email(&self, email: &str) -> Result<(), AppStateError> {
        let auth = self.firebase_auth_client().await?;
        auth.send_password_reset_email(email).await?;
        Ok(())
    }

    pub async fn start_dev_profile(&self) -> Result<FirebaseSession, AppStateError> {
        let uid = format!("dev-{}", Uuid::new_v4());
        let session = FirebaseSession {
            email: "dev@grantkeeper.local".to_string(),
            uid,
            id_token: format!("dev:{}", Uuid::new_v4()),
            refresh_token: format!("dev-refresh:{}", Uuid::new_v4()),
            expires_at: Utc::now() + Duration::days(3650),
        };

        self.set_session(session.clone()).await?;
        self.update_config(ConfigUpdate {
            organization_uid: Some(session.uid.clone()),
            setup_complete: Some(true),
            ..Default::default()
        })
        .await?;
        self.seed_dev_organization(&session).await?;
        Ok(session)
    }

    pub async fn create_workspace_account(
        &self,
        request: WorkspaceCreateRequest,
    ) -> Result<FirebaseSession, AppStateError> {
        let organization_name = request.organization_name.trim();
        if organization_name.is_empty() {
            return Err(FirebaseError::Auth("organization name is required".to_string()).into());
        }

        let email = request.email.trim();
        if email.is_empty() {
            return Err(FirebaseError::Auth("email is required".to_string()).into());
        }

        if request.password.trim().is_empty() {
            return Err(FirebaseError::Auth("password is required".to_string()).into());
        }

        let workspace_code = request
            .workspace_code
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(slug_source_name)
            .unwrap_or_else(|| slug_workspace_name(organization_name, email));

        if self.workspace_exists(&workspace_code).await? {
            let session = self
                .sign_in_with_email_password(EmailPasswordSignIn {
                    email: email.to_string(),
                    password: request.password,
                })
                .await?;
            if let Err(err) = self
                .resume_existing_workspace_session(&session, &workspace_code)
                .await
            {
                let _ = self.clear_session().await;
                return Err(err);
            }
            return Ok(session);
        }

        let session = self
            .sign_up_with_email_password(EmailPasswordSignUp {
                email: email.to_string(),
                password: request.password,
            })
            .await?;
        self.update_config(ConfigUpdate {
            organization_uid: Some(workspace_code.clone()),
            setup_complete: Some(true),
            ..Default::default()
        })
        .await?;
        self.seed_workspace_organization(&session, organization_name, &workspace_code)
            .await?;
        Ok(session)
    }

    pub async fn create_workspace_invite(&self) -> Result<WorkspaceInviteRecord, AppStateError> {
        let organization_uid = self.require_owner_workspace_access().await?;
        let session = self.current_session().await.ok_or_else(|| {
            FirebaseError::Auth("missing active session for invite creation".to_string())
        })?;
        let organization = self
            .workspace_organization(&organization_uid)
            .await?
            .ok_or_else(|| {
                FirebaseError::Auth("workspace organization was not found".to_string())
            })?;
        let invite = WorkspaceInviteRecord {
            invite_token: format!("gk-{}", Uuid::new_v4().simple()),
            organization_uid: organization_uid.clone(),
            organization_name: organization.name.clone(),
            role: "member".to_string(),
            created_by_uid: session.uid.clone(),
            created_by_email: session.email.clone(),
            created_at: Some(Utc::now()),
            claimed_by_uid: None,
            claimed_by_email: None,
            claimed_at: None,
            active: true,
        };
        let client = self.rtdb_client().await?;
        client
            .put_json(
                &crate::db::workspace_invite_path(&invite.invite_token),
                &invite,
            )
            .await?;
        Ok(invite)
    }

    pub async fn sign_in_to_workspace(
        &self,
        request: WorkspaceJoinRequest,
    ) -> Result<FirebaseSession, AppStateError> {
        let email = request.email.trim();
        if email.is_empty() {
            return Err(FirebaseError::Auth("email is required".to_string()).into());
        }
        if request.password.trim().is_empty() {
            return Err(FirebaseError::Auth("password is required".to_string()).into());
        }
        let workspace_code = request
            .workspace_code
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(slug_source_name)
            .unwrap_or_default();
        if workspace_code.is_empty() {
            return Err(FirebaseError::Auth("workspace code is required".to_string()).into());
        }

        let session = self
            .sign_in_with_email_password(EmailPasswordSignIn {
                email: email.to_string(),
                password: request.password,
            })
            .await?;
        if let Err(err) = self
            .attach_session_to_workspace(&session, &workspace_code, "member")
            .await
        {
            let _ = self.clear_session().await;
            return Err(err);
        }
        Ok(session)
    }

    pub async fn sign_up_to_join_workspace(
        &self,
        request: WorkspaceJoinRequest,
    ) -> Result<FirebaseSession, AppStateError> {
        let email = request.email.trim();
        if email.is_empty() {
            return Err(FirebaseError::Auth("email is required".to_string()).into());
        }
        if request.password.trim().is_empty() {
            return Err(FirebaseError::Auth("password is required".to_string()).into());
        }
        let invite_token = request
            .invite_token
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| FirebaseError::Auth("invite token is required".to_string()))?
            .to_string();
        let invite = self
            .workspace_invite(&invite_token)
            .await?
            .ok_or_else(|| FirebaseError::Auth("invite token was not found".to_string()))?;
        if !invite.active || invite.claimed_at.is_some() {
            return Err(FirebaseError::Auth(
                "invite token is no longer active".to_string(),
            )
            .into());
        }

        let session = self
            .sign_up_with_email_password(EmailPasswordSignUp {
                email: email.to_string(),
                password: request.password,
            })
            .await?;
        if let Err(err) = self
            .redeem_workspace_invite(&session, &invite)
            .await
        {
            let _ = self.clear_session().await;
            return Err(err);
        }
        Ok(session)
    }

    async fn seed_dev_organization(&self, session: &FirebaseSession) -> Result<(), AppStateError> {
        let client = self.rtdb_client().await?;
        let org_path = crate::db::organization_path(&session.uid);
        let existing = client.get_json(&org_path).await?;
        if matches!(existing, Value::Null) {
            let organization = OrganizationRecord {
                uid: session.uid.clone(),
                name: Some("Grant Keeper Demo Org".to_string()),
                ein: Some("99-9999999".to_string()),
                irc_status: Some("501(c)(3)".to_string()),
                mission: Some(
                    "Provide a realistic local testing profile for Grant Keeper workflows.".to_string(),
                ),
                founded_year: Some(2024),
                city: Some("Sacramento".to_string()),
                state: Some("CA".to_string()),
                website: Some("https://grantkeeper.local".to_string()),
                contact_name: Some("Demo Admin".to_string()),
                contact_email: Some(session.email.clone()),
                annual_budget: Some(750_000),
                staff_count: Some(8),
                volunteer_count: Some(12),
                service_area: Some("California".to_string()),
                target_population: Some("Community organizations and local residents seeking grant support".to_string()),
                programs: vec![
                    OrganizationProgram {
                        name: "Community Grant Navigation".to_string(),
                        description: Some(
                            "Tracks active grants, saves promising opportunities, and supports rapid drafting.".to_string(),
                        ),
                        budget: Some(250_000),
                    },
                    OrganizationProgram {
                        name: "Grant Response Drafting".to_string(),
                        description: Some(
                            "Prepares competitive narrative sections tailored to California grant opportunities.".to_string(),
                        ),
                        budget: Some(500_000),
                    },
                ],
                description: Some(
                    "Seeded demo organization used for validating Grant Keeper profile, watchlist, and draft flows."
                        .to_string(),
                ),
                updated_at: Some(Utc::now()),
                ..Default::default()
            };

            client.put_json(&org_path, &organization).await?;
        }
        let membership = WorkspaceMembershipRecord {
            firebase_uid: session.uid.clone(),
            email: session.email.clone(),
            organization_uid: session.uid.clone(),
            role: "owner".to_string(),
            updated_at: Some(Utc::now()),
        };
        client
            .put_json(
                &crate::db::organization_member_path(&session.uid, &session.uid),
                &membership,
            )
            .await?;
        Ok(())
    }

    async fn seed_workspace_organization(
        &self,
        session: &FirebaseSession,
        organization_name: &str,
        workspace_code: &str,
    ) -> Result<(), AppStateError> {
        let client = self.rtdb_client().await?;
        let org_path = crate::db::organization_path(workspace_code);
        let existing = client.get_json(&org_path).await?;
        if matches!(existing, Value::Null) {
            let organization = OrganizationRecord {
                uid: workspace_code.to_string(),
                name: Some(organization_name.to_string()),
                contact_email: Some(session.email.clone()),
                description: Some(
                    "Workspace created from the nonprofit pilot onboarding flow.".to_string(),
                ),
                updated_at: Some(Utc::now()),
                ..Default::default()
            };

            client.put_json(&org_path, &organization).await?;
        }
        let membership = WorkspaceMembershipRecord {
            firebase_uid: session.uid.clone(),
            email: session.email.clone(),
            organization_uid: workspace_code.to_string(),
            role: "owner".to_string(),
            updated_at: Some(Utc::now()),
        };
        client
            .put_json(
                &crate::db::organization_member_path(workspace_code, &session.uid),
                &membership,
            )
            .await?;
        client
            .put_json(
                &crate::db::membership_path(&session.uid, workspace_code),
                &membership,
            )
            .await?;
        Ok(())
    }

    async fn workspace_exists(&self, workspace_code: &str) -> Result<bool, AppStateError> {
        let client = self.rtdb_client().await?;
        let org_path = crate::db::organization_path(workspace_code);
        let existing = client.get_json(&org_path).await?;
        Ok(!matches!(existing, Value::Null))
    }

    async fn attach_session_to_workspace(
        &self,
        session: &FirebaseSession,
        workspace_code: &str,
        default_role: &str,
    ) -> Result<(), AppStateError> {
        let client = self.rtdb_client().await?;
        let org_path = crate::db::organization_path(workspace_code);
        let existing = client.get_json(&org_path).await?;
        if matches!(existing, Value::Null) {
            return Err(FirebaseError::Auth(format!(
                "workspace code {workspace_code} was not found"
            ))
            .into());
        }

        let existing_membership = self
            .workspace_membership(workspace_code, &session.uid)
            .await?;
        let role = existing_membership
            .as_ref()
            .map(|membership| membership.role.clone())
            .unwrap_or_else(|| default_role.to_string());
        let membership = WorkspaceMembershipRecord {
            firebase_uid: session.uid.clone(),
            email: session.email.clone(),
            organization_uid: workspace_code.to_string(),
            role,
            updated_at: Some(Utc::now()),
        };
        client
            .put_json(
                &crate::db::organization_member_path(workspace_code, &session.uid),
                &membership,
            )
            .await?;
        client
            .put_json(
                &crate::db::membership_path(&session.uid, workspace_code),
                &membership,
            )
            .await?;
        self.update_config(ConfigUpdate {
            organization_uid: Some(workspace_code.to_string()),
            setup_complete: Some(true),
            ..Default::default()
        })
        .await?;
        Ok(())
    }

    async fn resume_existing_workspace_session(
        &self,
        session: &FirebaseSession,
        workspace_code: &str,
    ) -> Result<(), AppStateError> {
        let existing_membership = self
            .workspace_membership(workspace_code, &session.uid)
            .await?;
        let organization = self.workspace_organization(workspace_code).await?;
        let role = resolve_existing_workspace_role(
            existing_membership.as_ref(),
            organization
                .as_ref()
                .and_then(|record| record.contact_email.as_deref()),
            &session.email,
        )
        .ok_or_else(|| {
            FirebaseError::Auth(
                "workspace code is already in use for another organization. Ask the organization owner for a workspace invite token."
                    .to_string(),
            )
        })?;
        self.attach_session_to_workspace(session, workspace_code, &role)
            .await
    }

    async fn redeem_workspace_invite(
        &self,
        session: &FirebaseSession,
        invite: &WorkspaceInviteRecord,
    ) -> Result<(), AppStateError> {
        self.attach_session_to_workspace(session, &invite.organization_uid, &invite.role)
            .await?;
        let client = self.rtdb_client().await?;
        let mut claimed = invite.clone();
        claimed.active = false;
        claimed.claimed_by_uid = Some(session.uid.clone());
        claimed.claimed_by_email = Some(session.email.clone());
        claimed.claimed_at = Some(Utc::now());
        client
            .put_json(
                &crate::db::workspace_invite_path(&invite.invite_token),
                &claimed,
            )
            .await?;
        Ok(())
    }

    async fn workspace_membership(
        &self,
        organization_uid: &str,
        firebase_uid: &str,
    ) -> Result<Option<WorkspaceMembershipRecord>, AppStateError> {
        let client = self.rtdb_client().await?;
        let primary_path = crate::db::organization_member_path(organization_uid, firebase_uid);
        let primary = client.get_json(&primary_path).await?;
        if !matches!(primary, Value::Null) {
            return serde_json::from_value(primary).map(Some).map_err(|err| {
                FirebaseError::Auth(format!("invalid membership record: {err}")).into()
            });
        }

        let legacy_path = crate::db::membership_path(firebase_uid, organization_uid);
        let legacy = client.get_json(&legacy_path).await?;
        if matches!(legacy, Value::Null) {
            return Ok(None);
        }

        let membership: WorkspaceMembershipRecord =
            serde_json::from_value(legacy).map_err(|err| {
                FirebaseError::Auth(format!("invalid legacy membership record: {err}"))
            })?;
        client.put_json(&primary_path, &membership).await?;
        Ok(Some(membership))
    }

    async fn workspace_organization(
        &self,
        workspace_code: &str,
    ) -> Result<Option<OrganizationRecord>, AppStateError> {
        let client = self.rtdb_client().await?;
        let payload = client
            .get_json(&crate::db::organization_path(workspace_code))
            .await?;
        if matches!(payload, Value::Null) {
            return Ok(None);
        }
        let organization: OrganizationRecord = serde_json::from_value(payload)
            .map_err(|err| FirebaseError::Auth(format!("invalid organization record: {err}")))?;
        Ok(Some(organization))
    }

    async fn workspace_invite(
        &self,
        invite_token: &str,
    ) -> Result<Option<WorkspaceInviteRecord>, AppStateError> {
        let client = self.rtdb_client().await?;
        let payload = client
            .get_json(&crate::db::workspace_invite_path(invite_token))
            .await?;
        if matches!(payload, Value::Null) {
            return Ok(None);
        }
        let invite: WorkspaceInviteRecord = serde_json::from_value(payload).map_err(|err| {
            FirebaseError::Auth(format!("invalid workspace invite record: {err}"))
        })?;
        Ok(Some(invite))
    }

    pub async fn grant_catalog(&self) -> Result<Vec<GrantRecord>, AppStateError> {
        {
            let guard = self.inner.read().await;
            if let Some(cache) = &guard.grant_cache {
                if grant_cache_is_fresh(cache.fetched_at) {
                    return Ok(cache.grants.clone());
                }
            }
        }

        let client = self.rtdb_client().await?;
        let payload = client.get_json(crate::db::grants_root()).await?;
        let grants = ingest::parse_grant_collection(payload);

        let mut guard = self.inner.write().await;
        guard.grant_cache = Some(GrantCacheEntry {
            grants: grants.clone(),
            fetched_at: Utc::now(),
        });
        Ok(grants)
    }

    pub async fn grant_record(
        &self,
        portal_id: &str,
    ) -> Result<Option<GrantRecord>, AppStateError> {
        {
            let guard = self.inner.read().await;
            if let Some(cache) = &guard.grant_cache {
                if grant_cache_is_fresh(cache.fetched_at) {
                    if let Some(found) = cache
                        .grants
                        .iter()
                        .find(|grant| grant.portal_id == portal_id)
                    {
                        return Ok(Some(found.clone()));
                    }
                }
            }
        }

        let client = self.rtdb_client().await?;
        let payload = client.get_json(&crate::db::grant_path(portal_id)).await?;
        Ok(match payload {
            serde_json::Value::Null => None,
            value => Some(
                ingest::parse_grant_value_for_key(portal_id.to_string(), value)
                    .map_err(|err| FirebaseError::Auth(err.to_string()))?,
            ),
        })
    }

    pub async fn invalidate_grant_cache(&self) {
        let mut guard = self.inner.write().await;
        guard.grant_cache = None;
    }

    fn validate_setup_state(
        config: &LocalConfig,
        session: Option<&FirebaseSession>,
    ) -> SetupValidation {
        let mut missing_fields = Vec::new();
        let workspace_ready = config
            .firebase_rtdb_url
            .as_ref()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false)
            && config
                .organization_uid
                .as_ref()
                .map(|value| !value.trim().is_empty())
                .unwrap_or(false);
        let dev_profile_ready = config
            .firebase_rtdb_url
            .as_ref()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false);

        if config
            .firebase_rtdb_url
            .as_ref()
            .map(|value| value.trim().is_empty())
            .unwrap_or(true)
        {
            missing_fields.push("firebase_rtdb_url".to_string());
        }
        if config
            .organization_uid
            .as_ref()
            .map(|value| value.trim().is_empty())
            .unwrap_or(true)
        {
            missing_fields.push("organization_uid".to_string());
        }
        let signed_in = session.is_some();
        let ready =
            config.setup_complete && workspace_ready && (signed_in || is_local_session(session));

        SetupValidation {
            ready,
            missing_fields,
            signed_in,
            session_mode: session_mode(session),
            workspace_ready,
            dev_profile_ready,
        }
    }

    pub async fn grant_sources(&self) -> Result<Vec<GrantSourceRecord>, AppStateError> {
        let client = self.rtdb_client().await?;
        let payload = client.get_json(crate::db::grant_sources_root()).await?;
        let (sources, should_persist) = merge_default_grant_sources(
            parse_grant_source_collection(payload),
            default_grant_sources(),
        );
        let (sources, normalized_changed) = normalize_grant_source_registry(sources);
        if should_persist || normalized_changed {
            let source_map = sources
                .iter()
                .cloned()
                .map(|source| (source.source_id.clone(), source))
                .collect::<std::collections::BTreeMap<_, _>>();
            client
                .put_json(crate::db::grant_sources_root(), &source_map)
                .await?;
        }
        Ok(sources)
    }

    pub async fn grant_source_health(&self) -> Result<Vec<GrantSourceHealthRecord>, AppStateError> {
        let sources = self.grant_sources().await?;
        let grants = self.grant_catalog().await?;
        let now = Utc::now();
        let mut grant_counts = std::collections::HashMap::with_capacity(grants.len());
        for grant in &grants {
            if let Some(source_id) = grant.source_id.as_deref() {
                *grant_counts.entry(source_id).or_insert(0usize) += 1;
            }
        }
        Ok(sources
            .into_iter()
            .map(|source| {
                let grant_count = grant_counts
                    .get(source.source_id.as_str())
                    .copied()
                    .unwrap_or(0);
                build_source_health(&source, grant_count, now)
            })
            .collect())
    }

    pub async fn grant_source(
        &self,
        source_id: &str,
    ) -> Result<Option<GrantSourceRecord>, AppStateError> {
        let sources = self.grant_sources().await?;
        Ok(sources
            .into_iter()
            .find(|source| source.source_id == source_id))
    }

    pub async fn upsert_grant_source(
        &self,
        source: GrantSourceRecord,
    ) -> Result<GrantSourceRecord, AppStateError> {
        let mut normalized = source;
        if normalized.source_id.trim().is_empty() {
            normalized.source_id = slug_source_name(&normalized.name);
        }
        if normalized.name.trim().is_empty() {
            normalized.name = normalized.source_id.clone();
        }
        if normalized.url.trim().is_empty() {
            return Err(FirebaseError::Auth("grant source url is required".to_string()).into());
        }

        if let Some(existing) = self.grant_source(&normalized.source_id).await? {
            if normalized.last_run_at.is_none() {
                normalized.last_run_at = existing.last_run_at;
            }
            if normalized.last_status.is_none() {
                normalized.last_status = existing.last_status;
            }
            if normalized.last_error.is_none() {
                normalized.last_error = existing.last_error;
            }
        }

        let client = self.rtdb_service_client().await?;
        client
            .put_json(
                &crate::db::grant_source_path(&normalized.source_id),
                &normalized,
            )
            .await?;
        Ok(normalized)
    }

    pub async fn delete_grant_source(&self, source_id: &str) -> Result<(), AppStateError> {
        let client = self.rtdb_service_client().await?;
        client
            .delete(&crate::db::grant_source_path(source_id))
            .await?;
        Ok(())
    }

    pub async fn sync_grant_source(
        &self,
        source_id: &str,
        mark_missing_closed: bool,
    ) -> Result<ingest::GrantIngestReport, AppStateError> {
        let source = self.grant_source(source_id).await?.ok_or_else(|| {
            AppStateError::from(FirebaseError::Auth(format!(
                "grant source {source_id} not found"
            )))
        })?;
        let client = self.rtdb_service_client().await?;
        let result = ingest::sync_grant_source(&client, &source, mark_missing_closed).await;
        let mut updated_source = source.clone();
        updated_source.last_run_at = Some(Utc::now());
        match &result {
            Ok(report) => {
                updated_source.last_status = Some(format!("synced {} grants", report.total_rows));
                updated_source.last_error = None;
            }
            Err(err) => {
                updated_source.last_status = Some("failed".to_string());
                updated_source.last_error = Some(err.to_string());
            }
        }
        let _ = self.upsert_grant_source(updated_source).await;
        self.invalidate_grant_cache().await;
        result.map_err(|err| FirebaseError::Auth(err.to_string()).into())
    }

    pub async fn sync_enabled_grant_sources(
        &self,
        mark_missing_closed: bool,
    ) -> Result<Vec<GrantSourceSyncOutcome>, AppStateError> {
        let sources = self.grant_sources().await?;
        let mut outcomes = Vec::with_capacity(sources.len());

        for source in sources
            .into_iter()
            .filter(|source| source.enabled && source_requires_auto_sync(source))
        {
            match self
                .sync_grant_source(&source.source_id, mark_missing_closed)
                .await
            {
                Ok(report) => outcomes.push(GrantSourceSyncOutcome {
                    source_id: source.source_id.clone(),
                    source_name: source.name.clone(),
                    success: true,
                    report: Some(report),
                    error: None,
                }),
                Err(err) => outcomes.push(GrantSourceSyncOutcome {
                    source_id: source.source_id.clone(),
                    source_name: source.name.clone(),
                    success: false,
                    report: None,
                    error: Some(err.to_string()),
                }),
            }
        }

        Ok(outcomes)
    }

    fn apply_env_defaults(mut config: LocalConfig) -> LocalConfig {
        if config.firebase_rtdb_url.is_none() {
            config.firebase_rtdb_url = std::env::var("GRANT_KEEPER_DEFAULT_FIREBASE_RTD_URL")
                .ok()
                .filter(|value| !value.trim().is_empty());
        }
        if config.firebase_web_api_key.is_none() {
            config.firebase_web_api_key =
                std::env::var("GRANT_KEEPER_DEFAULT_FIREBASE_WEB_API_KEY")
                    .ok()
                    .filter(|value| !value.trim().is_empty());
        }
        if config.firebase_auth_domain.is_none() {
            config.firebase_auth_domain =
                std::env::var("GRANT_KEEPER_DEFAULT_FIREBASE_AUTH_DOMAIN")
                    .ok()
                    .filter(|value| !value.trim().is_empty());
        }
        if config.anthropic_api_key.is_none() {
            config.anthropic_api_key = std::env::var("GRANT_KEEPER_DEFAULT_ANTHROPIC_API_KEY")
                .ok()
                .filter(|value| !value.trim().is_empty());
        }
        if config.background_refresh_interval_ms.is_none() {
            config.background_refresh_interval_ms = std::env::var(
                "GRANT_KEEPER_DEFAULT_REFRESH_INTERVAL_MS",
            )
            .ok()
            .and_then(|value| value.trim().parse::<u32>().ok())
            .filter(|value| *value > 0);
        }
        if config.firebase_uid.is_none() {
            config.firebase_uid = std::env::var("GRANT_KEEPER_DEFAULT_FIREBASE_UID")
                .ok()
                .filter(|value| !value.trim().is_empty());
        }
        if config.organization_uid.is_none() {
            config.organization_uid = std::env::var("GRANT_KEEPER_DEFAULT_ORGANIZATION_UID")
                .ok()
                .filter(|value| !value.trim().is_empty());
        }
        config
    }
}

fn is_local_session(session: Option<&FirebaseSession>) -> bool {
    session.map(is_local_session_ref).unwrap_or(false)
}

fn session_refresh_requires_reauth(error: &FirebaseError) -> bool {
    match error {
        FirebaseError::MissingRefreshToken => true,
        FirebaseError::Auth(message) => {
            let normalized = message.to_ascii_lowercase();
            normalized.contains("invalid_grant")
                || normalized.contains("token expired")
                || normalized.contains("user token expired")
                || normalized.contains("invalid refresh token")
                || normalized.contains("user disabled")
                || normalized.contains("user not found")
        }
        _ => false,
    }
}

fn is_local_session_ref(session: &FirebaseSession) -> bool {
    session.email.ends_with("@grantkeeper.local")
        || session.id_token.starts_with("dev:")
        || session.id_token.starts_with("workspace-token:")
}

fn session_mode(session: Option<&FirebaseSession>) -> SessionMode {
    match session {
        Some(session) if session.id_token.starts_with("workspace-token:") => {
            SessionMode::WorkspaceProfile
        }
        Some(session) if is_local_session_ref(session) => SessionMode::DevProfile,
        Some(_) => SessionMode::Firebase,
        None => SessionMode::None,
    }
}

fn startup_state(config: &LocalConfig, session: Option<&FirebaseSession>) -> StartupState {
    if let Some(session) = session {
        if is_local_session_ref(session) && session.id_token.starts_with("workspace-token:") {
            return StartupState::Ready;
        }
        if is_local_session_ref(session) {
            return StartupState::DevProfileReady;
        }
        if config.organization_uid.is_none() {
            return StartupState::NeedsMembership;
        }
        return StartupState::Ready;
    }
    if config.organization_uid.is_none() {
        StartupState::NeedsWorkspace
    } else if config.setup_complete {
        StartupState::NeedsLogin
    } else {
        StartupState::NeedsWorkspace
    }
}

fn workspace_bootstrap_contract() -> WorkspaceBootstrapContract {
    WorkspaceBootstrapContract {
        join_model: "self_serve_account_and_workspace".to_string(),
        required_inputs: vec![
            "email".to_string(),
            "password".to_string(),
            "organization_name_or_workspace_code".to_string(),
        ],
        identity_boundary_session_key: "firebase_uid".to_string(),
        identity_boundary_data_key: "organization_uid".to_string(),
        screens: vec![
            WorkspaceBootstrapStage {
                id: "create_or_join".to_string(),
                title: "Create or join workspace".to_string(),
                description:
                    "Choose whether to create an account, sign in, or join an existing workspace with a workspace code."
                        .to_string(),
            },
            WorkspaceBootstrapStage {
                id: "confirm_ready".to_string(),
                title: "Confirm workspace ready".to_string(),
                description:
                    "Persist the Firebase session, attach it to the selected organization, and restore workspace config."
                        .to_string(),
            },
            WorkspaceBootstrapStage {
                id: "workspace_home".to_string(),
                title: "Enter the workspace dashboard".to_string(),
                description:
                    "Land in discovery, watchlist, drafts, and organization data with the workspace preserved.".to_string(),
            },
        ],
    }
}

async fn resolve_service_account_token(
    allow_service_account_for_dev: bool,
    session: Option<&FirebaseSession>,
) -> Result<Option<String>, AppStateError> {
    if let Some(token) = configured_rtdb_auth_token() {
        return Ok(Some(token));
    }

    if let Some(session) = session {
        if is_local_session_ref(session) {
            if !allow_service_account_for_dev {
                return Ok(None);
            }
        } else {
            return Ok(Some(session.id_token.clone()));
        }
    }

    if let Ok(path) = std::env::var("GRANT_KEEPER_FIREBASE_SERVICE_ACCOUNT_JSON") {
        if !path.trim().is_empty() {
            return Ok(Some(service_account_access_token(path).await?));
        }
    }

    Ok(None)
}

fn configured_rtdb_auth_token() -> Option<String> {
    std::env::var("GRANT_KEEPER_RTDB_AUTH_TOKEN")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            std::env::var("FIREBASE_DATABASE_AUTH_TOKEN")
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
}

fn build_source_health(
    source: &GrantSourceRecord,
    grant_count: usize,
    now: chrono::DateTime<Utc>,
) -> GrantSourceHealthRecord {
    let profile = crate::source_adapters::profile_for(source);

    if let Some(note) = profile.status.note() {
        return GrantSourceHealthRecord {
            source_id: source.source_id.clone(),
            source_family: profile.family.map(str::to_string),
            canonical_source_id: profile.canonical_source_id.map(str::to_string),
            name: source.name.clone(),
            kind: source.kind.clone(),
            url: source.url.clone(),
            enabled: source.enabled,
            jurisdiction: source.jurisdiction.clone(),
            last_run_at: source.last_run_at,
            last_status: source.last_status.clone(),
            last_error: source.last_error.clone(),
            grant_count,
            health_status: profile.status.health_status(),
            health_note: Some(note.to_string()),
        };
    }

    let (health_status, health_note) = match source.kind {
        _ if source.source_id.trim().is_empty()
            || source.name.trim().is_empty()
            || source.url.trim().is_empty()
            || Url::parse(&source.url).is_err() =>
        {
            (
                GrantSourceHealthStatus::BadSource,
                Some("source metadata is incomplete or the URL is invalid".to_string()),
            )
        }
        _ if !source.enabled => (
            GrantSourceHealthStatus::Unknown,
            Some("source is disabled".to_string()),
        ),
        _ if source.last_error.is_some() => {
            (GrantSourceHealthStatus::Failing, source.last_error.clone())
        }
        _ if source.last_run_at.is_none() => (
            GrantSourceHealthStatus::Unknown,
            Some("never synced".to_string()),
        ),
        _ if source
            .last_run_at
            .as_ref()
            .map(|timestamp| {
                now.signed_duration_since(*timestamp) > chrono::Duration::hours(24)
            })
            .unwrap_or(false) =>
        {
            (
                GrantSourceHealthStatus::Stale,
                Some("last sync is older than 24 hours".to_string()),
            )
        }
        _ => (GrantSourceHealthStatus::Healthy, source.last_status.clone()),
    };

    let low_yield_threshold = profile.low_yield_threshold;
    let (health_status, health_note) = if matches!(health_status, GrantSourceHealthStatus::Healthy)
        && grant_count <= low_yield_threshold
    {
        (
            GrantSourceHealthStatus::LowYield,
            Some(format!(
                "returns only {grant_count} grants; likely needs a source-specific adapter"
            )),
        )
    } else {
        (health_status, health_note)
    };

    GrantSourceHealthRecord {
        source_id: source.source_id.clone(),
        source_family: profile.family.map(str::to_string),
        canonical_source_id: profile.canonical_source_id.map(str::to_string),
        name: source.name.clone(),
        kind: source.kind.clone(),
        url: source.url.clone(),
        enabled: source.enabled,
        jurisdiction: source.jurisdiction.clone(),
        last_run_at: source.last_run_at,
        last_status: source.last_status.clone(),
        last_error: source.last_error.clone(),
        grant_count,
        health_status,
        health_note,
    }
}

fn grant_cache_is_fresh(fetched_at: chrono::DateTime<Utc>) -> bool {
    Utc::now().signed_duration_since(fetched_at) <= GRANT_CACHE_TTL
}

fn merge_default_grant_sources(
    mut current: Vec<GrantSourceRecord>,
    defaults: Vec<GrantSourceRecord>,
) -> (Vec<GrantSourceRecord>, bool) {
    let mut changed = false;
    let existing_ids = current
        .iter()
        .map(|source| source.source_id.clone())
        .collect::<std::collections::HashSet<_>>();

    for default_source in defaults {
        if existing_ids.contains(&default_source.source_id) {
            continue;
        }
        current.push(default_source);
        changed = true;
    }

    current.sort_by(|left, right| left.source_id.cmp(&right.source_id));
    (current, changed)
}

fn default_grant_sources() -> Vec<GrantSourceRecord> {
    vec![
        GrantSourceRecord {
            source_id: "ca-grants-offered".to_string(),
            name: "California Grants Portal - Grants Offered".to_string(),
            kind: GrantSourceKind::Csv,
            url: ingest::DEFAULT_CA_GRANTS_CSV_URL.to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("Official statewide opportunity feed from data.ca.gov".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-grants-awards-2024-2025".to_string(),
            name: "California Grants Portal Grant Awards 2024-2025".to_string(),
            kind: GrantSourceKind::Csv,
            url: "https://data.ca.gov/dataset/14aca9b5-d384-43eb-ba8e-81fc94aea432/resource/97bbaf09-c935-4897-9529-b8cc56b080a1/download/grant-awards-fiscal-year-2024-2025.csv".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("State grant award feed for fiscal year 2024-2025".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-grants-awards-2023-2024".to_string(),
            name: "California Grants Portal Grant Awards 2023-2024".to_string(),
            kind: GrantSourceKind::Csv,
            url: "https://data.ca.gov/dataset/572d06aa-4f1f-44ad-80a4-167bec020881/resource/018f3523-652d-4197-a4a8-a055bfd1544f/download/grant-awards-fiscal-year-2023-2024.csv".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("State grant award feed for fiscal year 2023-2024".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-grants-awards-2022-2023".to_string(),
            name: "California Grants Portal Grant Awards 2022-2023".to_string(),
            kind: GrantSourceKind::Csv,
            url: "https://data.ca.gov/dataset/0ae62873-b7f0-498e-a595-476fa8478b0b/resource/86870d5c-e9fa-46f5-8f86-2a9893662ce1/download/grant-awards-fiscal-year-2022-2023.csv".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("Historical state grant award feed for fiscal year 2022-2023".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-grants-portal-homepage".to_string(),
            name: "California Grants Portal Homepage".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://www.grants.ca.gov/".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("Portal landing page and search surface for California grant opportunities".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-grants-portal-news".to_string(),
            name: "California Grants Portal News".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://www.grants.ca.gov/news/".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("Portal news and announcement surface".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-grants-portal-categories".to_string(),
            name: "California Grants Portal Disadvantaged Communities".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://www.grants.ca.gov/grant_categories/disadvantaged-communities/".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("Category archive for disadvantaged community opportunities".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-scc-category-grants".to_string(),
            name: "California State Coastal Conservancy Grants".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://scc.ca.gov/category/grants/".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("Current SCC grant listings and news releases".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-scc-proposition-1-grants".to_string(),
            name: "Coastal Conservancy Proposition 1 Grants".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://scc.ca.gov/grants/proposition-1-grants/".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("Program-level SCC grant page for Proposition 1 watershed projects".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-scc-coastal-stories".to_string(),
            name: "Coastal Conservancy Coastal Stories Program".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://scc.ca.gov/coastal-stories-grant-program/".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("Dedicated SCC grant program page with current funding language".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-scc-national-coastal-wetlands".to_string(),
            name: "Coastal Conservancy National Coastal Wetlands Grant Program".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://scc.ca.gov/2026/05/07/request-for-partnership-proposals-letters-of-interest-for-the-us-fish-and-wildlife-services-national-coastal-wetlands-conservation-grant-program-fy-2027/".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("Current SCC solicitation for national coastal wetlands grant participation".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-calfire-grants".to_string(),
            name: "CAL FIRE Grants".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://www.fire.ca.gov/what-we-do/grants".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("CAL FIRE grant program hub for wildfire prevention and forest health".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-calfire-wildfire-prevention-grants".to_string(),
            name: "CAL FIRE Wildfire Prevention Grants".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://www.fire.ca.gov/what-we-do/grants/wildfire-prevention-grants".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("Wildfire prevention grant opportunities and current funding rounds".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-hcd-grants-funding".to_string(),
            name: "California Department of Housing and Community Development Grants and Funding".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://www.hcd.ca.gov/grants-and-funding".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("Housing and community development funding opportunities".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-hcd-ahsc".to_string(),
            name: "Affordable Housing and Sustainable Communities".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://www.hcd.ca.gov/funding/ahsc".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("AHSC state grant and loan program for housing and transit projects".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-csd-csbg".to_string(),
            name: "Community Services Block Grant".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://www.csd.ca.gov/Pages/CSBGProgram.aspx".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("California-administered anti-poverty funding and support program".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-sgc-grant-programs".to_string(),
            name: "Strategic Growth Council Grant Programs".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://sgc.ca.gov/grant-programs/".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("Sustainability, housing, transit, and climate resilience grants".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-cnra-museum-grant".to_string(),
            name: "California Natural Resources Agency Museum Grant Program".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://resources.ca.gov/grants/california-museum".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("Museum capital and program grant opportunities".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-cdfa-grants".to_string(),
            name: "California Department of Food and Agriculture Grants".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://www.cdfa.ca.gov/grants/".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("CDFA grant program hub and funding announcements".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-cdfa-farm-to-fork".to_string(),
            name: "CDFA Farm to Fork Grants".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://cafarmtofork.cdfa.ca.gov/farm_to_fork/grants/".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("Food systems and farm-to-fork grant opportunities".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-cdfw-grants".to_string(),
            name: "California Department of Fish and Wildlife Grants".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://wildlife.ca.gov/Grants/".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("CDFW grants and conservation funding hub".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-cdfw-prop-1".to_string(),
            name: "CDFW Proposition 1 Grants".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://wildlife.ca.gov/Grants/Prop-1".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("Watershed, habitat, and restoration grant opportunities".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-carb-funding-opportunities".to_string(),
            name: "CARB Funding Opportunities".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://ww2.arb.ca.gov/funding-opportunities".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("Air quality and climate funding opportunities from CARB".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-carb-community-air-grants".to_string(),
            name: "CARB Community Air Grants".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://ww2.arb.ca.gov/capp/fund/cag/community-air-grants".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("Community air grant and emissions reduction opportunities".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-cde-available-funding".to_string(),
            name: "California Department of Education Available Funding".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://www.cde.ca.gov/fg/fo/af/".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("CDE funding announcements and application opportunities".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-cde-search-funding".to_string(),
            name: "California Department of Education Search Funding".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://www.cde.ca.gov/fg/fo/sf/".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("CDE searchable funding index".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-cde-funding-results".to_string(),
            name: "California Department of Education Funding Results".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://www.cde.ca.gov/fg/fo/fr/".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("CDE funding results and award history".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-caloes-search-for-grants".to_string(),
            name: "Cal OES Search for Grants".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://www.caloes.ca.gov/office-of-the-director/policy-administration/finance-administration/grants-management/search-for-grants/".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("Cal OES grant announcements and notices".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-caloes-grant-announcements".to_string(),
            name: "Cal OES Grant Announcements".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://www.caloes.ca.gov/grant-announcement/".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("Cal OES announcement feed for active funding opportunities".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-calepa-loans-grants".to_string(),
            name: "CalEPA Loans and Grants".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://calepa.ca.gov/loansgrants/".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("Environmental loans and grants page".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-calepa-ej-action-grants".to_string(),
            name: "CalEPA EJ Action Grants".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://calepa.ca.gov/ejactiongrants/".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("Environmental justice grant funding page".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-calepa-enforcement-grants".to_string(),
            name: "CalEPA Environmental Enforcement and Training Grants".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://calepa.ca.gov/enforcement/grants-scholarships-environmental-enforcement/".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("Environmental enforcement and training grants page".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-cnra-grants".to_string(),
            name: "California Natural Resources Agency Grant Programs".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://resources.ca.gov/grants".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("State natural resources grant program hub".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-arts-council-grants".to_string(),
            name: "California Arts Council Grant Programs".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://arts.ca.gov/grants/grant-programs/".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("Arts Council statewide grant opportunities".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-calosba-funding".to_string(),
            name: "CalOSBA Funding Opportunities".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://calosba.ca.gov/for-small-businesses-and-non-profits/funding-opportunities-for-small-businesses-and-nonprofits/".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("Small business and nonprofit funding opportunities".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-coastal-conservancy-grants".to_string(),
            name: "California State Coastal Conservancy Grants".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://scc.ca.gov/grants/".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("Root SCC grants hub is blocked; use the dedicated program pages instead".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
        GrantSourceRecord {
            source_id: "ca-csac-cal-grant".to_string(),
            name: "California Student Aid Commission Cal Grant".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://www.csac.ca.gov/cal-grant".to_string(),
            enabled: true,
            jurisdiction: Some("California".to_string()),
            notes: Some("Cal Grant page is not a public grant opportunity feed and should remain adapter-gated".to_string()),
            last_run_at: None,
            last_status: None,
            last_error: None,
            ..Default::default()
        },
    ]
    .into_iter()
    .map(annotate_source_registry)
    .collect()
}

fn parse_grant_source_collection(payload: Value) -> Vec<GrantSourceRecord> {
    collection_entries(payload)
        .into_iter()
        .filter_map(|(key, value)| normalize_grant_source(key, value).ok())
        .collect()
}

fn normalize_grant_source(
    fallback_source_id: String,
    value: Value,
) -> Result<GrantSourceRecord, AppStateError> {
    let mut raw: GrantSourceRecord =
        serde_json::from_value(value).map_err(|err| FirebaseError::Auth(err.to_string()))?;
    if raw.source_id.trim().is_empty() {
        raw.source_id = fallback_source_id;
    }
    if raw.name.trim().is_empty() {
        raw.name = raw.source_id.clone();
    }
    raw = annotate_source_registry(raw);
    Ok(raw)
}

fn annotate_source_registry(mut source: GrantSourceRecord) -> GrantSourceRecord {
    source.source_family = source_family_for_id(&source.source_id).map(str::to_string);
    source.canonical_source_id = canonical_source_id_for_id(&source.source_id).map(str::to_string);
    source
}

fn normalize_grant_source_registry(
    mut sources: Vec<GrantSourceRecord>,
) -> (Vec<GrantSourceRecord>, bool) {
    let mut changed = false;
    let canonical_ids = sources
        .iter()
        .map(|source| source.source_id.clone())
        .collect::<std::collections::HashSet<_>>();

    for source in &mut sources {
        if let Some(canonical) = canonical_source_id_for_id(&source.source_id) {
            if canonical_ids.contains(canonical) {
                source.enabled = false;
                source.last_status = Some("alias handled by canonical source".to_string());
                source.last_error = None;
                source.canonical_source_id = Some(canonical.to_string());
                source.source_family = source_family_for_id(canonical).map(str::to_string);
                changed = true;
            } else {
                source.source_id = canonical.to_string();
                source.canonical_source_id = None;
                source.source_family = source_family_for_id(&source.source_id).map(str::to_string);
                changed = true;
            }
        } else {
            source.source_family = source_family_for_id(&source.source_id).map(str::to_string);
            source.canonical_source_id = None;
        }
    }

    sources.retain(|source| {
        if let Some(canonical) = canonical_source_id_for_id(&source.source_id) {
            !canonical_ids.contains(canonical)
        } else {
            true
        }
    });

    sources.sort_by(|left, right| left.source_id.cmp(&right.source_id));
    (sources, changed)
}

fn slug_source_name(name: &str) -> String {
    let slug = name
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>();
    slug.trim_matches('-').replace("--", "-")
}

fn slug_workspace_name(name: &str, email: &str) -> String {
    let org = slug_source_name(name);
    let domain = email
        .split('@')
        .nth(1)
        .map(slug_source_name)
        .filter(|value| !value.is_empty());
    match domain {
        Some(domain) if !org.is_empty() => format!("{org}-{domain}"),
        Some(domain) if org.is_empty() => domain,
        _ => org,
    }
}

fn resolve_existing_workspace_role(
    existing_membership: Option<&WorkspaceMembershipRecord>,
    organization_contact_email: Option<&str>,
    session_email: &str,
) -> Option<String> {
    if let Some(membership) = existing_membership {
        return Some(membership.role.clone());
    }

    let session_email = session_email.trim();
    let contact_email = organization_contact_email?.trim();
    if session_email.is_empty() || contact_email.is_empty() {
        return None;
    }

    if contact_email.eq_ignore_ascii_case(session_email) {
        return Some("owner".to_string());
    }

    None
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
    use crate::config::{ConfigStore, SessionStore};
    use tempfile::TempDir;

    fn blank_config() -> LocalConfig {
        LocalConfig::default()
    }

    fn sample_source() -> GrantSourceRecord {
        GrantSourceRecord {
            source_id: "source-1".to_string(),
            source_family: Some("family-1".to_string()),
            canonical_source_id: Some("canonical-1".to_string()),
            name: "Example Grants".to_string(),
            kind: GrantSourceKind::Webpage,
            url: "https://example.org/grants".to_string(),
            enabled: true,
            jurisdiction: Some("CA".to_string()),
            notes: None,
            last_run_at: Some(Utc::now() - chrono::Duration::hours(1)),
            last_status: Some("ok".to_string()),
            last_error: None,
        }
    }

    #[test]
    fn startup_state_requires_workspace_when_no_config_or_session() {
        assert_eq!(
            startup_state(&blank_config(), None),
            StartupState::NeedsWorkspace
        );
    }

    #[test]
    fn startup_state_reports_workspace_ready_when_workspace_session_exists() {
        let mut config = blank_config();
        config.organization_uid = Some("workspace-1".to_string());
        config.setup_complete = true;
        let session = FirebaseSession {
            email: "writer@example.org".to_string(),
            uid: "workspace:workspace-1:writer".to_string(),
            id_token: "workspace-token:workspace-1:123".to_string(),
            refresh_token: "refresh".to_string(),
            expires_at: Utc::now() + Duration::days(1),
        };

        assert_eq!(startup_state(&config, Some(&session)), StartupState::Ready);
    }

    #[test]
    fn startup_state_reports_dev_profile_ready_for_local_session() {
        let config = blank_config();
        let session = FirebaseSession {
            email: "dev@grantkeeper.local".to_string(),
            uid: "dev-user".to_string(),
            id_token: "dev:token".to_string(),
            refresh_token: "refresh".to_string(),
            expires_at: Utc::now() + Duration::days(1),
        };

        assert_eq!(
            startup_state(&config, Some(&session)),
            StartupState::DevProfileReady
        );
    }

    #[test]
    fn workspace_bootstrap_contract_has_three_steps() {
        let contract = workspace_bootstrap_contract();
        assert_eq!(contract.join_model, "self_serve_account_and_workspace");
        assert_eq!(contract.identity_boundary_session_key, "firebase_uid");
        assert_eq!(contract.identity_boundary_data_key, "organization_uid");
        assert_eq!(
            contract.required_inputs,
            vec!["email", "password", "organization_name_or_workspace_code"]
        );
        assert_eq!(contract.screens.len(), 3);
        assert_eq!(contract.screens[0].id, "create_or_join");
        assert_eq!(contract.screens[1].id, "confirm_ready");
        assert_eq!(contract.screens[2].id, "workspace_home");
    }

    #[test]
    fn validate_setup_state_reports_missing_workspace_fields() {
        let config = LocalConfig {
            firebase_rtdb_url: Some("https://example.firebaseio.com".to_string()),
            organization_uid: None,
            setup_complete: false,
            ..Default::default()
        };

        let validation = AppState::validate_setup_state(&config, None);

        assert!(!validation.ready);
        assert!(!validation.workspace_ready);
        assert_eq!(validation.session_mode, SessionMode::None);
        assert_eq!(
            validation.missing_fields,
            vec!["organization_uid".to_string()]
        );
    }

    #[test]
    fn validate_setup_state_reports_ready_workspace_session() {
        let config = LocalConfig {
            firebase_rtdb_url: Some("https://example.firebaseio.com".to_string()),
            organization_uid: Some("org-1".to_string()),
            setup_complete: true,
            ..Default::default()
        };
        let session = FirebaseSession {
            email: "writer@example.org".to_string(),
            uid: "workspace:org-1:writer".to_string(),
            id_token: "workspace-token:org-1:123".to_string(),
            refresh_token: "refresh".to_string(),
            expires_at: Utc::now() + Duration::days(1),
        };

        let validation = AppState::validate_setup_state(&config, Some(&session));

        assert!(validation.ready);
        assert!(validation.workspace_ready);
        assert!(validation.signed_in);
        assert_eq!(validation.session_mode, SessionMode::WorkspaceProfile);
    }

    #[test]
    fn validate_setup_state_reports_dev_profile_ready_without_workspace_session() {
        let config = LocalConfig {
            firebase_rtdb_url: Some("https://example.firebaseio.com".to_string()),
            ..Default::default()
        };
        let session = FirebaseSession {
            email: "dev@grantkeeper.local".to_string(),
            uid: "dev-user".to_string(),
            id_token: "dev:token".to_string(),
            refresh_token: "refresh".to_string(),
            expires_at: Utc::now() + Duration::days(1),
        };

        let validation = AppState::validate_setup_state(&config, Some(&session));

        assert!(!validation.ready);
        assert!(validation.dev_profile_ready);
        assert_eq!(validation.session_mode, SessionMode::DevProfile);
    }

    #[test]
    fn build_source_health_marks_invalid_metadata_as_bad_source() {
        let mut source = sample_source();
        source.url = "not a url".to_string();

        let health = build_source_health(&source, 0, Utc::now());

        assert_eq!(health.health_status, GrantSourceHealthStatus::BadSource);
        assert_eq!(
            health.health_note.as_deref(),
            Some("source metadata is incomplete or the URL is invalid")
        );
    }

    #[test]
    fn build_source_health_marks_known_adapter_gated_sources_as_pending_adapter() {
        let mut source = sample_source();
        source.source_id = "ca-csac-cal-grant".to_string();

        let health = build_source_health(&source, 0, Utc::now());

        assert_eq!(health.health_status, GrantSourceHealthStatus::PendingAdapter);
        assert_eq!(
            health.health_note.as_deref(),
            Some("CSAC Cal Grant page is not a public opportunity feed and is blocked for automation")
        );
    }

    #[test]
    fn build_source_health_marks_stale_sources() {
        let mut source = sample_source();
        source.last_run_at = Some(Utc::now() - chrono::Duration::hours(25));

        let health = build_source_health(&source, 3, Utc::now());

        assert_eq!(health.health_status, GrantSourceHealthStatus::Stale);
        assert_eq!(
            health.health_note.as_deref(),
            Some("last sync is older than 24 hours")
        );
    }

    #[test]
    fn build_source_health_marks_low_yield_sources() {
        let source = sample_source();
        let health = build_source_health(&source, 0, Utc::now());

        assert_eq!(health.health_status, GrantSourceHealthStatus::LowYield);
        assert_eq!(
            health.health_note.as_deref(),
            Some("returns only 0 grants; likely needs a source-specific adapter")
        );
    }

    #[test]
    fn build_source_health_marks_failing_sources_before_yield_checks() {
        let mut source = sample_source();
        source.last_error = Some("timeout waiting for upstream source".to_string());

        let health = build_source_health(&source, 0, Utc::now());

        assert_eq!(health.health_status, GrantSourceHealthStatus::Failing);
        assert_eq!(
            health.health_note.as_deref(),
            Some("timeout waiting for upstream source")
        );
    }

    #[test]
    fn grant_cache_is_fresh_within_ttl() {
        assert!(grant_cache_is_fresh(Utc::now() - Duration::minutes(1)));
    }

    #[test]
    fn grant_cache_expires_after_ttl() {
        assert!(!grant_cache_is_fresh(Utc::now() - Duration::minutes(5)));
    }

    #[test]
    fn resolve_existing_workspace_role_prefers_existing_membership_role() {
        let membership = WorkspaceMembershipRecord {
            role: "member".to_string(),
            ..Default::default()
        };

        let role = resolve_existing_workspace_role(
            Some(&membership),
            Some("owner@example.org"),
            "owner@example.org",
        );

        assert_eq!(role.as_deref(), Some("member"));
    }

    #[test]
    fn resolve_existing_workspace_role_allows_contact_email_to_resume_owner_access() {
        let role = resolve_existing_workspace_role(
            None,
            Some("Owner@Example.org"),
            "owner@example.org",
        );

        assert_eq!(role.as_deref(), Some("owner"));
    }

    #[test]
    fn resolve_existing_workspace_role_rejects_unmatched_email_without_membership() {
        let role = resolve_existing_workspace_role(
            None,
            Some("owner@example.org"),
            "writer@example.org",
        );

        assert_eq!(role, None);
    }

    fn live_test_config() -> Option<LocalConfig> {
        let _ = dotenvy::from_path("../.env");
        let _ = dotenvy::from_path(".env");
        let rtdb_url = std::env::var("GRANT_KEEPER_DEFAULT_FIREBASE_RTD_URL").ok()?;
        let web_api_key = std::env::var("GRANT_KEEPER_DEFAULT_FIREBASE_WEB_API_KEY").ok()?;
        let auth_domain = std::env::var("GRANT_KEEPER_DEFAULT_FIREBASE_AUTH_DOMAIN").ok()?;
        if rtdb_url.trim().is_empty() || web_api_key.trim().is_empty() || auth_domain.trim().is_empty() {
            return None;
        }
        Some(LocalConfig {
            firebase_rtdb_url: Some(rtdb_url),
            firebase_web_api_key: Some(web_api_key),
            firebase_auth_domain: Some(auth_domain),
            ..Default::default()
        })
    }

    fn temp_app_state(config: LocalConfig) -> (TempDir, AppState) {
        let dir = TempDir::new().unwrap();
        let config_store = ConfigStore::new(dir.path().join("config.json"));
        let session_store = SessionStore::new(dir.path().join("session.json"));
        let state = AppState {
            inner: Arc::new(RwLock::new(AppStateInner {
                config_store,
                session_store,
                config,
                session: None,
                grant_cache: None,
            })),
        };
        (dir, state)
    }

    #[tokio::test]
    #[ignore]
    async fn live_workspace_invite_auth_smoke() {
        let Some(config) = live_test_config() else {
            panic!("missing live Firebase/RTDB config in .env");
        };
        let (_dir, state) = temp_app_state(config);
        let nonce = Uuid::new_v4().simple().to_string();
        let workspace_code = format!("smoke-{nonce}");
        let owner_email = format!("owner+{nonce}@grantkeeper.local");
        let member_email = format!("member+{nonce}@grantkeeper.local");
        let owner_password = format!("GrantKeeper!{}aa", &nonce[..8]);
        let member_password = format!("GrantKeeper!{}bb", &nonce[..8]);

        let owner = state
            .create_workspace_account(WorkspaceCreateRequest {
                email: owner_email.clone(),
                password: owner_password.clone(),
                organization_name: "Grant Keeper Smoke Org".to_string(),
                workspace_code: Some(workspace_code.clone()),
            })
            .await
            .expect("owner workspace creation");
        assert_eq!(owner.email, owner_email);

        let invite = state
            .create_workspace_invite()
            .await
            .expect("owner invite creation");
        assert!(invite.active);
        assert_eq!(invite.organization_uid, workspace_code);

        state.clear_session().await.expect("clear owner session");

        let member = state
            .sign_up_to_join_workspace(WorkspaceJoinRequest {
                email: member_email.clone(),
                password: member_password.clone(),
                workspace_code: None,
                invite_token: Some(invite.invite_token.clone()),
            })
            .await
            .expect("member join via invite");
        assert_eq!(member.email, member_email);

        let reused = state
            .sign_up_to_join_workspace(WorkspaceJoinRequest {
                email: format!("reuse+{nonce}@grantkeeper.local"),
                password: format!("GrantKeeper!{}cc", &nonce[..8]),
                workspace_code: None,
                invite_token: Some(invite.invite_token.clone()),
            })
            .await;
        assert!(reused.is_err(), "invite token should be single-use");

        state.clear_session().await.expect("clear member session");

        let member_signed_in = state
            .sign_in_to_workspace(WorkspaceJoinRequest {
                email: member_email.clone(),
                password: member_password.clone(),
                workspace_code: Some(workspace_code.clone()),
                invite_token: None,
            })
            .await
            .expect("member sign in to existing workspace");
        assert_eq!(member_signed_in.email, member_email);

        state.clear_session().await.expect("clear member session again");

        let owner_signed_in = state
            .sign_in_to_workspace(WorkspaceJoinRequest {
                email: owner_email.clone(),
                password: owner_password.clone(),
                workspace_code: Some(workspace_code.clone()),
                invite_token: None,
            })
            .await
            .expect("owner sign in to existing workspace");
        assert_eq!(owner_signed_in.email, owner_email);

        state
            .send_password_reset_email(&owner_email)
            .await
            .expect("owner password reset request");

        state.clear_session().await.expect("clear before invalid sign in");
        let invalid = state
            .sign_in_to_workspace(WorkspaceJoinRequest {
                email: member_email,
                password: member_password,
                workspace_code: Some(format!("{workspace_code}-invalid")),
                invite_token: None,
            })
            .await;
        assert!(invalid.is_err(), "invalid workspace code should fail");
        assert!(
            state.current_session().await.is_none(),
            "invalid workspace code should not leave an active session"
        );
    }
}
