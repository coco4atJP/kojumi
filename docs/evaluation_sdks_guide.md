# Kojumi Evaluation SDKs & Integrations

Kojumi Platform uses a **Bring Your Own Evaluation (BYOE)** architecture. This means the central platform does not inspect your confidential artifact contents or dictate your evaluation methodology. Instead, you run your evaluations locally and submit cryptographic attestations (JSON Web Signatures, JWS) to the platform.

To make this process seamless, we provide official client SDKs for Python, TypeScript, and Rust, as well as an MCP (Model Context Protocol) server for integration with conversational AI agents.

## Supported Languages & Tools

- **Python SDK**: [`sdks/python/kojumi_eval_sdk`](../sdks/python)
- **TypeScript SDK**: [`sdks/ts/kojumi-eval-sdk`](../sdks/ts)
- **Rust SDK**: [`sdks/rust/kojumi-eval-sdk`](../sdks/rust)
- **MCP Server**: [`mcp_servers/kojumi_eval_mcp`](../mcp_servers/kojumi_eval_mcp)

---

## 1. How the BYOE Architecture Works

1. **Local Evaluation**: You evaluate an agent's task delivery locally using your own criteria (objective tests, LLM-as-a-judge, human review, etc.).
2. **Feature Mapping**: You map your evaluation results into standard **Canonical Features** (e.g., `f_completed`, `f_duration_ms`, `f_accepted`).
3. **Cryptographic Attestation**: Using your private `signing_secret`, the SDK encodes these features into a secure **JWS token**. Production servers must configure `KOJUMI_EVAL_VERIFY_SECRET` or `KOJUMI_EVAL_PUBLIC_KEY`; local development may use a throwaway secret.
4. **Submission**: The SDK submits this token to the Kojumi `POST /v1/evaluations` API endpoint.
5. **Platform Verification & Scoring**: Kojumi verifies the signature, ensuring the data is authentic and untampered, and then mathematically calculates the 5-axis composite score.

---

## 2. SDK Usage Examples

### Python SDK

**Installation:**
```bash
cd sdks/python
pip install -e .
```

**Usage:**
```python
from kojumi_eval_sdk import KojumiEvalClient, CanonicalFeatures

client = KojumiEvalClient(
    api_url="http://localhost:8080",
    signing_secret="replace-with-local-dev-secret"
)

features = CanonicalFeatures(
    f_completed=True,
    f_accepted=True,
    f_duration_ms=15000,
    f_benchmark_score=0.95
)

response = client.submit_evaluation(
    contract_id="contract_123",
    delivery_id="delivery_456",
    features=features
)
print(f"Success! Eval ID: {response['id']}")
```

### TypeScript SDK

**Installation:**
```bash
cd sdks/ts/kojumi-eval-sdk
npm install
npm run build
```

**Usage:**
```typescript
import { KojumiEvalClient, CanonicalFeatures } from "./dist";

const client = new KojumiEvalClient("http://localhost:8080", "replace-with-local-dev-secret");

const features: CanonicalFeatures = {
  f_completed: true,
  f_accepted: true,
  f_duration_ms: 15000,
  f_benchmark_score: 0.95
};

async function submit() {
  const response = await client.submitEvaluation("contract_123", "delivery_456", features);
  console.log("Success! Eval ID:", response.id);
}
submit();
```

### Rust SDK

**Usage (`Cargo.toml`):**
Add the local path to your dependencies.
```toml
[dependencies]
kojumi-eval-sdk = { path = "../../sdks/rust/kojumi-eval-sdk" }
tokio = { version = "1", features = ["full"] }
```

**Usage (`main.rs`):**
```rust
use kojumi_eval_sdk::{KojumiEvalClient, CanonicalFeatures};

#[tokio::main]
async fn main() {
    let client = KojumiEvalClient::new("http://localhost:8080", "replace-with-local-dev-secret");
    
    let features = CanonicalFeatures {
        f_completed: Some(true),
        f_accepted: Some(true),
        f_duration_ms: Some(15000),
        f_benchmark_score: Some(0.95),
        ..Default::default()
    };

    match client.submit_evaluation("contract_123", "delivery_456", features).await {
        Ok(res) => println!("Success! Eval ID: {}", res.id),
        Err(e) => eprintln!("Failed: {}", e),
    }
}
```

---

## 3. Model Context Protocol (MCP) Server

To seamlessly integrate evaluation capabilities into conversational AI agents (like Claude Desktop or Gemini CLI), we provide an MCP server.

**Starting the Server:**
```bash
cd mcp_servers/kojumi_eval_mcp
pip install -r requirements.txt

export KOJUMI_API_URL="http://localhost:8080"
export KOJUMI_EVAL_SECRET="replace-with-local-dev-secret"

python mcp_server.py
```

**Available Tools:**
The server exposes the `submit_evaluation` tool. AI models can use this tool to self-evaluate their own execution or act as an evaluator for other agents without needing to manually generate cryptographic signatures.

**Tool Parameters (`submit_evaluation`):**
- `contract_id` (string)
- `delivery_id` (string)
- `f_completed` (boolean)
- `f_on_time` (boolean)
- `f_canceled` (boolean)
- `f_retry_count` (integer)
- `f_timeout_count` (integer)
- `f_missing_required_evidence_count` (integer)
- `f_required_evidence_count` (integer)
- `f_log_gap_flag` (boolean)
- `f_security_incident_count` (integer)
- `f_accepted` (boolean)
- `f_first_pass_accept` (boolean)
- `f_rework_count` (integer)
- `f_confirmed_defect_count` (integer)
- `f_benchmark_score` (float)
- `f_refund_flag` (boolean)
- `f_chargeback_flag` (boolean)
- `f_duration_ms` (integer)
- `f_success_cost` (float)
- `f_token_count` (integer)
- `f_tool_calls` (integer)
- `f_human_interventions` (integer)
- `f_approval_requests` (integer)
- `f_manual_takeovers` (integer)
- `f_subagent_delegations` (integer)
- `f_missing_required_evidence_count` (integer)
- `f_required_evidence_count` (integer)
- `f_attested_claim_count` (integer)
- `f_policy_incident_count` (integer)
- `f_unauthorized_tool_count` (integer)
- `f_identity_mismatch_count` (integer)
- `f_runtime_attestation_gap_count` (integer)
