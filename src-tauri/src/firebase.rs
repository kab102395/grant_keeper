use crate::models::FirebaseSession;
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum FirebaseError {
    #[error("missing firebase api key")]
    MissingApiKey,
    #[error("missing google id token")]
    MissingGoogleIdToken,
    #[error("missing refresh token")]
    MissingRefreshToken,
    #[error("firebase auth request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("json serialization failed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("firebase auth returned an error: {0}")]
    Auth(String),
}

#[derive(Debug, Clone)]
pub struct FirebaseAuthClient {
    api_key: String,
    http: reqwest::Client,
    sign_in_base_url: String,
    refresh_base_url: String,
}

#[derive(Debug, Deserialize)]
struct AuthResponse {
    #[serde(rename = "idToken")]
    id_token: String,
    #[serde(rename = "refreshToken")]
    refresh_token: String,
    #[serde(rename = "localId")]
    local_id: String,
    #[serde(rename = "email")]
    email: String,
    #[serde(rename = "expiresIn")]
    expires_in: String,
}

#[derive(Debug, Serialize)]
struct SignInRequest<'a> {
    email: &'a str,
    password: &'a str,
    #[serde(rename = "returnSecureToken")]
    return_secure_token: bool,
}

#[derive(Debug, Serialize)]
struct PasswordResetRequest<'a> {
    #[serde(rename = "requestType")]
    request_type: &'static str,
    email: &'a str,
}

#[derive(Debug, Serialize)]
struct GoogleIdpRequest<'a> {
    #[serde(rename = "postBody")]
    post_body: String,
    #[serde(rename = "requestUri")]
    request_uri: &'a str,
    #[serde(rename = "returnSecureToken")]
    return_secure_token: bool,
    #[serde(rename = "returnIdpCredential")]
    return_idp_credential: bool,
}

#[derive(Debug, Deserialize)]
struct RefreshResponse {
    #[serde(rename = "id_token")]
    id_token: String,
    #[serde(rename = "refresh_token")]
    refresh_token: String,
    #[serde(rename = "user_id")]
    user_id: String,
    #[serde(rename = "expires_in")]
    expires_in: String,
}

impl FirebaseAuthClient {
    pub fn new(api_key: impl Into<String>) -> Self {
        Self {
            api_key: api_key.into(),
            http: reqwest::Client::new(),
            sign_in_base_url: "https://identitytoolkit.googleapis.com/v1".to_string(),
            refresh_base_url: "https://securetoken.googleapis.com/v1".to_string(),
        }
    }

    #[cfg(test)]
    pub fn new_with_base_urls(
        api_key: impl Into<String>,
        sign_in_base_url: impl Into<String>,
        refresh_base_url: impl Into<String>,
    ) -> Self {
        Self {
            api_key: api_key.into(),
            http: reqwest::Client::new(),
            sign_in_base_url: sign_in_base_url.into(),
            refresh_base_url: refresh_base_url.into(),
        }
    }

    pub async fn sign_in_with_email_password(
        &self,
        email: &str,
        password: &str,
    ) -> Result<FirebaseSession, FirebaseError> {
        self.email_password_auth("accounts:signInWithPassword", email, password)
            .await
    }

    pub async fn sign_up_with_email_password(
        &self,
        email: &str,
        password: &str,
    ) -> Result<FirebaseSession, FirebaseError> {
        self.email_password_auth("accounts:signUp", email, password)
            .await
    }

    pub async fn send_password_reset_email(&self, email: &str) -> Result<(), FirebaseError> {
        if self.api_key.trim().is_empty() {
            return Err(FirebaseError::MissingApiKey);
        }

        let url = format!(
            "{}/accounts:sendOobCode?key={}",
            self.sign_in_base_url, self.api_key
        );

        let response = self
            .http
            .post(url)
            .json(&PasswordResetRequest {
                request_type: "PASSWORD_RESET",
                email,
            })
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(FirebaseError::Auth(
                response.text().await.unwrap_or_default(),
            ));
        }

