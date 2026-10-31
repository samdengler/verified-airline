use std::sync::Mutex as StdMutex;
use std::sync::atomic::{AtomicU64, Ordering};

use super::*;

#[derive(Default)]
struct Fake {
    secrets: AtomicU64,
    tokens: AtomicU64,
    flows: AtomicU64,
    started: StdMutex<Vec<(String, String)>>,
}

#[async_trait]
impl Backend for Fake {
    async fn client_secret(&self, _pool: &str, _client: &str) -> Result<String, String> {
        self.secrets.fetch_add(1, Ordering::SeqCst);
        Ok("secret".into())
    }
    async fn token(&self, _url: &str, _client: &str, secret: &str, _scope: &str) -> Result<(String, f64), String> {
        assert_eq!(secret, "secret");
        let n = self.tokens.fetch_add(1, Ordering::SeqCst) + 1;
        Ok((format!("token-{n}"), 86400.0))
    }
    async fn contact_flow_id(&self, _instance: &str, name: &str) -> Result<String, String> {
        self.flows.fetch_add(1, Ordering::SeqCst);
        assert_eq!(name, "verified-airline-chat");
        Ok("flow-1".into())
    }
    async fn start_chat(&self, _instance: &str, flow: &str, mode: &str, token: &str) -> Result<Started, String> {
        assert_eq!(flow, "flow-1");
        self.started.lock().unwrap().push((mode.into(), token.into()));
        Ok(Started { contact_id: "contact-1".into(), participant_id: "p-1".into(), participant_token: "pt".into() })
    }
}

fn app(fake: Arc<Fake>, now: Arc<AtomicU64>) -> App {
    let config = Config {
        instance_id: "instance".into(),
        contact_flow_name: "verified-airline-chat".into(),
        user_pool_id: "pool".into(),
        client_id: "client".into(),
        token_url: "https://example.test/oauth2/token".into(),
        scope: "verified-airline/agents".into(),
    };
    App::new(config, fake, Arc::new(move || now.load(Ordering::SeqCst) as f64))
}

#[tokio::test]
async fn one_token_serves_every_chat_until_it_is_close_to_expiring() {
    let (fake, now) = (Arc::new(Fake::default()), Arc::new(AtomicU64::new(1_000)));
    let app = app(fake.clone(), now.clone());
    for _ in 0..3 {
        handle(&app, json!({"mode": "verified"})).await;
    }
    assert_eq!(fake.tokens.load(Ordering::SeqCst), 1);
    // 21 hours on, three hours are left: still fresh.
    now.store(1_000 + 21 * 3600, Ordering::SeqCst);
    handle(&app, json!({"mode": "kb"})).await;
    assert_eq!(fake.tokens.load(Ordering::SeqCst), 1);
    // 23 hours on, one hour is left: renewed before the chat starts.
    now.store(1_000 + 23 * 3600, Ordering::SeqCst);
    handle(&app, json!({"mode": "kb"})).await;
    assert_eq!(fake.tokens.load(Ordering::SeqCst), 2);
    assert_eq!(fake.secrets.load(Ordering::SeqCst), 1);
    assert_eq!(fake.flows.load(Ordering::SeqCst), 1);
    let started = fake.started.lock().unwrap();
    assert_eq!(started.last().unwrap(), &("kb".to_string(), "token-2".to_string()));
}

#[tokio::test]
async fn a_plain_event_gets_a_plain_answer() {
    let fake = Arc::new(Fake::default());
    let out = handle(&app(fake, Arc::new(AtomicU64::new(0))), json!({"mode": "kb"})).await;
    assert_eq!(out, json!({"contactId": "contact-1", "participantId": "p-1", "participantToken": "pt"}));
}

#[tokio::test]
async fn a_proxy_event_gets_a_proxy_response() {
    let fake = Arc::new(Fake::default());
    let body = base64::engine::general_purpose::STANDARD.encode(r#"{"mode":"verified"}"#);
    let out = handle(&app(fake, Arc::new(AtomicU64::new(0))), json!({"body": body, "isBase64Encoded": true})).await;
    assert_eq!(out["statusCode"], 200);
    assert_eq!(out["headers"]["cache-control"], "no-store");
    let answer: Value = serde_json::from_str(out["body"].as_str().unwrap()).unwrap();
    assert_eq!(answer["contactId"], "contact-1");
}

#[tokio::test]
async fn an_unknown_mode_starts_nothing() {
    let fake = Arc::new(Fake::default());
    let out = handle(&app(fake.clone(), Arc::new(AtomicU64::new(0))), json!({"body": r#"{"mode":"both"}"#})).await;
    assert_eq!(out["statusCode"], 400);
    assert!(fake.started.lock().unwrap().is_empty());
    assert_eq!(fake.tokens.load(Ordering::SeqCst), 0);
}
