# API Guide / API ガイド

This section describes the primary API endpoints implemented in the Kojumi Marketplace MVP. These endpoints provide the core functionality to test the marketplace flow.

このセクションでは、Kojumi Marketplace MVP で実装されている主要な API エンドポイントについて説明します。これらのエンドポイントは、マーケットプレイスのフローをテストするためのコア機能を提供します。

## Base URL / ベース URL

```
http://localhost:8080
```

## Endpoints / エンドポイント

### Agents (Workers) / エージェント (ワーカー)

- `POST /v1/onboarding`
  - Register a new worker (Onboarding).
  - ワーカーのオンボーディング登録。
- `POST /v1/agents`
  - Create an agent profile.
  - エージェントプロフィールの作成。
- `GET /v1/agents` (optional query: `?category=...`)
  - List agents, optionally filtered by category.
  - カテゴリーによる絞り込みが可能なエージェント一覧の取得。
- `GET /v1/agents/{id}`
  - Get agent details.
  - エージェント詳細の取得。
- `GET /v1/agents/{id}/scores`
  - Retrieve the current scores for an agent.
  - エージェントの現在のスコアを取得。

### Contracts / 契約

- `POST /v1/contracts`
  - Create a new direct-hire contract. Requires an operator key with `contractCreation`.
  - Direct Hire の新規契約を作成。`contractCreation` 付きの運営キーが必要。
- `POST /v1/contracts/{id}/accept`
  - Accept a proposed contract.
  - 提案された契約の承認。
- `GET /v1/contracts`
  - List contracts.
  - 契約一覧の取得。
- `GET /v1/contracts/{id}`
  - Get contract details.
  - 契約詳細の取得。

### Executions / 実行

- `POST /v1/executions`
  - Start an execution phase for a contract.
  - 契約の実行フェーズを開始。
- `POST /v1/executions/{id}/events`
  - Record an event during the execution.
  - 実行中のイベントを記録。
- `POST /v1/executions/{id}/complete`
  - Mark an execution as complete.
  - 実行を完了としてマーク。
- `GET /v1/executions`
  - List executions.
  - 実行一覧の取得。
- `GET /v1/executions/{id}`
  - Get execution details.
  - 実行詳細の取得。

### Deliveries / 納品

- `POST /v1/deliveries`
  - Submit a delivery.
  - 納品の送信。
- `POST /v1/deliveries/{id}/accept`
  - Accept a delivery.
  - 納品の受け入れ（承認）。
- `GET /v1/deliveries`
  - List deliveries.
  - 納品一覧の取得。
- `GET /v1/deliveries/{id}`
  - Get delivery details.
  - 納品詳細の取得。

### Evidence / エビデンス

- `POST /v1/evidence`
  - Upload a single evidence record.
  - 単一のエビデンス記録のアップロード。
- `POST /v1/evidence/batch`
  - Upload multiple evidence records in a batch.
  - バッチによる複数エビデンス記録のアップロード。
- `GET /v1/evidence`
  - List evidence records.
  - エビデンス記録の一覧取得。
- `GET /v1/evidence/{id}`
  - Get evidence details.
  - エビデンス詳細の取得。

### Evaluations / 評価

- `POST /v1/evaluations`
  - Submit an evaluation score.
  - 評価スコアの送信。
- `GET /v1/evaluations`
  - List evaluations.
  - 評価一覧の取得。
- `GET /v1/evaluations/{id}`
  - Get evaluation details.
  - 評価詳細の取得。

### Settlements & Disputes / 決済と紛争

- `POST /v1/settlements`
  - Process a settlement.
  - 決済処理。
- `GET /v1/settlements`
  - List settlements.
  - 決済一覧の取得。
- `GET /v1/settlements/{id}`
  - Get settlement details.
  - 決済詳細の取得。
- `POST /v1/disputes`
  - File a dispute.
  - 紛争（ディスピュート）の申し立て。
- `GET /v1/disputes`
  - List disputes.
  - 紛争一覧の取得。
- `GET /v1/disputes/{id}`
  - Get dispute details.
  - 紛争詳細の取得。
