from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, List, Dict, Any, Literal
from datetime import datetime
from enum import Enum


class ContractStatus(str, Enum):
    CREATED = "created"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    CANCELED = "canceled"


class ExecutionStatus(str, Enum):
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class DeliveryStatus(str, Enum):
    SUBMITTED = "submitted"
    ACCEPTED = "accepted"
    REJECTED = "rejected"


class EvidenceType(str, Enum):
    ARTIFACT = "artifact"
    TELEMETRY = "telemetry"
    LOG = "log"
    METRIC = "metric"


class BenchmarkQualityStatus(str, Enum):
    EXPERIMENTAL = "experimental"
    REVIEWED = "reviewed"
    VERIFIED = "verified"
    ARCHIVED = "archived"


class Contract(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    requester_id: str = Field(alias="requesterId")
    agent_id: str = Field(alias="agentId")
    benchmark_id: Optional[str] = Field(default=None, alias="benchmarkId")
    task_category: str = Field(alias="taskCategory")
    brief: str
    budget: float
    status: ContractStatus
    created_at: datetime = Field(alias="createdAt")


class Execution(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    contract_id: str = Field(alias="contractId")
    status: ExecutionStatus
    progress: int = 0
    updated_at: datetime = Field(alias="updatedAt")


class Delivery(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    contract_id: str = Field(alias="contractId")
    execution_id: str = Field(alias="executionId")
    output_uri: str = Field(alias="outputUri")
    summary: str = ""
    status: DeliveryStatus
    created_at: datetime = Field(alias="createdAt")


class EvidenceRecord(BaseModel):
    contract_id: Optional[str] = None
    execution_id: Optional[str] = None
    source: str = "worker_sdk"
    evidence_type: EvidenceType = EvidenceType.ARTIFACT
    payload: Dict[str, Any] = Field(default_factory=dict)
    quality_score: float = 0.0


class EvaluationScore(BaseModel):
    quality_score: float = Field(ge=0, le=1)
    speed_score: float = Field(ge=0, le=1)
    cost_score: float = Field(ge=0, le=1)
    evidence_score: float = Field(ge=0, le=1)
    reliability_score: float = Field(ge=0, le=1)


class BenchmarkCup(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    slug: str
    title: str
    description: str
    requester_tag: str = Field(alias="requesterTag")
    status: str
    created_at: datetime = Field(alias="createdAt")


class Benchmark(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    title: str
    description: str
    category: str
    difficulty: str
    reward: float
    suggested_reward: Optional[float] = Field(default=None, alias="suggestedReward")
    quality_status: BenchmarkQualityStatus = Field(default=BenchmarkQualityStatus.EXPERIMENTAL, alias="qualityStatus")
    leaderboard_weight: float = Field(default=0.3, alias="leaderboardWeight", ge=0, le=1)
    requester_tag: str = Field(alias="requesterTag")
    organizer_type: str = Field(alias="organizerType")
    benchmark_cup_id: Optional[str] = Field(default=None, alias="benchmarkCupId")
    metadata_json: Optional[str] = Field(default=None, alias="metadataJson")
    hosting_url: Optional[str] = Field(default=None, alias="hostingUrl")
    healthcheck_url: Optional[str] = Field(default=None, alias="healthcheckUrl")
    health_status: str = Field(alias="healthStatus")
    last_heartbeat_at: Optional[datetime] = Field(default=None, alias="lastHeartbeatAt")
    status: str
    created_at: datetime = Field(alias="createdAt")
    benchmark_cup: Optional[BenchmarkCup] = Field(default=None, alias="benchmarkCup")


class CreateBenchmarkCupInput(BaseModel):
    slug: str
    title: str
    requester_tag: str
    description: Optional[str] = None
    status: Optional[str] = None


class CreateBenchmarkInput(BaseModel):
    title: str
    description: str
    category: str
    requester_tag: str
    difficulty: Optional[str] = None
    reward: Optional[float] = None
    quality_status: Optional[BenchmarkQualityStatus] = None
    leaderboard_weight: Optional[float] = Field(default=None, ge=0, le=1)
    evaluation_tier: Optional[Literal["light", "standard", "high", "frontier"]] = None
    organizer_type: Optional[str] = None
    benchmark_cup_id: Optional[str] = None
    benchmark_cup_slug: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    metadata_json: Optional[str] = None
    hosting_url: Optional[str] = None
    healthcheck_url: Optional[str] = None
    health_status: Optional[str] = None
    status: Optional[str] = None


class BenchmarkHeartbeat(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    requester_tag: str = Field(alias="requesterTag")
    health_status: str = Field(alias="healthStatus")
    last_heartbeat_at: Optional[datetime] = Field(default=None, alias="lastHeartbeatAt")
    benchmark_cup: Optional[BenchmarkCup] = Field(default=None, alias="benchmarkCup")


class Settlement(BaseModel):
    contract_id: str
    amount: float
    status: str = "pending"


class Dispute(BaseModel):
    contract_id: str
    reason: str
    status: str = "open"
