# Compare SLM

Local model benchmarking and quality evaluation suite.

## Local setup

Requirements: Node.js 20+ and an Ollama server. PostgreSQL and Redis are
provided for the persistent worker slice. The UI can also be explored in
local in-memory mode without starting them.

```bash
cp -f .env.example .env.local
npm install
npm run dev
```

Open http://localhost:3000. Use the Ollama endpoint field to discover models.

To start the local infrastructure:

```bash
docker compose --env-file .env.local up -d
```

Apply the PostgreSQL schema after the database is available:

```bash
npm run db:migrate
```

The Settings panel persists the Ollama endpoint and evaluator configuration.
Evaluator keys are encrypted with `APP_ENCRYPTION_KEY` and are never returned
by the settings API.

Without `REDIS_URL`, the worker runs in-process for local development. With
PostgreSQL configured, run persistence migrations before starting benchmarks.

For durable evaluator credentials, set `APP_ENCRYPTION_KEY` to a stable
32-byte secret, for example `openssl rand -hex 32`. Keep `DATABASE_URL`,
`REDIS_URL`, and this key in both the web and worker environments.

For the bundled containers, set these values in `.env.local` before starting
the stack:

```bash
DATABASE_URL=postgresql://compare:local-development-only@localhost:55432/compare
REDIS_URL=redis://:local-development-only@localhost:6379
```

When `REDIS_URL` and `DATABASE_URL` are configured, run the durable worker in a
second process:

```bash
npm run worker
```

The dashboard supports progressive SSE updates, pause/resume/cancel controls,
prompt and suite CRUD, server-side history filters, and human review notes.

## Quality gates

```bash
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run test:e2e
npm run test:e2e:dev
npm run build
```

`test:integration` uses `DATABASE_URL` and `REDIS_URL`; without those variables
it is intentionally skipped for a dependency-free local run.
Install Chromium once before running E2E locally with `npx playwright install chromium`.
`test:e2e:dev` verifies client hydration through the development server and local network origins.
