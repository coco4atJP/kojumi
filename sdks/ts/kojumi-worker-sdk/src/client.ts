import {
  ContractSchema,
  ExecutionSchema,
  DeliverySchema,
  BenchmarkSchema,
  BenchmarkCupSchema,
  BenchmarkHeartbeatSchema,
  Contract,
  Execution,
  Delivery,
  EvidenceRecord,
  Benchmark,
  BenchmarkCup,
  CreateBenchmarkInput,
  CreateBenchmarkCupInput,
  BenchmarkHeartbeat,
} from "./models";

export class KojumiWorkerClient {
  private apiUrl: string;
  private workerId: string;
  private apiKey?: string;

  constructor(apiUrl: string, workerId: string, apiKey?: string) {
    this.apiUrl = apiUrl.replace(/\/$/, "");
    this.workerId = workerId;
    this.apiKey = apiKey;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) {
      headers["x-api-key"] = this.apiKey;
    }
    return headers;
  }

  async registerAgent(
    name: string,
    description: string = "",
    categories?: string[],
    basePrice: number = 0
  ): Promise<any> {
    const response = await fetch(`${this.apiUrl}/v1/agents`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        name,
        description,
        categories: categories || [],
        base_price: basePrice,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  async *listenContracts(timeout?: number): AsyncGenerator<Contract> {
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    if (this.apiKey) {
      headers["x-api-key"] = this.apiKey;
    }

    const response = await fetch(`${this.apiUrl}/v1/contracts/stream?agent_id=${encodeURIComponent(this.workerId)}`, {
      headers,
      signal: timeout ? AbortSignal.timeout(timeout) : undefined,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          if (data) {
            const parsed = JSON.parse(data);
            if (parsed.event === "contract_created" && parsed.contract) {
              yield ContractSchema.parse(parsed.contract);
            }
          }
        }
      }
    }
  }

  async acceptContract(contractId: string): Promise<{ id: string; status: string }> {
    const response = await fetch(`${this.apiUrl}/v1/contracts/${contractId}/accept`, {
      method: "POST",
      headers: this.headers(),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  async createExecution(contractId: string, progress: number = 0): Promise<Execution> {
    const response = await fetch(`${this.apiUrl}/v1/executions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ contract_id: contractId, progress }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return ExecutionSchema.parse(await response.json());
  }

  async sendExecutionEvent(
    executionId: string,
    eventType: string = "log",
    message: string = "",
    payload?: Record<string, any>
  ): Promise<any> {
    const body: Record<string, any> = { event_type: eventType, message };
    if (payload) {
      body.payload = payload;
    }

    const response = await fetch(`${this.apiUrl}/v1/executions/${executionId}/events`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  async completeExecution(executionId: string): Promise<any> {
    const response = await fetch(`${this.apiUrl}/v1/executions/${executionId}/complete`, {
      method: "POST",
      headers: this.headers(),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  async submitDelivery(
    contractId: string,
    executionId: string,
    outputUri: string,
    summary: string = ""
  ): Promise<Delivery> {
    const response = await fetch(`${this.apiUrl}/v1/deliveries`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        contract_id: contractId,
        execution_id: executionId,
        output_uri: outputUri,
        summary,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return DeliverySchema.parse(await response.json());
  }

  async submitEvidence(evidence: EvidenceRecord): Promise<any> {
    const cleanEvidence = {
      contract_id: evidence.contract_id,
      execution_id: evidence.execution_id,
      source: evidence.source,
      evidence_type: evidence.evidence_type,
      payload: evidence.payload,
      quality_score: evidence.quality_score,
    };

    const response = await fetch(`${this.apiUrl}/v1/evidence`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(cleanEvidence),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  async submitEvaluationJws(jws: string): Promise<any> {
    const response = await fetch(`${this.apiUrl}/v1/evaluations`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ jws }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  async createBenchmarkCup(input: CreateBenchmarkCupInput): Promise<BenchmarkCup> {
    const response = await fetch(`${this.apiUrl}/v1/benchmark-cups`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return BenchmarkCupSchema.parse(await response.json());
  }

  async createBenchmark(input: CreateBenchmarkInput): Promise<Benchmark> {
    const response = await fetch(`${this.apiUrl}/v1/benchmarks`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return BenchmarkSchema.parse(await response.json());
  }

  async sendBenchmarkHeartbeat(benchmarkId: string, status: string = "healthy"): Promise<BenchmarkHeartbeat> {
    const response = await fetch(`${this.apiUrl}/v1/benchmarks/${benchmarkId}/heartbeat`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ status }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return BenchmarkHeartbeatSchema.parse(await response.json());
  }

  async createSettlement(contractId: string, amount: number, status: string = "pending"): Promise<any> {
    const response = await fetch(`${this.apiUrl}/v1/settlements`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ contract_id: contractId, amount, status }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  async createDispute(contractId: string, reason: string, status: string = "open"): Promise<any> {
    const response = await fetch(`${this.apiUrl}/v1/disputes`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ contract_id: contractId, reason, status }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  async getContract(contractId: string): Promise<Contract> {
    const response = await fetch(`${this.apiUrl}/v1/contracts/${contractId}`, {
      headers: this.headers(),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return ContractSchema.parse(await response.json());
  }

  async getExecution(executionId: string): Promise<Execution> {
    const response = await fetch(`${this.apiUrl}/v1/executions/${executionId}`, {
      headers: this.headers(),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return ExecutionSchema.parse(await response.json());
  }

  async getDelivery(deliveryId: string): Promise<Delivery> {
    const response = await fetch(`${this.apiUrl}/v1/deliveries/${deliveryId}`, {
      headers: this.headers(),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return DeliverySchema.parse(await response.json());
  }
}
