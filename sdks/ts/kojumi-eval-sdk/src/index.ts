import { z } from "zod";
import jwt from "jsonwebtoken";

// Zod schema for canonical features
export const CanonicalFeaturesSchema = z.object({
  // Reliability
  f_completed: z.boolean().optional(),
  f_on_time: z.boolean().optional(),
  f_canceled: z.boolean().optional(),
  f_retry_count: z.number().int().optional(),
  f_timeout_count: z.number().int().optional(),
  f_missing_required_evidence_count: z.number().int().optional(),
  f_required_evidence_count: z.number().int().optional(),
  f_log_gap_flag: z.boolean().optional(),
  f_security_incident_count: z.number().int().optional(),

  // Quality
  f_accepted: z.boolean().optional(),
  f_first_pass_accept: z.boolean().optional(),
  f_rework_count: z.number().int().optional(),
  f_confirmed_defect_count: z.number().int().optional(),
  f_benchmark_score: z.number().optional(),
  f_refund_flag: z.boolean().optional(),
  f_chargeback_flag: z.boolean().optional(),

  // Efficiency
  f_duration_ms: z.number().int().optional(),
  f_success_cost: z.number().optional(),
  f_token_count: z.number().int().optional(),
  f_tool_calls: z.number().int().optional(),

  // Autonomy
  f_human_interventions: z.number().int().optional(),
  f_approval_requests: z.number().int().optional(),
  f_manual_takeovers: z.number().int().optional(),
  f_subagent_delegations: z.number().int().optional(),

  // Transparency / safety
  f_attested_claim_count: z.number().int().optional(),
  f_policy_incident_count: z.number().int().optional(),
  f_unauthorized_tool_count: z.number().int().optional(),
  f_identity_mismatch_count: z.number().int().optional(),
  f_runtime_attestation_gap_count: z.number().int().optional(),
});

export type CanonicalFeatures = z.infer<typeof CanonicalFeaturesSchema>;

export interface EvaluationResponse {
  id: string;
  [key: string]: any;
}

export class KojumiEvalClient {
  private apiUrl: string;
  private signingSecret: string;
  private apiKey?: string;

  constructor(apiUrl: string, signingSecret: string, apiKey?: string) {
    this.apiUrl = apiUrl.replace(/\/$/, "");
    this.signingSecret = signingSecret;
    this.apiKey = apiKey;
  }

  private createJws(
    contractId: string,
    deliveryId: string,
    features: CanonicalFeatures
  ): string {
    // Validate inputs using Zod
    const validatedFeatures = CanonicalFeaturesSchema.parse(features);

    // Filter out undefined values
    const cleanFeatures = Object.fromEntries(
      Object.entries(validatedFeatures).filter(([_, v]) => v !== undefined)
    );

    const payload = {
      contract_id: contractId,
      delivery_id: deliveryId,
      features: cleanFeatures,
    };

    // Using HS256 for beta1 compatibility
    return jwt.sign(payload, this.signingSecret, { algorithm: "HS256" });
  }

  public async submitEvaluation(
    contractId: string,
    deliveryId: string,
    features: CanonicalFeatures
  ): Promise<EvaluationResponse> {
    const jws = this.createJws(contractId, deliveryId, features);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["x-api-key"] = this.apiKey;
    }

    const response = await fetch(`${this.apiUrl}/v1/evaluations`, {
      method: "POST",
      headers,
      body: JSON.stringify({ jws }),
    });

    if (!response.ok) {
      let errorMsg = `HTTP error! status: ${response.status}`;
      try {
        const errorData = await response.json();
        if (errorData.error) errorMsg += ` - ${errorData.error}`;
      } catch (e) {
        // ignore JSON parse error
      }
      throw new Error(errorMsg);
    }

    return response.json() as Promise<EvaluationResponse>;
  }
}
