use crate::models::{ConfigUpdate, FirebaseSession, LocalConfig};
use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("failed to determine config directory")]
    MissingConfigDir,
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone)]
pub struct ConfigStore {
    path: PathBuf,
}

#[derive(Debug, Clone)]
pub struct SessionStore {
    path: PathBuf,
}

impl ConfigStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn default_path() -> Result<PathBuf, ConfigError> {
        let base = dirs::config_dir().ok_or(ConfigError::MissingConfigDir)?;
        Ok(base.join("Grant Keeper").join("config.json"))
    }

    pub async fn load(&self) -> Result<LocalConfig, ConfigError> {
        match tokio::fs::read_to_string(&self.path).await {
            Ok(contents) => Ok(serde_json::from_str(&contents)?),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(LocalConfig::default()),
            Err(err) => Err(ConfigError::Io(err)),
        }
    }

    pub async fn save(&self, config: &LocalConfig) -> Result<(), ConfigError> {
        if let Some(parent) = self.path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let payload = serde_json::to_string_pretty(config)?;
        tokio::fs::write(&self.path, payload).await?;
        Ok(())
    }

    pub fn apply_update(current: &LocalConfig, update: &ConfigUpdate) -> LocalConfig {
        LocalConfig {
            firebase_rtdb_url: update
                .firebase_rtdb_url
                .clone()
                .or_else(|| current.firebase_rtdb_url.clone()),
            firebase_web_api_key: update
                .firebase_web_api_key
                .clone()
                .or_else(|| current.firebase_web_api_key.clone()),
            firebase_auth_domain: update
                .firebase_auth_domain
                .clone()
                .or_else(|| current.firebase_auth_domain.clone()),
            google_oauth_client_id: update
                .google_oauth_client_id
                .clone()
                .or_else(|| current.google_oauth_client_id.clone()),
            anthropic_api_key: update
                .anthropic_api_key
                .clone()
                .or_else(|| current.anthropic_api_key.clone()),
            background_refresh_interval_ms: update
                .background_refresh_interval_ms
                .or(current.background_refresh_interval_ms),
            draft_generation_preference: update
                .draft_generation_preference
                .clone()
                .unwrap_or(current.draft_generation_preference.clone()),
            firebase_uid: update
                .firebase_uid
                .clone()
                .or_else(|| current.firebase_uid.clone()),
            organization_uid: update
                .organization_uid
                .clone()
                .and_then(|v| if v.is_empty() { None } else { Some(v) })
                .or_else(|| current.organization_uid.clone()),
            setup_complete: update.setup_complete.unwrap_or(current.setup_complete),
            last_sync_at: update.last_sync_at.or_else(|| current.last_sync_at.clone()),
        }
    }
}

