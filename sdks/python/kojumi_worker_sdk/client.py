import json
import time
import threading
import requests
from typing import Optional, Callable, Iterator, List, Dict, Any

from .models import (
    Contract,
    Execution,
    Delivery,
    EvidenceRecord,
    Benchmark,
    BenchmarkCup,
    CreateBenchmarkInput,
    CreateBenchmarkCupInput,
    BenchmarkHeartbeat,
    Settlement,
    ContractStatus,
    ExecutionStatus,
    DeliveryStatus,
)


class KojumiWorkerClient:
    def __init__(
        self,
        api_url: str,
        worker_id: str,
        api_key: Optional[str] = None,
    ):
        self.api_url = api_url.rstrip("/")
        self.worker_id = worker_id
        self.api_key = api_key

    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["x-api-key"] = self.api_key
        return headers

    def register_agent(self, name: str, description: str = "", categories: Optional[List[str]] = None, base_price: float = 0.0) -> Dict[str, Any]:
        response = requests.post(
            f"{self.api_url}/v1/agents",
            json={
                "name": name,
                "description": description,
                "categories": categories or [],
                "base_price": base_price,
            },
            headers=self._headers(),
        )
        response.raise_for_status()
        return response.json()

    def listen_contracts(self, timeout: Optional[int] = None) -> Iterator[Contract]:
        headers = {"Accept": "text/event-stream"}
        if self.api_key:
            headers["x-api-key"] = self.api_key

        try:
            response = requests.get(
                f"{self.api_url}/v1/contracts/stream",
                params={"agent_id": self.worker_id},
                headers=headers,
                stream=True,
                timeout=timeout,
            )
            response.raise_for_status()

            for line in response.iter_lines(decode_unicode=True):
                if line.startswith("data:"):
                    data = line[5:].strip()
                    if data:
                        event_data = json.loads(data)
                        if event_data.get("event") == "contract_created" and event_data.get("contract"):
                            yield Contract(**event_data["contract"])
        except requests.exceptions.Timeout:
            return

    def poll_contracts(self, interval: float = 5.0, callback: Optional[Callable[[Contract], None]] = None) -> None:
        seen_ids: set = set()
        while True:
            try:
                response = requests.get(f"{self.api_url}/v1/contracts", headers={"x-api-key": self.api_key} if self.api_key else {})
                response.raise_for_status()
                data = response.json()
                for item in data.get("items", []):
                    if item["agentId"] == self.worker_id and item["id"] not in seen_ids:
                        seen_ids.add(item["id"])
                        contract = Contract(**item)
                        if callback:
                            callback(contract)
                        if self._should_stop:
                            break
                time.sleep(interval)
            except Exception:
                time.sleep(interval)

    def _start_monitoring(self, interval: float, callback: Optional[Callable[[Contract], None]]):
        self._should_stop = False
        thread = threading.Thread(target=self.poll_contracts, args=(interval, callback), daemon=True)
        thread.start()
        return thread

    def stop_monitoring(self):
        self._should_stop = True

    def accept_contract(self, contract_id: str) -> Dict[str, Any]:
        response = requests.post(
            f"{self.api_url}/v1/contracts/{contract_id}/accept",
            headers=self._headers(),
        )
        response.raise_for_status()
        return response.json()

    def create_execution(self, contract_id: str, progress: int = 0) -> Execution:
        response = requests.post(
            f"{self.api_url}/v1/executions",
            json={"contract_id": contract_id, "progress": progress},
            headers=self._headers(),
        )
        response.raise_for_status()
        data = response.json()
        return Execution(**data)

    def send_execution_event(
        self,
        execution_id: str,
        event_type: str = "log",
        message: str = "",
        payload: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        body = {"event_type": event_type, "message": message}
        if payload:
            body["payload"] = payload
        response = requests.post(
            f"{self.api_url}/v1/executions/{execution_id}/events",
            json=body,
            headers=self._headers(),
        )
        response.raise_for_status()
        return response.json()

    def complete_execution(self, execution_id: str) -> Dict[str, Any]:
        response = requests.post(
            f"{self.api_url}/v1/executions/{execution_id}/complete",
            headers=self._headers(),
        )
        response.raise_for_status()
        return response.json()

    def submit_delivery(
        self,
        contract_id: str,
        execution_id: str,
        output_uri: str,
        summary: str = "",
    ) -> Delivery:
        response = requests.post(
            f"{self.api_url}/v1/deliveries",
            json={
                "contract_id": contract_id,
                "execution_id": execution_id,
                "output_uri": output_uri,
                "summary": summary,
            },
            headers=self._headers(),
        )
        response.raise_for_status()
        data = response.json()
        return Delivery(**data)

    def submit_evidence(self, evidence: EvidenceRecord) -> Dict[str, Any]:
        response = requests.post(
            f"{self.api_url}/v1/evidence",
            json={
                "contract_id": evidence.contract_id,
                "execution_id": evidence.execution_id,
                "source": evidence.source,
                "evidence_type": evidence.evidence_type.value if hasattr(evidence.evidence_type, "value") else evidence.evidence_type,
                "payload": evidence.payload,
                "quality_score": evidence.quality_score,
            },
            headers=self._headers(),
        )
        response.raise_for_status()
        return response.json()

    def submit_evaluation_jws(self, jws: str) -> Dict[str, Any]:
        response = requests.post(
            f"{self.api_url}/v1/evaluations",
            json={"jws": jws},
            headers=self._headers(),
        )
        response.raise_for_status()
        return response.json()

    def create_benchmark_cup(self, input_data: CreateBenchmarkCupInput) -> BenchmarkCup:
        response = requests.post(
            f"{self.api_url}/v1/benchmark-cups",
            json=input_data.model_dump(exclude_none=True),
            headers=self._headers(),
        )
        response.raise_for_status()
        return BenchmarkCup(**response.json())

    def create_benchmark(self, input_data: CreateBenchmarkInput) -> Benchmark:
        response = requests.post(
            f"{self.api_url}/v1/benchmarks",
            json=input_data.model_dump(exclude_none=True),
            headers=self._headers(),
        )
        response.raise_for_status()
        return Benchmark(**response.json())

    def send_benchmark_heartbeat(self, benchmark_id: str, status: str = "healthy") -> BenchmarkHeartbeat:
        response = requests.post(
            f"{self.api_url}/v1/benchmarks/{benchmark_id}/heartbeat",
            json={"status": status},
            headers=self._headers(),
        )
        response.raise_for_status()
        return BenchmarkHeartbeat(**response.json())

    def create_settlement(self, contract_id: str, amount: float, status: str = "pending") -> Dict[str, Any]:
        response = requests.post(
            f"{self.api_url}/v1/settlements",
            json={"contract_id": contract_id, "amount": amount, "status": status},
            headers=self._headers(),
        )
        response.raise_for_status()
        return response.json()

    def get_contract(self, contract_id: str) -> Contract:
        response = requests.get(
            f"{self.api_url}/v1/contracts/{contract_id}",
            headers=self._headers(),
        )
        response.raise_for_status()
        return Contract(**response.json())

    def get_execution(self, execution_id: str) -> Execution:
        response = requests.get(
            f"{self.api_url}/v1/executions/{execution_id}",
            headers=self._headers(),
        )
        response.raise_for_status()
        return Execution(**response.json())

    def get_delivery(self, delivery_id: str) -> Delivery:
        response = requests.get(
            f"{self.api_url}/v1/deliveries/{delivery_id}",
            headers=self._headers(),
        )
        response.raise_for_status()
        return Delivery(**response.json())
