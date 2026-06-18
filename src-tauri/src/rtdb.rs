use rtdb_rs::RtdbClient;
use serde::Serialize;
use std::path::Path;
use std::time::Duration as StdDuration;
use tokio::time::sleep;

#[derive(Debug, thiserror::Error)]
pub enum RtdbError {
    #[error("rtdb request failed: {0}")]
    Request(#[from] rtdb_rs::RtdbError),
    #[error("json serialization failed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("service account auth failed: {0}")]
    ServiceAccount(String),
}

#[derive(Debug, Clone)]
pub struct RealtimeDatabaseClient {
    database_url: String,
    auth_token: Option<String>,
}

impl RealtimeDatabaseClient {
    pub fn new(database_url: impl Into<String>, auth_token: Option<String>) -> Self {
        Self {
            database_url: database_url.into(),
            auth_token,
        }
    }

    pub async fn get_json(&self, path: &str) -> Result<serde_json::Value, RtdbError> {
        self.retry_transient("rtdb get_json", || async {
            let client = RtdbClient::new(
                self.database_url.clone(),
                self.auth_token.clone().unwrap_or_default(),
            );
            Ok(client.get(path).await?)
        })
        .await
    }

    pub async fn put_json<T>(&self, path: &str, value: &T) -> Result<(), RtdbError>
    where
        T: Serialize + ?Sized,
    {
        let payload = serde_json::to_value(value)?;
        self.retry_transient("rtdb put_json", || async {
            let client = RtdbClient::new(
                self.database_url.clone(),
                self.auth_token.clone().unwrap_or_default(),
            );
            client.put(path, &payload).await?;
            Ok(())
        })
        .await
    }

    pub async fn delete(&self, path: &str) -> Result<(), RtdbError> {
        self.retry_transient("rtdb delete", || async {
            let client = RtdbClient::new(
                self.database_url.clone(),
                self.auth_token.clone().unwrap_or_default(),
            );
            client.delete(path).await?;
            Ok(())
        })
        .await
    }

    async fn retry_transient<T, F, Fut>(
        &self,
        _label: &str,
        mut operation: F,
    ) -> Result<T, RtdbError>
    where
        F: FnMut() -> Fut,
        Fut: std::future::Future<Output = Result<T, RtdbError>>,
    {
        let attempts = 3;
        let mut delay = StdDuration::from_millis(250);

        for attempt in 1..=attempts {
            match operation().await {
                Ok(result) => return Ok(result),
                Err(err) if attempt < attempts && is_transient_error(&err) => {
                    sleep(delay).await;
                    delay *= 2;
                }
                Err(err) => return Err(err),
            }
        }

        unreachable!("retry loop must return before exhausting attempts")
    }
}

pub async fn service_account_access_token(path: impl AsRef<Path>) -> Result<String, RtdbError> {
    let resolved_path = resolve_service_account_path(path.as_ref())?;
    let contents = tokio::fs::read_to_string(&resolved_path)
        .await
        .map_err(|err| RtdbError::ServiceAccount(err.to_string()))?;
    let key: ServiceAccountKey = serde_json::from_str(&contents)
        .map_err(|err| RtdbError::ServiceAccount(err.to_string()))?;
    let jwt = rtdb_rs::generate_jwt(&key.private_key, &key.client_email)
        .await
        .map_err(|err| RtdbError::ServiceAccount(err.to_string()))?;
    rtdb_rs::exchange_jwt_for_access_token(&jwt)
        .await
        .map_err(|err| RtdbError::ServiceAccount(err.to_string()))
}

#[derive(Debug, serde::Deserialize)]
struct ServiceAccountKey {
    client_email: String,
    private_key: String,
}

fn resolve_service_account_path(path: &Path) -> Result<std::path::PathBuf, RtdbError> {
    let candidates = if path.is_absolute() {
        vec![path.to_path_buf()]
    } else {
        let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let workspace_root = manifest_dir
            .parent()
            .map(|parent| parent.to_path_buf())
            .unwrap_or_else(|| manifest_dir.clone());
        vec![
            std::env::current_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."))
                .join(path),
            manifest_dir.join(path),
            workspace_root.join(path),
            path.to_path_buf(),
        ]
    };

    candidates
        .into_iter()
        .find(|candidate| candidate.exists())
        .ok_or_else(|| {
            RtdbError::ServiceAccount(format!(
                "service account file not found: {}",
                path.display()
            ))
        })
}

fn is_transient_error(error: &RtdbError) -> bool {
    match error {
        RtdbError::Request(rtdb_error) => match rtdb_error {
            rtdb_rs::RtdbError::Request(request_error) => {
                request_error.is_connect()
                    || request_error.is_timeout()
                    || request_error.is_body()
                    || request_error
                        .to_string()
                        .to_ascii_lowercase()
                        .contains("connection reset")
            }
            _ => false,
        },
        _ => false,
    }
}
