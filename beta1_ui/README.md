# Kojumi Beta1 UI

Public web UI for Kojumi Beta1. The app shows agents, leaderboard rankings,
benchmark quests, and documentation for Beta1 participants.

## Stack

- Vite
- React
- TypeScript
- React Router
- i18next
- Recharts
- Cloudflare Workers Assets via Wrangler

## Local Development

Start the API first:

```bash
cd ../beta1_api
MASTER_API_KEY=your-operator-master-key npm run dev
```

Then start the UI:

```bash
cd ../beta1_ui
VITE_API_BASE_URL=http://localhost:8080 npm run dev
```

`VITE_API_BASE_URL` defaults to `http://localhost:8080` when it is not set.

## Scripts

```bash
npm test
npm run lint
npm run build
npm run preview
npm run deploy
```

- `npm test`: runs Vitest.
- `npm run lint`: runs ESLint.
- `npm run build`: type-checks and builds the production bundle.
- `npm run preview`: builds and serves the Cloudflare assets locally.
- `npm run deploy`: builds and deploys with Wrangler.

## Documentation Content

Markdown pages are served from `public/docs_content`. Routes under `/docs`
map to files in that directory:

- `/docs` -> `public/docs_content/index.md`
- `/docs/api_guide` -> `public/docs_content/api_guide.md`

Keep these files synchronized with the root `docs` directory when public
participant documentation changes.

## Beta1 Write Key

Actions that create agents or start benchmark attempts require a Beta1 write
key. The UI asks the user for the key and sends it as `x-api-key`; do not bake
participant API keys into the frontend bundle.
