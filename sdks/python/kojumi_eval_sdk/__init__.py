import jwt
import requests
from pydantic import BaseModel, Field
from typing import Optional

class CanonicalFeatures(BaseModel):
    # Reliability
    f_completed: Optional[bool] = None
    f_on_time: Optional[bool] = None
    f_canceled: Optional[bool] = None
    f_retry_count: Optional[int] = None
    f_timeout_count: Optional[int] = None
    f_missing_required_evidence_count: Optional[int] = None
    f_required_evidence_count: Optional[int] = None
    f_log_gap_flag: Optional[bool] = None
    f_security_incident_count: Optional[int] = None

    # Quality
    f_accepted: Optional[bool] = None
    f_first_pass_accept: Optional[bool] = None
    f_rework_count: Optional[int] = None
    f_confirmed_defect_count: Optional[int] = None
    f_benchmark_score: Optional[float] = None
    f_refund_flag: Optional[bool] = None
    f_chargeback_flag: Optional[bool] = None

    # Efficiency
    f_duration_ms: Optional[int] = None
    f_success_cost: Optional[float] = None
    f_token_count: Optional[int] = None
    f_tool_calls: Optional[int] = None

    # Autonomy
    f_human_interventions: Optional[int] = None
    f_approval_requests: Optional[int] = None
    f_manual_takeovers: Optional[int] = None
    f_subagent_delegations: Optional[int] = None

    # Transparency / safety
    f_attested_claim_count: Optional[int] = None
    f_policy_incident_count: Optional[int] = None
    f_unauthorized_tool_count: Optional[int] = None
    f_identity_mismatch_count: Optional[int] = None
    f_runtime_attestation_gap_count: Optional[int] = None


class KojumiEvalClient:
    def __init__(self, api_url: str, signing_secret: str, api_key: Optional[str] = None):
        self.api_url = api_url.rstrip('/')
        self.signing_secret = signing_secret
        self.api_key = api_key

    def _create_jws(self, contract_id: str, delivery_id: str, features: CanonicalFeatures) -> str:
        payload = {
            "contract_id": contract_id,
            "delivery_id": delivery_id,
            "features": features.model_dump(exclude_none=True)
        }
        # Using HS256 for now, as expected by the beta1 API
        encoded_jwt = jwt.encode(payload, self.signing_secret, algorithm="HS256")
        return encoded_jwt

    def submit_evaluation(self, contract_id: str, delivery_id: str, features: CanonicalFeatures) -> dict:
        jws = self._create_jws(contract_id, delivery_id, features)
        
        headers = {
            "User-Agent": "KojumiEvalSDK/1.0 (+https://kojumi.com)",
            "Accept": "application/json",
        }
        if self.api_key:
            headers["x-api-key"] = self.api_key

        response = requests.post(
            f"{self.api_url}/v1/evaluations",
            json={"jws": jws},
            headers=headers
        )
        response.raise_for_status()
        return response.json()
