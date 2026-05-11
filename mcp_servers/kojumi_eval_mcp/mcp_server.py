import os
import sys

# Ensure sdks/python is in the path so we can import kojumi_eval_sdk
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../sdks/python')))

from mcp.server.fastmcp import FastMCP
from kojumi_eval_sdk import KojumiEvalClient, CanonicalFeatures

# Initialize the FastMCP server
mcp = FastMCP("Kojumi Evaluator")

# Ensure required environment variables exist
API_URL = os.environ.get("KOJUMI_API_URL", "http://localhost:3000")
SIGNING_SECRET = os.environ.get("KOJUMI_EVAL_SECRET")

if not SIGNING_SECRET:
    raise RuntimeError("KOJUMI_EVAL_SECRET environment variable is required.")

API_KEY = os.environ.get("KOJUMI_API_KEY", "")

client = KojumiEvalClient(api_url=API_URL, signing_secret=SIGNING_SECRET, api_key=API_KEY)

@mcp.tool()
def submit_evaluation(
    contract_id: str, 
    delivery_id: str, 
    f_completed: bool = None,
    f_on_time: bool = None,
    f_canceled: bool = None,
    f_retry_count: int = None,
    f_timeout_count: int = None,
    f_missing_required_evidence_count: int = None,
    f_required_evidence_count: int = None,
    f_log_gap_flag: bool = None,
    f_security_incident_count: int = None,
    f_accepted: bool = None,
    f_first_pass_accept: bool = None,
    f_rework_count: int = None,
    f_confirmed_defect_count: int = None,
    f_benchmark_score: float = None,
    f_refund_flag: bool = None,
    f_chargeback_flag: bool = None,
    f_duration_ms: int = None,
    f_success_cost: float = None,
    f_token_count: int = None,
    f_tool_calls: int = None,
    f_human_interventions: int = None,
    f_approval_requests: int = None,
    f_manual_takeovers: int = None,
    f_subagent_delegations: int = None,
    f_attested_claim_count: int = None,
    f_policy_incident_count: int = None,
    f_unauthorized_tool_count: int = None,
    f_identity_mismatch_count: int = None,
    f_runtime_attestation_gap_count: int = None
) -> str:
    """
    Submits an evaluation of an agent's task delivery to the Kojumi network.
    Uses cryptographic attestation (JWS) to prove the evaluation came from this runner.
    
    Args:
        contract_id: The ID of the contract the delivery belongs to.
        delivery_id: The ID of the delivery being evaluated.
        f_completed: Whether the task was successfully completed (true/false).
        f_on_time: Whether the delivery met its expected deadline.
        f_canceled: Whether the task was canceled.
        f_retry_count: Number of retries required.
        f_timeout_count: Number of timeouts observed.
        f_missing_required_evidence_count: Number of required evidence items missing from the delivery.
        f_required_evidence_count: Total number of required evidence items.
        f_log_gap_flag: Whether the execution logs have material gaps.
        f_security_incident_count: Number of severe security incidents.
        f_accepted: Whether the output met the requester's quality standards.
        f_first_pass_accept: Whether the output was accepted without rework.
        f_rework_count: Number of rework cycles.
        f_confirmed_defect_count: Number of confirmed defects.
        f_benchmark_score: If this is a benchmark task, the objective score (0.0 to 1.0).
        f_refund_flag: Whether a refund was issued.
        f_chargeback_flag: Whether a chargeback occurred.
        f_duration_ms: How long the task took in milliseconds.
        f_success_cost: Cost of the successful task execution.
        f_token_count: Number of tokens consumed by the successful task execution.
        f_tool_calls: Number of tool calls made by the agent.
        f_human_interventions: Number of times a human had to step in.
        f_approval_requests: Number of approval requests made by the agent.
        f_manual_takeovers: Number of manual takeovers required.
        f_subagent_delegations: Number of delegated subagent calls.
        f_attested_claim_count: Number of claims backed by submitted evidence.
        f_policy_incident_count: Number of policy or safety incidents observed.
        f_unauthorized_tool_count: Number of unauthorized tool-use events.
        f_identity_mismatch_count: Number of identity mismatch events.
        f_runtime_attestation_gap_count: Number of runtime attestation gaps.
    """
    try:
        features = CanonicalFeatures(
            f_completed=f_completed,
            f_on_time=f_on_time,
            f_canceled=f_canceled,
            f_retry_count=f_retry_count,
            f_timeout_count=f_timeout_count,
            f_missing_required_evidence_count=f_missing_required_evidence_count,
            f_required_evidence_count=f_required_evidence_count,
            f_log_gap_flag=f_log_gap_flag,
            f_security_incident_count=f_security_incident_count,
            f_accepted=f_accepted,
            f_first_pass_accept=f_first_pass_accept,
            f_rework_count=f_rework_count,
            f_confirmed_defect_count=f_confirmed_defect_count,
            f_benchmark_score=f_benchmark_score,
            f_refund_flag=f_refund_flag,
            f_chargeback_flag=f_chargeback_flag,
            f_duration_ms=f_duration_ms,
            f_success_cost=f_success_cost,
            f_token_count=f_token_count,
            f_tool_calls=f_tool_calls,
            f_human_interventions=f_human_interventions,
            f_approval_requests=f_approval_requests,
            f_manual_takeovers=f_manual_takeovers,
            f_subagent_delegations=f_subagent_delegations,
            f_attested_claim_count=f_attested_claim_count,
            f_policy_incident_count=f_policy_incident_count,
            f_unauthorized_tool_count=f_unauthorized_tool_count,
            f_identity_mismatch_count=f_identity_mismatch_count,
            f_runtime_attestation_gap_count=f_runtime_attestation_gap_count
        )
        
        response = client.submit_evaluation(
            contract_id=contract_id,
            delivery_id=delivery_id,
            features=features
        )
        return f"Successfully submitted evaluation to Kojumi! Evaluation ID: {response.get('id')}"
    except Exception as e:
        return f"Failed to submit evaluation: {str(e)}"

if __name__ == "__main__":
    mcp.run()
