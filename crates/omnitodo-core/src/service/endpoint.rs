//! Loopback endpoint tokens (design §4.4/§4.5, amended 2026-10-15).
//!
//! Two tokens guard the two localhost services: the embedded MCP HTTP server
//! (§11.2) and the desktop control endpoint external MCP instances call back
//! into after a write (§4.5).
//!
//! Both live in the `settings` table rather than `config.json`. The reason
//! `config.json` was nominated in §4.4 was "values that must be readable before
//! the database opens" — but nothing reads these before `Core::open_default()`;
//! the control endpoint starts after it. The `settings` table is already the
//! single source of truth for application configuration, so keeping them there
//! avoids a second store that can drift.

use serde_json::Value;

use crate::error::{CoreError, Result};
use crate::service::Core;

/// Token for the desktop control endpoint (design §4.5).
pub const CONTROL_TOKEN_KEY: &str = "mcp.control_token";
/// Token for the embedded MCP HTTP server (design §11.2).
pub const HTTP_TOKEN_KEY: &str = "mcp.http_token";

const MIN_TOKEN_LEN: usize = 16;
const MAX_TOKEN_LEN: usize = 128;

/// A fresh random token: two UUID v7s with their separators stripped (64 chars).
///
/// UUID v7 is time-ordered, so this is not a CSPRNG. That is deliberate and
/// sufficient: the token only separates this loopback service from other local
/// processes, which is what §4.5/§11.2 ask of it. Keep the shape compatible with
/// [`validate_token`].
pub fn generate_token() -> String {
    let mut s = Core::new_id();
    s.push_str(&Core::new_id());
    s.replace('-', "")
}

/// Reject tokens that cannot travel in an `Authorization: Bearer <t>` header,
/// plus the two shape mistakes users actually make: quoting the token while
/// pasting it into a client config, and pasting an empty field.
pub fn validate_token(token: &str) -> Result<()> {
    let len = token.chars().count();
    if !(MIN_TOKEN_LEN..=MAX_TOKEN_LEN).contains(&len) {
        return Err(CoreError::Validation(format!(
            "token must be {MIN_TOKEN_LEN}–{MAX_TOKEN_LEN} characters, got {len}"
        )));
    }
    if let Some(bad) = token
        .chars()
        .find(|c| !(c.is_ascii_alphanumeric() || *c == '-' || *c == '_'))
    {
        return Err(CoreError::Validation(format!(
            "token may only contain A–Z a–z 0–9 - _ (found {bad:?}); quotes and \
             spaces become part of the header value"
        )));
    }
    Ok(())
}

impl Core {
    /// Read a token, generating and persisting one on first use.
    ///
    /// A stored value that fails [`validate_token`] is treated as absent and
    /// replaced: refusing to start the endpoint would be a worse outcome than
    /// rotating a token that could never have authenticated a request anyway.
    pub async fn endpoint_token(&self, key: &str) -> Result<String> {
        if let Some(Value::String(existing)) = self.setting_get(key).await? {
            if validate_token(&existing).is_ok() {
                return Ok(existing);
            }
        }
        let token = generate_token();
        self.set_endpoint_token(key, &token).await?;
        Ok(token)
    }

    /// Validate and persist a user-supplied token.
    pub async fn set_endpoint_token(&self, key: &str, token: &str) -> Result<()> {
        validate_token(token)?;
        self.setting_set(key, &Value::String(token.to_string()))
            .await
    }

    /// Persist a freshly generated token and return it.
    pub async fn regenerate_endpoint_token(&self, key: &str) -> Result<String> {
        let token = generate_token();
        self.set_endpoint_token(key, &token).await?;
        Ok(token)
    }
}
