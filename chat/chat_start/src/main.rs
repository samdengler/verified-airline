//! air-chat-start in Lambda: the AWS clients and the token request (lib.rs decides).

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use air_chat_start::{App, Backend, CHAT_MINUTES, Config, Started, handle};
use async_trait::async_trait;
use aws_sdk_connect::error::ProvideErrorMetadata;
use aws_sdk_connect::types::{ContactFlowType, ParticipantDetails};
use lambda_runtime::{Error, LambdaEvent, service_fn};
use serde_json::Value;

/// The error's code, never its message.
fn code<E: ProvideErrorMetadata>(error: &aws_sdk_connect::error::SdkError<E>) -> String {
    match error {
        aws_sdk_connect::error::SdkError::ServiceError(inner) => inner.err().code().unwrap_or("ServiceError").to_string(),
        aws_sdk_connect::error::SdkError::TimeoutError(_) => "TimeoutError".into(),
        aws_sdk_connect::error::SdkError::DispatchFailure(_) => "DispatchFailure".into(),
        aws_sdk_connect::error::SdkError::ResponseError(_) => "ResponseError".into(),
        _ => "SdkError".into(),
    }
}

struct Aws {
    cognito: aws_sdk_cognitoidentityprovider::Client,
    connect: aws_sdk_connect::Client,
    http: reqwest::Client,
}

#[async_trait]
impl Backend for Aws {
    async fn client_secret(&self, pool: &str, client: &str) -> Result<String, String> {
        let out = self
            .cognito
            .describe_user_pool_client()
            .user_pool_id(pool)
            .client_id(client)
            .send()
            .await
            .map_err(|e| e.into_service_error().meta().code().unwrap_or("DescribeUserPoolClient").to_string())?;
        out.user_pool_client.and_then(|c| c.client_secret).ok_or_else(|| "the client has no secret".to_string())
    }

    async fn token(&self, url: &str, client: &str, secret: &str, scope: &str) -> Result<(String, f64), String> {
        let response = self
            .http
            .post(url)
            .basic_auth(client, Some(secret))
            .form(&[("grant_type", "client_credentials"), ("scope", scope)])
            .send()
            .await
            .map_err(|_| "the token endpoint did not answer".to_string())?;
        let status = response.status();
        let body: Value = response.json().await.map_err(|_| format!("token endpoint answered {status} without JSON"))?;
        let token = body["access_token"].as_str().ok_or_else(|| format!("token endpoint answered {status}"))?;
        Ok((token.to_string(), body["expires_in"].as_f64().unwrap_or(3600.0)))
    }

    async fn contact_flow_id(&self, instance: &str, name: &str) -> Result<String, String> {
        let mut pages = self
            .connect
            .list_contact_flows()
            .instance_id(instance)
            .contact_flow_types(ContactFlowType::ContactFlow)
            .into_paginator()
            .send();
        while let Some(page) = pages.next().await {
            let page = page.map_err(|e| code(&e))?;
            if let Some(flow) = page.contact_flow_summary_list().iter().find(|f| f.name() == Some(name)) {
                return flow.id().map(str::to_string).ok_or_else(|| "the flow has no id".to_string());
            }
        }
        Err(format!("no contact flow named {name}; run chat/scripts/contact_flow.py"))
    }

    async fn start_chat(&self, instance: &str, flow: &str, mode: &str, token: &str) -> Result<Started, String> {
        let attributes = HashMap::from([("mode".to_string(), mode.to_string()), ("agentsToken".to_string(), token.to_string())]);
        let out = self
            .connect
            .start_chat_contact()
            .instance_id(instance)
            .contact_flow_id(flow)
            .participant_details(ParticipantDetails::builder().display_name("Traveler").build().map_err(|e| e.to_string())?)
            .set_attributes(Some(attributes))
            .supported_messaging_content_types("text/plain")
            .chat_duration_in_minutes(CHAT_MINUTES)
            .send()
            .await
            .map_err(|e| code(&e))?;
        Ok(Started {
            contact_id: out.contact_id.unwrap_or_default(),
            participant_id: out.participant_id.unwrap_or_default(),
            participant_token: out.participant_token.unwrap_or_default(),
        })
    }
}

fn now() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    let config = Config::from_env()?;
    let aws = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .timeout_config(
            aws_config::timeout::TimeoutConfig::builder().operation_timeout(Duration::from_secs(10)).build(),
        )
        .load()
        .await;
    let backend = Aws {
        cognito: aws_sdk_cognitoidentityprovider::Client::new(&aws),
        connect: aws_sdk_connect::Client::new(&aws),
        http: reqwest::Client::builder().timeout(Duration::from_secs(5)).build()?,
    };
    let app = Arc::new(App::new(config, Arc::new(backend), Arc::new(now)));
    lambda_runtime::run(service_fn(move |event: LambdaEvent<Value>| {
        let app = app.clone();
        async move { Ok::<_, Error>(handle(&app, event.payload).await) }
    }))
    .await
}
