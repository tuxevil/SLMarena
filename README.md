# SLMarena

SLMarena is a local language-model benchmarking and quality-evaluation
workspace. It runs the same scenario against one or more Ollama models,
captures response-quality and performance telemetry, optionally sends completed
answers to an OpenAI-compatible evaluator, and keeps the results available for
comparison across repeated runs.

The application is designed for local, private model evaluation. It supports a
single-process development mode backed by SQLite as well as a durable web-and-
worker deployment backed by PostgreSQL and Redis.

## Highlights

- Discover models from an Ollama endpoint and select several models for one run.
- Define reusable scenarios with a system prompt and one or more user turns.
- Run 1–10 samples per model to measure repeatability instead of relying on a
  single response.
- Stream responses to the dashboard while a run is in progress.
- Record time to first token (TTFT), input and output tokens, throughput, and
  total duration for every model result and conversation turn.
- Optionally evaluate answers through an OpenAI-compatible
  `/chat/completions` endpoint with structured JSON output.
- Compare aggregated scores and telemetry across all runs for a scenario.
- Collapse individual model groups, or all groups at once, while keeping their
  summary cards visible.
- Show per-model averages for the overall score plus Grammar, Compliance, and
  Accuracy ratings.
- Filter benchmark history by keyword, date, model, or score.
- Add human review decisions and notes to completed answers.
- Pause, resume, cancel, and delete individual samples.
- Persist evaluator credentials encrypted at rest and never return them from the
  settings API.

## Architecture

The project is a Next.js application with a React client dashboard and typed
server-side API routes.

```text
Browser dashboard
       │
       ▼
Next.js API routes ── Benchmark store ── Ollama /api/chat
       │                    │
       │                    ├── optional OpenAI-compatible evaluator
       │                    └── SQLite or PostgreSQL persistence
       │
       └── Server-sent events (SSE)

Durable mode: Next.js → Redis/BullMQ → src/worker.ts
```

### Execution modes

- **Local mode:** leave `REDIS_URL` empty. Benchmark jobs execute in the web
  process and are persisted to SQLite at `SQLITE_PATH`, or to `slmarena.db` in
  the project directory when `SQLITE_PATH` is not set. This is the simplest
  setup for development and a single local user.
- **Durable mode:** set both `DATABASE_URL` and `REDIS_URL`. The web process
  enqueues jobs in BullMQ, `src/worker.ts` consumes them, PostgreSQL stores the
  run state, and Redis publishes progress events between processes. A worker
  must be running for queued benchmarks to complete.

`REDIS_URL` requires `DATABASE_URL`; without durable storage, a separate worker
cannot recover the run configuration safely.

## Requirements

For local development:

- Node.js 20 or newer
- npm
- An Ollama server with at least one model pulled, for example:

  ```bash
  ollama pull llama3.2
  ```

For durable mode, also install Docker (for the bundled PostgreSQL and Redis
services) and the PostgreSQL `psql` client.

## Quick start

1. Create a local environment file and install dependencies:

   ```bash
   cp -f .env.example .env.local
   npm install
   ```

2. Start the web application:

   ```bash
   npm run dev
   ```

