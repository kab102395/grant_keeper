use base64::Engine;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};
use url::Url;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum GoogleAuthError {
    #[error("missing google oauth client id")]
    MissingClientId,
    #[error("failed to open system browser")]
    BrowserOpenFailed,
    #[error("google oauth callback listener failed: {0}")]
    ListenerIo(#[from] std::io::Error),
    #[error("google oauth request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("google oauth response parse failed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("google oauth flow timed out")]
    Timeout,
    #[error("google oauth callback was invalid")]
    InvalidCallback,
    #[error("google oauth state mismatch")]
    InvalidState,
    #[error("google oauth returned an error: {0}")]
    Auth(String),
    #[error("google oauth worker failed")]
    WorkerJoin,
}

#[derive(Debug, Clone)]
pub struct GoogleDesktopAuthClient {
    client_id: String,
    client_secret: Option<String>,
    http: reqwest::Client,
    auth_base_url: String,
    token_url: String,
}

#[derive(Debug, Clone)]
pub struct GoogleDesktopAuthTokens {
    pub id_token: String,
    pub access_token: String,
}

#[derive(Debug, Deserialize)]
struct GoogleTokenResponse {
    access_token: String,
    id_token: String,
}

#[derive(Debug)]
struct CallbackPayload {
    code: String,
}

impl GoogleDesktopAuthClient {
    pub fn new(client_id: impl Into<String>, client_secret: Option<String>) -> Self {
        Self {
            client_id: client_id.into(),
            client_secret,
            http: reqwest::Client::new(),
            auth_base_url: "https://accounts.google.com/o/oauth2/v2/auth".to_string(),
            token_url: "https://oauth2.googleapis.com/token".to_string(),
        }
    }

    #[cfg(test)]
    pub fn new_with_base_urls(
        client_id: impl Into<String>,
        client_secret: Option<String>,
        auth_base_url: impl Into<String>,
        token_url: impl Into<String>,
    ) -> Self {
        Self {
            client_id: client_id.into(),
            client_secret,
            http: reqwest::Client::new(),
            auth_base_url: auth_base_url.into(),
            token_url: token_url.into(),
        }
    }

    pub async fn authenticate(&self) -> Result<GoogleDesktopAuthTokens, GoogleAuthError> {
        if self.client_id.trim().is_empty() {
            return Err(GoogleAuthError::MissingClientId);
        }

        let code_verifier = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
        let state = Uuid::new_v4().simple().to_string();
        let code_challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(Sha256::digest(code_verifier.as_bytes()));

        let listener = TcpListener::bind(("127.0.0.1", 0))?;
        listener.set_nonblocking(true)?;
        let redirect_uri = format!(
            "http://127.0.0.1:{}/oauth/google/callback",
            listener.local_addr()?.port()
        );
        let auth_url = self.build_auth_url(&redirect_uri, &state, &code_challenge)?;

        if webbrowser::open(auth_url.as_str()).is_err() {
            return Err(GoogleAuthError::BrowserOpenFailed);
        }

        let expected_state = state.clone();
        let callback = tokio::task::spawn_blocking(move || {
            wait_for_callback(listener, expected_state.as_str())
        })
        .await
        .map_err(|_| GoogleAuthError::WorkerJoin)??;

        self.exchange_code(&callback.code, &code_verifier, &redirect_uri)
            .await
    }

    fn build_auth_url(
        &self,
        redirect_uri: &str,
        state: &str,
        code_challenge: &str,
    ) -> Result<Url, GoogleAuthError> {
        let mut url =
            Url::parse(&self.auth_base_url).map_err(|_| GoogleAuthError::InvalidCallback)?;
        url.query_pairs_mut()
            .append_pair("client_id", &self.client_id)
            .append_pair("redirect_uri", redirect_uri)
            .append_pair("response_type", "code")
            .append_pair("scope", "openid email profile")
            .append_pair("access_type", "offline")
            .append_pair("prompt", "select_account")
            .append_pair("state", state)
            .append_pair("code_challenge", code_challenge)
            .append_pair("code_challenge_method", "S256");
        Ok(url)
    }

    async fn exchange_code(
        &self,
        code: &str,
        code_verifier: &str,
        redirect_uri: &str,
    ) -> Result<GoogleDesktopAuthTokens, GoogleAuthError> {
        let mut form = vec![
            ("client_id", self.client_id.clone()),
            ("code", code.to_string()),
            ("code_verifier", code_verifier.to_string()),
            ("grant_type", "authorization_code".to_string()),
            ("redirect_uri", redirect_uri.to_string()),
        ];
        if let Some(client_secret) = self
            .client_secret
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            form.push(("client_secret", client_secret.to_string()));
        }

        let response = self.http.post(&self.token_url).form(&form).send().await?;

        if !response.status().is_success() {
            return Err(GoogleAuthError::Auth(
                response.text().await.unwrap_or_default(),
            ));
        }

        let payload: GoogleTokenResponse = response.json().await?;
        Ok(GoogleDesktopAuthTokens {
            id_token: payload.id_token,
            access_token: payload.access_token,
        })
    }
}

