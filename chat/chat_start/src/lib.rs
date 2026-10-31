//! air-chat-start: starts one anonymous Verified Airline support chat on Amazon Connect.
//!
//! The request names the mode, `kb` or `verified`. The function gets the agents token the
//! canvas sends to the agents gateway, a Cognito client-credentials token, and starts the
//! chat contact on the airline's contact flow with the mode and the token as contact
//! attributes; the contact flow hands them to the canvas as context variables. It answers
//! the contact ID and the participant token the widget connects with.
//!
//! The token names the chat start, not the traveler, so one token serves every chat until
//! it is close to expiring: it is renewed when less than `RENEW_BEFORE_SECS` is left,
//! which is longer than a chat can last.
//!
//! The function takes a plain event (`{"mode": "verified"}`, from `aws lambda invoke` and
//! chat/scripts/chat.py) or an HTTP proxy event, whose `body` holds the same JSON and whose
//! answer is a proxy response.

use std::sync::Arc;

use async_trait::async_trait;
use base64::Engine;
use serde_json::{Value, json};
use tokio::sync::Mutex;

/// Connect's minimum chat duration; a chat that is never closed ends after it.
pub const CHAT_MINUTES: i32 = 60;
/// Two hours: a token renewed with less than this left still outlives any chat it starts.
pub const RENEW_BEFORE_SECS: f64 = 7200.0;
pub const MODES: [&str; 2] = ["kb", "verified"];

pub struct Config {
    pub instance_id: String,
    pub contact_flow_name: String,
    pub user_pool_id: String,
    pub client_id: String,
    pub token_url: String,
    pub scope: String,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let var = |name: &str| std::env::var(name).map_err(|_| format!("{name} is not set"));
        Ok(Config {
            instance_id: var("CONNECT_INSTANCE_ID")?,
            contact_flow_name: var("CONTACT_FLOW_NAME")?,
            user_pool_id: var("USER_POOL_ID")?,
            client_id: var("CLIENT_ID")?,
            token_url: var("TOKEN_URL")?,
            scope: var("SCOPE")?,
        })
    }
}

pub struct Token {
    pub value: String,
    pub expires_at: f64,
}

impl Token {
    pub fn fresh(&self, now: f64) -> bool {
        self.expires_at - now > RENEW_BEFORE_SECS
    }
}

pub struct Started {
    pub contact_id: String,
    pub participant_id: String,
    pub participant_token: String,
}

/// The calls the function makes, so the handler can be tested without AWS.
#[async_trait]
pub trait Backend: Send + Sync {
    async fn client_secret(&self, pool: &str, client: &str) -> Result<String, String>;
    /// The token and its lifetime in seconds.
    async fn token(&self, url: &str, client: &str, secret: &str, scope: &str) -> Result<(String, f64), String>;
    async fn contact_flow_id(&self, instance: &str, name: &str) -> Result<String, String>;
    async fn start_chat(&self, instance: &str, flow: &str, mode: &str, token: &str) -> Result<Started, String>;
}

pub struct App {
    pub config: Config,
    pub backend: Arc<dyn Backend>,
    pub clock: Arc<dyn Fn() -> f64 + Send + Sync>,
    secret: Mutex<Option<String>>,
    token: Mutex<Option<Token>>,
    flow: Mutex<Option<String>>,
}

impl App {
    pub fn new(config: Config, backend: Arc<dyn Backend>, clock: Arc<dyn Fn() -> f64 + Send + Sync>) -> Self {
        App { config, backend, clock, secret: Mutex::new(None), token: Mutex::new(None), flow: Mutex::new(None) }
    }

    async fn agents_token(&self) -> Result<String, String> {
        let mut token = self.token.lock().await;
        let now = (self.clock)();
        if let Some(t) = token.as_ref().filter(|t| t.fresh(now)) {
            return Ok(t.value.clone());
        }
        let mut secret = self.secret.lock().await;
        if secret.is_none() {
            *secret = Some(self.backend.client_secret(&self.config.user_pool_id, &self.config.client_id).await?);
        }
        let c = &self.config;
        let (value, lifetime) = self.backend.token(&c.token_url, &c.client_id, secret.as_deref().unwrap(), &c.scope).await?;
        *token = Some(Token { value: value.clone(), expires_at: now + lifetime });
        Ok(value)
    }

    async fn contact_flow(&self) -> Result<String, String> {
        let mut flow = self.flow.lock().await;
        if flow.is_none() {
            *flow = Some(self.backend.contact_flow_id(&self.config.instance_id, &self.config.contact_flow_name).await?);
        }
        Ok(flow.clone().unwrap())
    }
}

/// The request's JSON body and whether it came as an HTTP proxy event.
pub fn request(event: &Value) -> (Value, bool) {
    let Some(body) = event.get("body") else {
        return (event.clone(), false);
    };
    let text = match body.as_str() {
        Some(s) if event.get("isBase64Encoded").and_then(Value::as_bool) == Some(true) => {
            base64::engine::general_purpose::STANDARD
                .decode(s)
                .ok()
                .and_then(|b| String::from_utf8(b).ok())
                .unwrap_or_default()
        }
        Some(s) => s.to_string(),
        None => String::new(),
    };
    (serde_json::from_str(&text).unwrap_or(Value::Null), true)
}

pub fn respond(http: bool, status: u16, body: Value) -> Value {
    if !http {
        return body;
    }
    json!({
        "statusCode": status,
        "headers": {"content-type": "application/json", "cache-control": "no-store"},
        "body": body.to_string(),
    })
}

/// One log line as JSON. Tokens never reach it.
pub fn log(fields: Value) {
    println!("{fields}");
}

pub async fn handle(app: &App, event: Value) -> Value {
    let (body, http) = request(&event);
    let mode = body.get("mode").and_then(Value::as_str).unwrap_or("");
    if !MODES.contains(&mode) {
        return respond(http, 400, json!({"error": "mode must be kb or verified"}));
    }
    let started = async {
        let token = app.agents_token().await.map_err(|e| ("token", e))?;
        let flow = app.contact_flow().await.map_err(|e| ("contact_flow", e))?;
        app.backend.start_chat(&app.config.instance_id, &flow, mode, &token).await.map_err(|e| ("start_chat", e))
    }
    .await;
    match started {
        Ok(s) => {
            log(json!({"event": "chat_start", "mode": mode, "contact": s.contact_id}));
            respond(
                http,
                200,
                json!({"contactId": s.contact_id, "participantId": s.participant_id, "participantToken": s.participant_token}),
            )
        }
        Err((step, detail)) => {
            log(json!({"event": "chat_problem", "step": step, "detail": detail}));
            respond(http, 502, json!({"error": "the chat could not be started"}))
        }
    }
}

#[cfg(test)]
mod tests;
