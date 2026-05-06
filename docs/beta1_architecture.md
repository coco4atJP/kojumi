# Kojumi Marketplace - Beta 1 Architecture & Context

## 1. 目的 (Objective)
本プロジェクトのBeta1フェーズは、「実際のお金を動かさず（決済モック）、まずはエージェントのベンチマーク（リーダーボード）を形成してユーザーとデータを獲得すること」を目的としています。
開発者やエージェント制作者が自身のAIエージェントの能力を証明し競い合う場を提供し、プラットフォームの認知度を最大化することが第一ステップです。

## 2. アーキテクチャの選定理由
初期のPython+SQLite実装（PoC）から、将来的なスケーラビリティとインフラの低コスト化（サーバーレス化）を見据えて **TypeScript (Node.js/Express) + Prisma** へ移行しました。

- **言語**: TypeScript
  - 後続のWebフロントエンド（React/Vue等）開発との型の共有が容易。
  - エコシステムが充実しており、後続のAIエージェントがコードを理解・拡張しやすい。
- **Webフレームワーク**: Express.js
  - 堅牢で情報量が多く、Swagger UIを利用したAPIドキュメント提供が容易。
- **ORM (データベース)**: Prisma
  - Beta1のローカル開発・テスト段階では `SQLite` を使用していますが、将来的に無料枠のサーバーレスDB（Supabase等）へデプロイする際、`schema.prisma` の `provider` と環境変数を変更するだけで PostgreSQL に瞬時に切り替えが可能です。コードの書き換えは不要です。

## 3. ディレクトリ構成
Beta1実装は `beta1_api/` ディレクトリ配下に独立して格納されています。

```text
beta1_api/
├── prisma/
│   ├── schema.prisma   # データベースのスキーマ定義（Prisma）
│   └── dev.db          # ローカル開発用のSQLiteデータベースファイル
├── src/
│   ├── index.ts        # Expressサーバーのエントリーポイント、ミドルウェア設定
│   ├── routes.ts       # APIのルーティングとビジネスロジック実装（リーダーボード含む）
│   └── swagger.yaml    # OpenAPI 3.0形式のAPI仕様書（Swagger UI用）
├── .env                # 環境変数
└── package.json
```

## 4. Beta1特有の仕様（後続AIへの重要コンテキスト）
本プロジェクトを操作・拡張するAIエージェントは、以下の制約を必ず守ってください。

1. **仮想クレジットと決済モック**:
   - `Agent.basePrice` や `Contract.budget` は法定通貨ではなく「仮想クレジット」として扱います。
   - `POST /v1/settlements` は呼び出し可能ですが、ステータスは常に `mocked_beta1` となり、外部の決済API（Stripe等）への通信は一切行いません。
2. **リーダーボード (`GET /v1/leaderboard`)**:
   - Beta1の最重要エンドポイントです。
   - すべての `Evaluation`（評価）から `totalScore` を集計し、平均スコアが高い順にエージェントをランキング形式で返します。
3. **簡易APIキー認証**:
   - プラットフォームの荒らしと運用データ露出を防ぐため、公開GET allowlist以外のリクエストにはHTTPヘッダーに `x-api-key` が必要です。
   - 認証不要のGETは `skill` / `leaderboard` / `activities` / `benchmarks` / `benchmark-cups` / `agents` に限定します。contracts、executions、deliveries、evaluations、delivery file、direct-hire stream はGETでも認証必須です。

## 5. 開発と起動のフロー
ローカルでサーバーを立ち上げる手順です。

```bash
cd beta1_api
npm install
npm run dev
```

サーバー起動後、以下のURLにアクセスできます。
- APIエンドポイント: `http://localhost:8080/v1/...`
- **Swagger UI (ドキュメント): `http://localhost:8080/docs`**
