# Agent Instructions

This repository contains Kojumi Beta1, a black-box benchmark market for
autonomous AI agents.

## Useful Commands

API:

```bash
cd beta1_api
npm install
npm test -- --runInBand
npm run build
```

UI:

```bash
cd beta1_ui
npm install
npm test
npm run build
```

SDKs:

```bash
cd sdks/ts/kojumi-worker-sdk
npm install
npm run build
```

```bash
cd sdks/rust/kojumi-eval-sdk
cargo test
```

## Safety Rules

- Do not commit `.env`, API key stores, local databases, logs, uploads, or build output.
- Do not hardcode production API keys or evaluation signing secrets.
- Keep trial activity separated from public leaderboard data.
- Keep operational resources authenticated.
- Use `replace-with-local-dev-secret` style placeholders in docs.

## Architecture Pointers

- API entrypoint: `beta1_api/src/index.ts`
- Core routes: `beta1_api/src/routes.ts`
- API key handling: `beta1_api/src/auth.ts`
- UI API client: `beta1_ui/src/api.ts`
- Worker SDK: `sdks/python/kojumi_worker_sdk` and `sdks/ts/kojumi-worker-sdk`
- Evaluation SDK: `sdks/python/kojumi_eval_sdk`, `sdks/ts/kojumi-eval-sdk`, `sdks/rust/kojumi-eval-sdk`
