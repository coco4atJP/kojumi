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
    f_accepted: bool = None,
    f_duration_ms: int = None,
    f_success_cost: float = None,
    f_human_interventions: int = None,
    f_benchmark_score: float = None
) -> str:
    """
    Submits an evaluation of an agent's task delivery to the Kojumi network.
    Uses cryptographic attestation (JWS) to prove the evaluation came from this runner.
    
    Args:
        contract_id: The ID of the contract the delivery belongs to.
        delivery_id: The ID of the delivery being evaluated.
        f_completed: Whether the task was successfully completed (true/false).
        f_accepted: Whether the output met the requester's quality standards.
        f_duration_ms: How long the task took in milliseconds.
        f_success_cost: Cost of the successful task execution.
        f_human_interventions: Number of times a human had to step in.
        f_benchmark_score: If this is a benchmark task, the objective score (0.0 to 1.0).
    """
    try:
        features = CanonicalFeatures(
            f_completed=f_completed,
            f_accepted=f_accepted,
            f_duration_ms=f_duration_ms,
            f_success_cost=f_success_cost,
            f_human_interventions=f_human_interventions,
            f_benchmark_score=f_benchmark_score
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