fn wait_for_callback(
    listener: TcpListener,
    expected_state: &str,
) -> Result<CallbackPayload, GoogleAuthError> {
    let deadline = Instant::now() + Duration::from_secs(180);

    loop {
        match listener.accept() {
            Ok((mut stream, _addr)) => {
                let mut buffer = [0u8; 8192];
                let size = stream.read(&mut buffer)?;
                let request = String::from_utf8_lossy(&buffer[..size]);
                let path = parse_http_request_path(&request)?;
                let url = Url::parse(&format!("http://localhost{path}"))
                    .map_err(|_| GoogleAuthError::InvalidCallback)?;

                let query = url
                    .query_pairs()
                    .collect::<std::collections::HashMap<_, _>>();
                let response = if let Some(error) = query.get("error") {
                    write_html_response(
                        &mut stream,
                        400,
                        "Google sign-in failed",
                        "Grant Keeper did not receive a valid Google sign-in response. You can close this tab and try again.",
                    )?;
                    return Err(GoogleAuthError::Auth(error.to_string()));
                } else if query.get("state").map(|value| value.as_ref()) != Some(expected_state) {
                    write_html_response(
                        &mut stream,
                        400,
                        "Google sign-in failed",
                        "Grant Keeper rejected the Google sign-in response. Close this tab and try again.",
                    )?;
                    return Err(GoogleAuthError::InvalidState);
                } else if let Some(code) = query.get("code") {
                    write_html_response(
                        &mut stream,
                        200,
                        "Sign-in complete",
                        "Grant Keeper received your Google sign-in. You can close this tab and return to the app.",
                    )?;
                    CallbackPayload {
                        code: code.to_string(),
                    }
                } else {
                    write_html_response(
                        &mut stream,
                        400,
                        "Google sign-in failed",
                        "Grant Keeper could not read the Google sign-in response. Close this tab and try again.",
                    )?;
                    return Err(GoogleAuthError::InvalidCallback);
                };
                return Ok(response);
            }
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err(GoogleAuthError::Timeout);
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(err) => return Err(GoogleAuthError::ListenerIo(err)),
        }
    }
}

fn parse_http_request_path(request: &str) -> Result<&str, GoogleAuthError> {
    let first_line = request
        .lines()
        .next()
        .ok_or(GoogleAuthError::InvalidCallback)?;
    let mut parts = first_line.split_whitespace();
    let method = parts.next().ok_or(GoogleAuthError::InvalidCallback)?;
    let path = parts.next().ok_or(GoogleAuthError::InvalidCallback)?;
    if method != "GET" {
        return Err(GoogleAuthError::InvalidCallback);
    }
    Ok(path)
}

fn write_html_response(
    stream: &mut std::net::TcpStream,
    status_code: u16,
    title: &str,
    message: &str,
) -> Result<(), std::io::Error> {
    let body = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>{title}</title></head><body style=\"font-family:Segoe UI, sans-serif;padding:32px;background:#0f172a;color:#e2e8f0;\"><h1 style=\"font-size:24px;\">{title}</h1><p style=\"font-size:16px;line-height:1.5;max-width:640px;\">{message}</p></body></html>"
    );
    let response = format!(
        "HTTP/1.1 {status_code} OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    stream.write_all(response.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_url_contains_pkce_and_redirect() {
        let client = GoogleDesktopAuthClient::new_with_base_urls(
            "client-id",
            None,
            "https://accounts.google.com/o/oauth2/v2/auth",
            "https://oauth2.googleapis.com/token",
        );
        let url = client
            .build_auth_url(
                "http://127.0.0.1:9999/oauth/google/callback",
                "state-123",
                "challenge-123",
            )
            .unwrap();

        let query = url
            .query_pairs()
            .collect::<std::collections::HashMap<_, _>>();
        assert_eq!(
            query.get("client_id").map(|value| value.as_ref()),
            Some("client-id")
        );
        assert_eq!(
            query.get("state").map(|value| value.as_ref()),
            Some("state-123")
        );
        assert_eq!(
            query
                .get("code_challenge_method")
                .map(|value| value.as_ref()),
            Some("S256")
        );
        assert_eq!(
            query.get("redirect_uri").map(|value| value.as_ref()),
            Some("http://127.0.0.1:9999/oauth/google/callback")
        );
    }

    #[test]
    fn parse_http_request_path_reads_callback_line() {
        let path = parse_http_request_path(
            "GET /oauth/google/callback?code=abc&state=123 HTTP/1.1\r\nHost: localhost\r\n\r\n",
        )
        .unwrap();
        assert_eq!(path, "/oauth/google/callback?code=abc&state=123");
    }
}