impl SessionStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn default_path() -> Result<PathBuf, ConfigError> {
        let base = dirs::config_dir().ok_or(ConfigError::MissingConfigDir)?;
        Ok(base.join("Grant Keeper").join("session.json"))
    }

    pub async fn load(&self) -> Result<Option<FirebaseSession>, ConfigError> {
        match tokio::fs::read_to_string(&self.path).await {
            Ok(contents) => Ok(Some(serde_json::from_str(&contents)?)),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(err) => Err(ConfigError::Io(err)),
        }
    }

    pub async fn save(&self, session: &FirebaseSession) -> Result<(), ConfigError> {
        if let Some(parent) = self.path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let payload = serde_json::to_string_pretty(session)?;
        tokio::fs::write(&self.path, payload).await?;
        Ok(())
    }

    pub async fn clear(&self) -> Result<(), ConfigError> {
        match tokio::fs::remove_file(&self.path).await {
            Ok(()) => Ok(()),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(err) => Err(ConfigError::Io(err)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::DraftGenerationPreference;
    use chrono::Utc;
    use tempfile::TempDir;

    fn temp_config_store() -> (TempDir, ConfigStore) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("config.json");
        (dir, ConfigStore::new(path))
    }

    fn temp_session_store() -> (TempDir, SessionStore) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("session.json");
        (dir, SessionStore::new(path))
    }

    fn sample_session() -> FirebaseSession {
        FirebaseSession {
            email: "test@example.com".into(),
            uid: "uid-abc".into(),
            id_token: "id-tok".into(),
            refresh_token: "ref-tok".into(),
            expires_at: Utc::now() + chrono::Duration::hours(1),
        }
    }

    // ── apply_update unit tests ────────────────────────────────────────────

    #[test]
    fn apply_update_preserves_existing_values_when_not_overridden() {
        let current = LocalConfig {
            firebase_rtdb_url: Some("https://example.firebaseio.com".into()),
            firebase_web_api_key: Some("abc".into()),
            firebase_auth_domain: Some("example.firebaseapp.com".into()),
            google_oauth_client_id: Some("google-client".into()),
            anthropic_api_key: Some("sk-ant-1".into()),
            background_refresh_interval_ms: Some(120_000),
            draft_generation_preference: DraftGenerationPreference::Ai,
            firebase_uid: Some("uid-1".into()),
            organization_uid: Some("org-1".into()),
            setup_complete: false,
            last_sync_at: Some(Utc::now()),
        };
        let update = ConfigUpdate {
            firebase_rtdb_url: None,
            firebase_web_api_key: Some("def".into()),
            firebase_auth_domain: None,
            google_oauth_client_id: None,
            anthropic_api_key: None,
            background_refresh_interval_ms: None,
            draft_generation_preference: None,
            firebase_uid: None,
            organization_uid: None,
            setup_complete: Some(true),
            last_sync_at: None,
        };

        let next = ConfigStore::apply_update(&current, &update);
        assert_eq!(next.firebase_rtdb_url, current.firebase_rtdb_url);
        assert_eq!(next.firebase_web_api_key, Some("def".into()));
        assert_eq!(next.setup_complete, true);
        assert_eq!(next.last_sync_at, current.last_sync_at);
    }

    #[test]
    fn apply_update_all_none_returns_identical_config() {
        let current = LocalConfig {
            firebase_rtdb_url: Some("https://example.firebaseio.com".into()),
            firebase_web_api_key: Some("key".into()),
            firebase_auth_domain: Some("domain".into()),
            google_oauth_client_id: Some("google-client".into()),
            anthropic_api_key: Some("sk-ant".into()),
            background_refresh_interval_ms: None,
            draft_generation_preference: DraftGenerationPreference::Ai,
            firebase_uid: Some("uid".into()),
            organization_uid: Some("org".into()),
            setup_complete: true,
            last_sync_at: None,
        };
        let update = ConfigUpdate {
            firebase_rtdb_url: None,
            firebase_web_api_key: None,
            firebase_auth_domain: None,
            google_oauth_client_id: None,
            anthropic_api_key: None,
            background_refresh_interval_ms: None,
            draft_generation_preference: None,
            firebase_uid: None,
            organization_uid: None,
            setup_complete: None,
            last_sync_at: None,
        };
        let next = ConfigStore::apply_update(&current, &update);
        assert_eq!(next, current);
    }

    #[test]
    fn apply_update_overrides_all_fields_when_all_provided() {
        let current = LocalConfig::default();
        let update = ConfigUpdate {
            firebase_rtdb_url: Some("https://new.firebaseio.com".into()),
            firebase_web_api_key: Some("new-key".into()),
            firebase_auth_domain: Some("new.firebaseapp.com".into()),
            google_oauth_client_id: Some("new-google-client".into()),
            anthropic_api_key: Some("sk-ant-new".into()),
            background_refresh_interval_ms: Some(90_000),
            draft_generation_preference: Some(DraftGenerationPreference::Ai),
            firebase_uid: Some("new-uid".into()),
            organization_uid: Some("new-org".into()),
            setup_complete: Some(true),
            last_sync_at: None,
        };
        let next = ConfigStore::apply_update(&current, &update);
        assert_eq!(
            next.firebase_rtdb_url,
            Some("https://new.firebaseio.com".into())
        );
        assert_eq!(next.firebase_web_api_key, Some("new-key".into()));
        assert_eq!(
            next.google_oauth_client_id,
            Some("new-google-client".into())
        );
        assert_eq!(next.setup_complete, true);
    }

    #[test]
    fn apply_update_setup_complete_false_overrides_true() {
        let current = LocalConfig {
            setup_complete: true,
            organization_uid: Some("org".into()),
            background_refresh_interval_ms: None,
            ..Default::default()
        };
        let update = ConfigUpdate {
            setup_complete: Some(false),
            organization_uid: None,
            background_refresh_interval_ms: None,
            ..Default::default()
        };
        let next = ConfigStore::apply_update(&current, &update);
        assert!(!next.setup_complete);
    }

    // ── security: apply_update preserves literal values ────────────────────

    #[test]
    fn apply_update_with_xss_in_api_key_preserves_literal_value() {
        let current = LocalConfig::default();
        let xss_key = "<script>alert(1)</script>";
        let update = ConfigUpdate {
            anthropic_api_key: Some(xss_key.to_string()),
            organization_uid: None,
            background_refresh_interval_ms: None,
            ..Default::default()
        };
        let next = ConfigStore::apply_update(&current, &update);
        assert_eq!(next.anthropic_api_key.as_deref(), Some(xss_key));
    }

    #[test]
    fn apply_update_with_path_traversal_in_rtdb_url_preserves_literal_value() {
        let current = LocalConfig::default();
        let traversal = "../../etc/passwd";
        let update = ConfigUpdate {
            firebase_rtdb_url: Some(traversal.to_string()),
            organization_uid: None,
            background_refresh_interval_ms: None,
            ..Default::default()
        };
        let next = ConfigStore::apply_update(&current, &update);
        assert_eq!(next.firebase_rtdb_url.as_deref(), Some(traversal));
    }

    // ── ConfigStore async I/O ─────────────────────────────────────────────

    #[tokio::test]
    async fn config_store_load_missing_file_returns_default() {
        let (_dir, store) = temp_config_store();
        let config = store.load().await.unwrap();
        assert_eq!(config, LocalConfig::default());
    }

    #[tokio::test]
    async fn config_store_save_and_reload_roundtrips() {
        let (_dir, store) = temp_config_store();
        let config = LocalConfig {
            firebase_rtdb_url: Some("https://rt.firebaseio.com".into()),
            firebase_web_api_key: Some("web-key".into()),
            firebase_auth_domain: Some("auth.example.com".into()),
            google_oauth_client_id: Some("google-client".into()),
            anthropic_api_key: Some("sk-ant-123".into()),
            background_refresh_interval_ms: Some(120_000),
            draft_generation_preference: DraftGenerationPreference::Ai,
            firebase_uid: Some("uid-save-test".into()),
            organization_uid: Some("org-save-test".into()),
            setup_complete: true,
            last_sync_at: None,
        };
        store.save(&config).await.unwrap();
        let loaded = store.load().await.unwrap();
        assert_eq!(loaded, config);
    }

    #[tokio::test]
    async fn config_store_save_creates_parent_directories() {
        let dir = TempDir::new().unwrap();
        let nested_path = dir.path().join("a").join("b").join("config.json");
        let store = ConfigStore::new(nested_path.clone());
        store.save(&LocalConfig::default()).await.unwrap();
        assert!(nested_path.exists());
    }

    #[tokio::test]
    async fn config_store_load_corrupted_json_returns_json_error() {
        let (_dir, store) = temp_config_store();
        tokio::fs::write(&store.path, b"{not valid json{{{{")
            .await
            .unwrap();
        let err = store.load().await.unwrap_err();
        assert!(matches!(err, ConfigError::Json(_)));
    }

    #[tokio::test]
    async fn config_store_load_empty_file_returns_json_error() {
        let (_dir, store) = temp_config_store();
        tokio::fs::write(&store.path, b"").await.unwrap();
        let err = store.load().await.unwrap_err();
        assert!(matches!(err, ConfigError::Json(_)));
    }

    #[tokio::test]
    async fn config_store_overwrite_updates_on_disk() {
        let (_dir, store) = temp_config_store();
        let v1 = LocalConfig {
            firebase_uid: Some("uid-v1".into()),
            organization_uid: Some("org-v1".into()),
            background_refresh_interval_ms: None,
            ..Default::default()
        };
        store.save(&v1).await.unwrap();
        let v2 = LocalConfig {
            firebase_uid: Some("uid-v2".into()),
            organization_uid: Some("org-v2".into()),
            setup_complete: true,
            background_refresh_interval_ms: Some(180_000),
            ..Default::default()
        };
        store.save(&v2).await.unwrap();
        let loaded = store.load().await.unwrap();
        assert_eq!(loaded.firebase_uid.as_deref(), Some("uid-v2"));
        assert!(loaded.setup_complete);
    }

    // ── SessionStore async I/O ────────────────────────────────────────────

    #[tokio::test]
    async fn session_store_load_missing_file_returns_none() {
        let (_dir, store) = temp_session_store();
        let result = store.load().await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn session_store_save_and_reload_roundtrips() {
        let (_dir, store) = temp_session_store();
        let session = sample_session();
        store.save(&session).await.unwrap();
        let loaded = store.load().await.unwrap().unwrap();
        assert_eq!(loaded.uid, session.uid);
        assert_eq!(loaded.id_token, session.id_token);
        assert_eq!(loaded.email, session.email);
    }

    #[tokio::test]
    async fn session_store_clear_removes_file() {
        let (_dir, store) = temp_session_store();
        store.save(&sample_session()).await.unwrap();
        store.clear().await.unwrap();
        let result = store.load().await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn session_store_clear_is_idempotent_on_missing_file() {
        let (_dir, store) = temp_session_store();
        // File doesn't exist — clear should not error
        store.clear().await.unwrap();
        store.clear().await.unwrap();
    }

    #[tokio::test]
    async fn session_store_load_corrupted_json_returns_json_error() {
        let (_dir, store) = temp_session_store();
        tokio::fs::write(&store.path, b"corrupted data!!!")
            .await
            .unwrap();
        let err = store.load().await.unwrap_err();
        assert!(matches!(err, ConfigError::Json(_)));
    }

    // ── performance ───────────────────────────────────────────────────────

    #[test]
    fn apply_update_is_fast() {
        let current = LocalConfig::default();
        let update = ConfigUpdate {
            firebase_web_api_key: Some("key".into()),
            background_refresh_interval_ms: Some(120_000),
            ..Default::default()
        };
        let start = std::time::Instant::now();
        for _ in 0..100_000 {
            let _ = ConfigStore::apply_update(&current, &update);
        }
        assert!(
            start.elapsed().as_millis() < 500,
            "100k apply_update calls should complete in under 500ms"
        );
    }
}