3. Open [http://localhost:3000](http://localhost:3000).

4. In the **Benchmark** tab, use **Discover models** to load models from the
   configured Ollama endpoint, select the models to compare, and start a run.

The default Ollama endpoint is `http://localhost:11434`. It can be changed in
the Settings panel or with `OLLAMA_URL`. In local mode, the first request will
create the SQLite database automatically.

## Configuring evaluation

Evaluation is optional. A run uses the configured evaluator only when all three
of these values are present:

```dotenv
EVALUATOR_BASE_URL=https://api.example.com/v1
EVALUATOR_MODEL=your-judge-model
EVALUATOR_API_KEY=your-api-key
```

The evaluator receives the original system prompt, the user conversation, and
the model response. Its structured result is mapped to:

- an overall 1–5 star score;
- grammar and spelling analysis;
- system-prompt compliance analysis;
- accuracy and relevance analysis; and
- a short verdict shown in the result details.

The client accepts an OpenAI-compatible base URL and appends
`/chat/completions` when necessary. If the endpoint rejects structured JSON
output with HTTP 400, SLMarena retries once without `response_format` and still
validates the returned JSON before storing it. When the evaluator is not
configured, model results complete with evaluation marked as skipped.

## Durable PostgreSQL and Redis setup

The repository includes a Docker Compose file for local infrastructure.

1. Copy the template and set the durable connection values in `.env.local`:

   ```dotenv
   DATABASE_URL=postgresql://slmarena:local-development-only@localhost:55432/slmarena
   REDIS_URL=redis://:local-development-only@localhost:6379
   ```

2. Start PostgreSQL and Redis:

   ```bash
   docker compose --env-file .env.local up -d
   ```

3. Set a stable application encryption key. A 32-byte hexadecimal key is
   recommended:

   ```bash
   openssl rand -hex 32
   ```

   Put the generated value in `APP_ENCRYPTION_KEY` in `.env.local`. Use the
   same key in every web and worker process; changing it makes previously
   encrypted evaluator credentials unreadable.

4. Apply the PostgreSQL schema. The migration script reads `DATABASE_URL` from
   the shell environment:

   ```bash
   export DATABASE_URL=postgresql://slmarena:local-development-only@localhost:55432/slmarena
   npm run db:migrate
   ```

5. Run the web process and the durable worker in separate terminals:

   ```bash
   npm run dev
   npm run worker
   ```

For a production-like process, build once and replace `npm run dev` with:

```bash
npm run build
npm start
```

The web process and worker must receive the same `DATABASE_URL`, `REDIS_URL`,
and `APP_ENCRYPTION_KEY`. The bundled Compose services bind to loopback by
default. Change `POSTGRES_PORT`, `POSTGRES_PASSWORD`, and `REDIS_PASSWORD` in
the environment when those defaults are not appropriate.

## Environment variables

All variables can be placed in `.env.local`. Next.js loads that file for the
web process, and the worker loads it when started from the project directory.

| Variable | Purpose | Default |
| --- | --- | --- |
| `OLLAMA_URL` | Default Ollama server used by the dashboard. | `http://localhost:11434` |
| `ALLOWED_OLLAMA_HOSTS` | Comma-separated host allowlist. Without it, only local/private hosts are accepted. | Empty |
| `EVALUATOR_BASE_URL` | Optional OpenAI-compatible evaluator base URL. | Empty |
| `EVALUATOR_MODEL` | Optional evaluator model name. | Empty |
| `EVALUATOR_API_KEY` | Optional evaluator key used as the initial default. | Empty |
| `APP_ENCRYPTION_KEY` | Stable key used for AES-256-GCM encryption of evaluator credentials. Required to persist a key. | Empty |
| `SQLITE_PATH` | SQLite database path when PostgreSQL is not configured. | `./slmarena.db` |
| `DATABASE_URL` | PostgreSQL connection string. Setting it selects PostgreSQL persistence. | Empty |
| `REDIS_URL` | Redis connection string. Setting it enables BullMQ and cross-process events. | Empty |
| `BENCHMARK_CONCURRENCY` | Maximum number of queued benchmark jobs processed by a worker or local queue. | `1` |
| `BENCHMARK_MODEL_CONCURRENCY` | Maximum number of model results executed concurrently within one benchmark. | `1` |
| `NEXT_ALLOWED_DEV_ORIGINS` | Comma-separated extra origins allowed by Next.js during development. | Empty |

`POSTGRES_PORT`, `POSTGRES_PASSWORD`, and `REDIS_PASSWORD` are used by the
bundled `docker-compose.yml` service definitions. Do not commit `.env.local` or
production secrets.

### Endpoint safety

Ollama endpoints cannot include credentials. By default, the application only
allows localhost, loopback, and private-network hosts. Set
`ALLOWED_OLLAMA_HOSTS` when the Ollama server is on another explicitly trusted
host. Evaluator endpoints must use HTTPS unless they point to a trusted local
host.

## Using the dashboard

### Build a scenario

1. Choose **New scenario (draft)** or load an existing saved scenario.
2. Enter a scenario name and system prompt.
3. Add one or more user turns. Multi-turn scenarios are evaluated in sequence
   for each selected model and sample.
4. Save the scenario when it should be reusable. Saved scenarios are locked;
   choose **Edit copy** to create a draft without changing the original.

### Run a comparison

1. Discover models from Ollama and select at least one.
2. Set **Samples per model** from 1 to 10. Each sample is stored separately,
   making repeated model behavior visible in the aggregated analysis.
3. Configure generation parameters in Settings: temperature, context size,
   top-p, repeat penalty, and maximum output tokens.
4. Start the benchmark. Responses and status changes arrive progressively over
   SSE while each model completes.

Every result can be expanded to inspect the full response, conversation turns,
run telemetry, automated evaluation, and human review controls. The comparison
panel groups samples by model and reports score distribution, average score,
Grammar, Compliance, and Accuracy averages, TTFT, throughput, and output-token
averages across runs with the same scenario. Use the model-group controls to
collapse noisy result lists while leaving these summary metrics in view.

### Review history

The Archive section supports keyword, date, model, and score filters. Select a
completed result to mark it **Approved**, **Rejected**, or **Reviewed**, and add
notes for the final decision. Deleting a sample removes it from the current run
and persisted results.

## HTTP API overview

The dashboard uses these server routes:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET`, `PATCH` | `/api/settings` | Read or persist application settings. |
| `GET`, `POST` | `/api/scenarios` | List or create reusable scenarios. |
| `PATCH`, `DELETE` | `/api/scenarios/:id` | Update or remove a scenario. |
| `GET`, `POST` | `/api/runs` | Filter history or enqueue a benchmark. |
| `GET` | `/api/runs/:id` | Read a run snapshot. |
| `GET` | `/api/runs/:id/events` | Stream run snapshots through SSE. |
| `POST` | `/api/runs/:id/pause` | Pause a pending or active run. |
| `POST` | `/api/runs/:id/resume` | Resume a paused run. |
| `POST` | `/api/runs/:id/cancel` | Cancel a pending or active run. |
| `DELETE` | `/api/runs/:id/results/:resultId` | Delete one model sample. |
| `GET` | `/api/ollama/models` | Discover models from Ollama. |
| `GET` | `/api/analysis` | Aggregate results for a scenario. |
| `PATCH` | `/api/results/:id/review` | Store human review status and notes. |

Request bodies are validated with Zod schemas. Ollama and evaluator calls are
made server-side, so provider credentials are not exposed to the browser.

## Persistence and data model

The schema stores:

- scenarios and their prompt/conversation definitions;
- test runs, selected models, samples, generation parameters, and lifecycle
  state;
- per-model results and per-turn response telemetry;
- automated evaluations, including the raw structured evaluator payload; and
- human review status and notes.

SQLite is convenient for one local process. PostgreSQL is the durable option for
separate web and worker processes. The PostgreSQL schema lives in
[`db/schema.sql`](db/schema.sql), while the SQLite schema is initialized and
migrated by [`src/lib/sqlite-db.ts`](src/lib/sqlite-db.ts). Local database files
are ignored by Git.

## Project layout

```text
src/app/                       Next.js layout, page, styles, and API routes
src/components/                Client-side benchmark dashboard
src/lib/contracts.ts           Shared validation schemas and domain types
src/lib/benchmark-queue.ts     Local and BullMQ benchmark execution
src/lib/benchmark-store.ts     In-memory run state and persistence coordination
src/lib/ollama-client.ts       Streaming Ollama client and telemetry extraction
src/lib/frontier-evaluator.ts  OpenAI-compatible structured evaluation
src/lib/database.ts            SQLite/PostgreSQL persistence and aggregation
src/worker.ts                  Durable BullMQ worker entry point
db/schema.sql                  PostgreSQL schema and migrations
e2e/                           Playwright dashboard coverage
integration/                   PostgreSQL and Redis connectivity tests
```

## Development commands

```bash
npm run dev                 # Start the Next.js development server
npm run build               # Create a production build
npm start                   # Serve the production build
npm run worker              # Start the durable BullMQ worker
npm run db:migrate          # Apply db/schema.sql using DATABASE_URL
npm run lint                # Run ESLint
npm run typecheck           # Run TypeScript without emitting files
npm test                    # Run unit and library tests
npm run test:integration    # Check PostgreSQL and Redis when configured
npm run test:e2e            # Build and run Playwright tests
npm run test:e2e:dev        # Run Playwright against a development server
```

The integration suite is skipped when `DATABASE_URL` or `REDIS_URL` is not
configured. Before running E2E tests locally, install Chromium once:

```bash
npx playwright install chromium
```

The standard E2E suite builds and starts the application on a test port. The
development E2E suite verifies client hydration against a development server;
its provider calls are mocked by the tests.