        Ok(())
    }

    pub async fn sign_in_with_google_id_token(
        &self,
        google_id_token: &str,
        google_access_token: Option<&str>,
    ) -> Result<FirebaseSession, FirebaseError> {
        if self.api_key.trim().is_empty() {
            return Err(FirebaseError::MissingApiKey);
        }
        if google_id_token.trim().is_empty() {
            return Err(FirebaseError::MissingGoogleIdToken);
        }

        let url = format!(
            "{}/accounts:signInWithIdp?key={}",
            self.sign_in_base_url, self.api_key
        );
        let mut post_body = format!(
            "id_token={}&providerId=google.com",
            urlencoding::encode(google_id_token)
        );
        if let Some(access_token) = google_access_token
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            post_body.push_str("&access_token=");
            post_body.push_str(&urlencoding::encode(access_token));
        }

        let response = self
            .http
            .post(url)
            .json(&GoogleIdpRequest {
                post_body,
                request_uri: "http://localhost",
                return_secure_token: true,
                return_idp_credential: true,
            })
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(FirebaseError::Auth(
                response.text().await.unwrap_or_default(),
            ));
        }

        let payload: AuthResponse = response.json().await?;
        let expires_in = payload.expires_in.parse::<i64>().unwrap_or(3600);

        Ok(FirebaseSession {
            email: payload.email,
            uid: payload.local_id,
            id_token: payload.id_token,
            refresh_token: payload.refresh_token,
            expires_at: Utc::now() + Duration::seconds(expires_in),
        })
    }

    async fn email_password_auth(
        &self,
        endpoint: &str,
        email: &str,
        password: &str,
    ) -> Result<FirebaseSession, FirebaseError> {
        if self.api_key.trim().is_empty() {
            return Err(FirebaseError::MissingApiKey);
        }

        let url = format!(
            "{}/{}?key={}",
            self.sign_in_base_url, endpoint, self.api_key
        );

        let response = self
            .http
            .post(url)
            .json(&SignInRequest {
                email,
                password,
                return_secure_token: true,
            })
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(FirebaseError::Auth(
                response.text().await.unwrap_or_default(),
            ));
        }

        let payload: AuthResponse = response.json().await?;
        let expires_in = payload.expires_in.parse::<i64>().unwrap_or(3600);

        Ok(FirebaseSession {
            email: payload.email,
            uid: payload.local_id,
            id_token: payload.id_token,
            refresh_token: payload.refresh_token,
            expires_at: Utc::now() + Duration::seconds(expires_in),
        })
    }
    pub async fn refresh_session(
        &self,
        refresh_token: &str,
    ) -> Result<FirebaseSession, FirebaseError> {
        if self.api_key.trim().is_empty() {
            return Err(FirebaseError::MissingApiKey);
        }
        if refresh_token.trim().is_empty() {
            return Err(FirebaseError::MissingRefreshToken);
        }

        let url = format!("{}/token?key={}", self.refresh_base_url, self.api_key);

        let response = self
            .http
            .post(url)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(format!(
                "grant_type={}&refresh_token={}",
                urlencoding::encode("refresh_token"),
                urlencoding::encode(refresh_token)
            ))
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(FirebaseError::Auth(
                response.text().await.unwrap_or_default(),
            ));
        }

        let payload: RefreshResponse = response.json().await?;
        let expires_in = payload.expires_in.parse::<i64>().unwrap_or(3600);

        Ok(FirebaseSession {
            email: String::new(),
            uid: payload.user_id,
            id_token: payload.id_token,
            refresh_token: payload.refresh_token,
            expires_at: Utc::now() + Duration::seconds(expires_in),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use wiremock::matchers::{method, path_regex};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn make_client(server: &MockServer) -> FirebaseAuthClient {
        FirebaseAuthClient::new_with_base_urls("test-api-key", server.uri(), server.uri())
    }

    // ── expiry window ──────────────────────────────────────────────────────

    #[test]
    fn session_expiry_window_is_detected() {
        let session = FirebaseSession {
            email: "test@example.com".into(),
            uid: "uid".into(),
            id_token: "id".into(),
            refresh_token: "refresh".into(),
            expires_at: Utc::now() + Duration::minutes(4),
        };
        assert!(session.is_expiring_soon());
    }

    #[test]
    fn session_not_expiring_soon_when_plenty_of_time_left() {
        let session = FirebaseSession {
            email: "test@example.com".into(),
            uid: "uid".into(),
            id_token: "id".into(),
            refresh_token: "refresh".into(),
            expires_at: Utc::now() + Duration::minutes(60),
        };
        assert!(!session.is_expiring_soon());
    }

    #[test]
    fn session_already_expired_is_detected_as_expiring_soon() {
        let session = FirebaseSession {
            email: "test@example.com".into(),
            uid: "uid".into(),
            id_token: "id".into(),
            refresh_token: "refresh".into(),
            expires_at: Utc::now() - Duration::minutes(1),
        };
        assert!(session.is_expiring_soon());
    }

    #[test]
    fn session_expiry_exactly_at_boundary_is_expiring_soon() {
        // Exactly at 5-min boundary: should be considered expiring
        let session = FirebaseSession {
            email: "".into(),
            uid: "".into(),
            id_token: "".into(),
            refresh_token: "".into(),
            expires_at: Utc::now() + Duration::minutes(5),
        };
        // expires_at <= now + 5min => true (boundary condition)
        assert!(session.is_expiring_soon());
    }

    // ── empty api key guard ────────────────────────────────────────────────

    #[tokio::test]
    async fn sign_in_empty_api_key_returns_missing_key_error() {
        let client = FirebaseAuthClient::new("");
        let err = client
            .sign_in_with_email_password("a@b.com", "pass")
            .await
            .unwrap_err();
        assert!(matches!(err, FirebaseError::MissingApiKey));
    }

    #[tokio::test]
    async fn sign_in_whitespace_api_key_returns_missing_key_error() {
        let client = FirebaseAuthClient::new("   ");
        let err = client
            .sign_in_with_email_password("a@b.com", "pass")
            .await
            .unwrap_err();
        assert!(matches!(err, FirebaseError::MissingApiKey));
    }

    #[tokio::test]
    async fn refresh_empty_api_key_returns_missing_key_error() {
        let client = FirebaseAuthClient::new("");
        let err = client
            .refresh_session("some-refresh-token")
            .await
            .unwrap_err();
        assert!(matches!(err, FirebaseError::MissingApiKey));
    }

    #[tokio::test]
    async fn refresh_empty_refresh_token_returns_missing_token_error() {
        let client = FirebaseAuthClient::new("key");
        let err = client.refresh_session("").await.unwrap_err();
        assert!(matches!(err, FirebaseError::MissingRefreshToken));
    }

    #[tokio::test]
    async fn refresh_whitespace_refresh_token_returns_missing_token_error() {
        let client = FirebaseAuthClient::new("key");
        let err = client.refresh_session("   ").await.unwrap_err();
        assert!(matches!(err, FirebaseError::MissingRefreshToken));
    }

    #[tokio::test]
    async fn password_reset_empty_api_key_returns_missing_key_error() {
        let client = FirebaseAuthClient::new("");
        let err = client
            .send_password_reset_email("user@example.com")
            .await
            .unwrap_err();
        assert!(matches!(err, FirebaseError::MissingApiKey));
    }

    // ── successful sign-in via mock ────────────────────────────────────────

    #[tokio::test]
    async fn sign_in_success_parses_session_fields() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path_regex(r"/accounts:signInWithPassword"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "idToken": "id-tok-abc",
                "refreshToken": "ref-tok-xyz",
                "localId": "uid-001",
                "email": "user@example.com",
                "expiresIn": "3600"
            })))
            .mount(&server)
            .await;

        let client = make_client(&server);
        let session = client
            .sign_in_with_email_password("user@example.com", "secret")
            .await
            .unwrap();

        assert_eq!(session.id_token, "id-tok-abc");
        assert_eq!(session.refresh_token, "ref-tok-xyz");
        assert_eq!(session.uid, "uid-001");
        assert_eq!(session.email, "user@example.com");
        // expires_at should be ~1 hour from now
        let delta = session.expires_at - Utc::now();
        assert!(delta.num_seconds() > 3500 && delta.num_seconds() <= 3600);
    }

    #[tokio::test]
    async fn sign_up_success_parses_session_fields() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path_regex(r"/accounts:signUp"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "idToken": "signup-id-tok",
                "refreshToken": "signup-ref-tok",
                "localId": "uid-signup-001",
                "email": "newuser@example.com",
                "expiresIn": "3600"
            })))
            .mount(&server)
            .await;

        let client = make_client(&server);
        let session = client
            .sign_up_with_email_password("newuser@example.com", "secret")
            .await
            .unwrap();

        assert_eq!(session.id_token, "signup-id-tok");
        assert_eq!(session.refresh_token, "signup-ref-tok");
        assert_eq!(session.uid, "uid-signup-001");
        assert_eq!(session.email, "newuser@example.com");
    }

    #[tokio::test]
    async fn password_reset_success_calls_send_oob_code() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path_regex(r"/accounts:sendOobCode"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "email": "user@example.com"
            })))
            .mount(&server)
            .await;

        make_client(&server)
            .send_password_reset_email("user@example.com")
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn password_reset_http_error_returns_auth_error() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path_regex(r"/accounts:sendOobCode"))
            .respond_with(
                ResponseTemplate::new(400)
                    .set_body_string(r#"{"error":{"code":400,"message":"EMAIL_NOT_FOUND"}}"#),
            )
            .mount(&server)
            .await;

        let err = make_client(&server)
            .send_password_reset_email("missing@example.com")
            .await
            .unwrap_err();
        assert!(matches!(err, FirebaseError::Auth(_)));
        if let FirebaseError::Auth(body) = err {
            assert!(body.contains("EMAIL_NOT_FOUND"));
        }
    }

    #[tokio::test]
    async fn sign_in_custom_expires_in_is_respected() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path_regex(r"/accounts:signInWithPassword"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "idToken": "tok",
                "refreshToken": "ref",
                "localId": "uid",
                "email": "e@x.com",
                "expiresIn": "7200"
            })))
            .mount(&server)
            .await;

        let session = make_client(&server)
            .sign_in_with_email_password("e@x.com", "p")
            .await
            .unwrap();
        let delta = session.expires_at - Utc::now();
        assert!(delta.num_seconds() > 7100 && delta.num_seconds() <= 7200);
    }

    #[tokio::test]
    async fn sign_in_invalid_expires_in_falls_back_to_3600() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path_regex(r"/accounts:signInWithPassword"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "idToken": "tok",
                "refreshToken": "ref",
                "localId": "uid",
                "email": "e@x.com",
                "expiresIn": "not-a-number"
            })))
            .mount(&server)
            .await;

        let session = make_client(&server)
            .sign_in_with_email_password("e@x.com", "p")
            .await
            .unwrap();
        let delta = session.expires_at - Utc::now();
        assert!(delta.num_seconds() > 3500 && delta.num_seconds() <= 3600);
    }

    #[tokio::test]
    async fn sign_in_http_error_returns_auth_error() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path_regex(r"/accounts:signInWithPassword"))
            .respond_with(
                ResponseTemplate::new(400)
                    .set_body_string(r#"{"error":{"code":400,"message":"INVALID_PASSWORD"}}"#),
            )
            .mount(&server)
            .await;

        let err = make_client(&server)
            .sign_in_with_email_password("a@b.com", "wrong")
            .await
            .unwrap_err();
        assert!(matches!(err, FirebaseError::Auth(_)));
        if let FirebaseError::Auth(body) = err {
            assert!(body.contains("INVALID_PASSWORD"));
        }
    }

    #[tokio::test]
    async fn sign_in_malformed_json_returns_json_error() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path_regex(r"/accounts:signInWithPassword"))
            .respond_with(ResponseTemplate::new(200).set_body_string("not-json{{{{"))
            .mount(&server)
            .await;

        let err = make_client(&server)
            .sign_in_with_email_password("a@b.com", "p")
            .await
            .unwrap_err();
        assert!(matches!(
            err,
            FirebaseError::Request(_) | FirebaseError::Json(_)
        ));
    }

    // ── successful token refresh via mock ──────────────────────────────────

    #[tokio::test]
    async fn refresh_success_parses_new_tokens() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path_regex(r"/token"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "id_token": "new-id-tok",
                "refresh_token": "new-ref-tok",
                "user_id": "uid-999",
                "expires_in": "3600"
            })))
            .mount(&server)
            .await;

        let session = make_client(&server)
            .refresh_session("old-refresh-token")
            .await
            .unwrap();

        assert_eq!(session.id_token, "new-id-tok");
        assert_eq!(session.refresh_token, "new-ref-tok");
        assert_eq!(session.uid, "uid-999");
        assert!(
            session.email.is_empty(),
            "refresh response has no email field"
        );
    }

    #[tokio::test]
    async fn refresh_http_error_returns_auth_error() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path_regex(r"/token"))
            .respond_with(
                ResponseTemplate::new(400).set_body_string(r#"{"error":"TOKEN_EXPIRED"}"#),
            )
            .mount(&server)
            .await;

        let err = make_client(&server)
            .refresh_session("stale-token")
            .await
            .unwrap_err();
        assert!(matches!(err, FirebaseError::Auth(_)));
        if let FirebaseError::Auth(body) = err {
            assert!(body.contains("TOKEN_EXPIRED"));
        }
    }

    // ── security boundary tests ────────────────────────────────────────────

    #[tokio::test]
    async fn sign_in_with_xss_payload_in_email_serializes_safely() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path_regex(r"/accounts:signInWithPassword"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "idToken": "t", "refreshToken": "r", "localId": "u",
                "email": "<script>alert(1)</script>@evil.com", "expiresIn": "3600"
            })))
            .mount(&server)
            .await;

        // XSS email should be preserved literally, not executed or stripped
        let session = make_client(&server)
            .sign_in_with_email_password("<script>alert(1)</script>@evil.com", "pass")
            .await
            .unwrap();
        assert_eq!(session.email, "<script>alert(1)</script>@evil.com");
    }

    #[tokio::test]
    async fn sign_in_with_sql_injection_in_password_does_not_crash() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path_regex(r"/accounts:signInWithPassword"))
            .respond_with(ResponseTemplate::new(400).set_body_string("error"))
            .mount(&server)
            .await;

        // Should not panic, just return an Auth error
        let result = make_client(&server)
            .sign_in_with_email_password("a@b.com", "' OR '1'='1")
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn sign_in_with_null_byte_in_credentials_does_not_crash() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path_regex(r"/accounts:signInWithPassword"))
            .respond_with(ResponseTemplate::new(400).set_body_string("error"))
            .mount(&server)
            .await;

        let result = make_client(&server)
            .sign_in_with_email_password("a\x00b@x.com", "p\x00ass")
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn sign_in_with_very_long_password_does_not_crash() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path_regex(r"/accounts:signInWithPassword"))
            .respond_with(ResponseTemplate::new(400).set_body_string("error"))
            .mount(&server)
            .await;

        let long_pass = "A".repeat(100_000);
        let result = make_client(&server)
            .sign_in_with_email_password("a@b.com", &long_pass)
            .await;
        assert!(result.is_err());
    }

    // ── latency ───────────────────────────────────────────────────────────

    #[tokio::test]
    async fn sign_in_completes_within_latency_budget_on_mock_server() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path_regex(r"/accounts:signInWithPassword"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "idToken": "t", "refreshToken": "r", "localId": "u",
                "email": "e@x.com", "expiresIn": "3600"
            })))
            .mount(&server)
            .await;

        let client = make_client(&server);
        let start = std::time::Instant::now();
        client
            .sign_in_with_email_password("e@x.com", "p")
            .await
            .unwrap();
        assert!(
            start.elapsed().as_millis() < 500,
            "sign-in against mock server should complete in under 500 ms"
        );
    }
}
