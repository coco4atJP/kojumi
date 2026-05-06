use jsonwebtoken::{encode, EncodingKey, Header};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct CanonicalFeatures {
    // Reliability
    #[serde(skip_serializing_if = "Option::is_none")]
    pub f_completed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub f_on_time: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub f_canceled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub f_retry_count: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub f_missing_required_evidence_count: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub f_log_gap_flag: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub f_security_incident_count: Option<i32>,

    // Quality
    #[serde(skip_serializing_if = "Option::is_none")]
    pub f_accepted: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub f_first_pass_accept: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub f_rework_count: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub f_benchmark_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub f_refund_flag: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub f_chargeback_flag: Option<bool>,

    // Efficiency
    #[serde(skip_serializing_if = "Option::is_none")]
    pub f_duration_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub f_success_cost: Option<f64>,

    // Autonomy
    #[serde(skip_serializing_if = "Option::is_none")]
    pub f_human_interventions: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub f_approval_requests: Option<i32>,
}

#[derive(Debug, Serialize)]
struct Claims {
    contract_id: String,
    delivery_id: String,
    features: CanonicalFeatures,
}

#[derive(Debug, Deserialize)]
pub struct EvaluationResponse {
    pub id: String,
}

#[derive(Debug, Serialize)]
struct SubmitPayload {
    jws: String,
}

pub struct KojumiEvalClient {
    api_url: String,
    signing_secret: String,
    api_key: Option<String>,
    http_client: reqwest::Client,
}

impl KojumiEvalClient {
    pub fn new(api_url: &str, signing_secret: &str) -> Self {
        Self {
            api_url: api_url.trim_end_matches('/').to_string(),
            signing_secret: signing_secret.to_string(),
            api_key: None,
            http_client: reqwest::Client::new(),
        }
    }

    pub fn with_api_key(mut self, api_key: &str) -> Self {
        self.api_key = Some(api_key.to_string());
        self
    }

    fn create_jws(
        &self,
        contract_id: &str,
        delivery_id: &str,
        features: CanonicalFeatures,
    ) -> Result<String, jsonwebtoken::errors::Error> {
        let claims = Claims {
            contract_id: contract_id.to_string(),
            delivery_id: delivery_id.to_string(),
            features,
        };

        encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(self.signing_secret.as_bytes()),
        )
    }

    pub async fn submit_evaluation(
        &self,
        contract_id: &str,
        delivery_id: &str,
        features: CanonicalFeatures,
    ) -> Result<EvaluationResponse, Box<dyn std::error::Error>> {
        let jws = self.create_jws(contract_id, delivery_id, features)?;
        let url = format!("{}/v1/evaluations", self.api_url);

        let mut req = self.http_client.post(&url).json(&SubmitPayload { jws });
        
        if let Some(key) = &self.api_key {
            req = req.header("x-api-key", key);
        }

        let res = req.send().await?;

        if !res.status().is_success() {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            return Err(format!("HTTP error! status: {} - {}", status, text).into());
        }

        let resp_data = res.json::<EvaluationResponse>().await?;
        Ok(resp_data)
    }
}
