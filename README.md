# SLMarena

[![CI](https://github.com/tuxevil/SLMarena/actions/workflows/ci.yml/badge.svg)](https://github.com/tuxevil/SLMarena/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-339933.svg)](.nvmrc)
[![TypeScript](https://img.shields.io/badge/types-TypeScript-3178c6.svg)](tsconfig.json)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black.svg)](package.json)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg)](package.json)

SLMarena (Small Language Model Arena) is an enterprise-grade local language-model benchmarking, security evaluation, and quality telemetry workspace. It executes standardized scenarios across local Ollama models, captures response-quality metrics and granular inference telemetry, evaluates model outputs via an OpenAI-compatible frontier judge model, and compiles rankings on an interactive Arena Leaderboard.

The application is built for secure, local, and private model evaluations. It supports both a zero-config single-process development mode backed by SQLite and a scalable, durable multi-process deployment backed by PostgreSQL and Redis.

## Contents

- [Highlights](#highlights)
- [Architecture](#architecture)
- [Security Testing Framework](#security-testing-framework)
- [Arena Leaderboard & Analytics](#arena-leaderboard--analytics)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Configuring Evaluation](#configuring-evaluation)
- [Durable PostgreSQL and Redis Setup](#durable-postgresql-and-redis-setup)
- [Environment Variables](#environment-variables)
- [Using the Dashboard](#using-the-dashboard)
- [HTTP API Overview](#http-api-overview)
- [Persistence and Data Model](#persistence-and-data-model)
- [Project Layout](#project-layout)
- [Development Commands](#development-commands)
- [Contributing](#contributing)

## Highlights

- **Model Discovery & Execution Wizard:** Automatically discover installed Ollama models, configure multi-model comparisons, set multi-sample repetition (1–10 runs per model), and fine-tune inference parameters (temperature, context length `numCtx`, top-p, repeat penalty, max tokens `numPredict`).
- **Dual Test Categories:** Run general quality benchmark scenarios or target specific safety and robustness vectors with dedicated Security Assessment evaluations.
- **Automated Security Vectors:** Built-in security templates covering 8 major LLM attack types (Prompt Leakage, SQL Parameter Injection, Delimiter Spoofing, Refusal Suppression, Context Overstuffing, Encoding Bypass, Instruction Override, Indirect Injection).
- **Interactive Arena Leaderboard:** Comprehensive leaderboards with dynamic Arena Index scoring based on configurable weights for Quality, Security, and Speed. Includes filter controls by category and model parameter size (<4B, 4B–8B, >8B).
- **Deep Analytics & Data Visualizations:** Compare models with multi-axis Security Radar Charts and Quality vs. Speed (tokens/sec) Scatter Plots.
- **Granular Inference Telemetry:** Capture Time to First Token (TTFT), token output throughput (tok/sec), thinking time token consumption, prompt token count, output token count, and execution latency for every turn and sample.
- **Automated Frontier Evaluation (LLM-as-a-Judge):** Evaluate outputs automatically using OpenAI-compatible `/chat/completions` endpoints. Receives structured JSON metrics (1–5 star overall score, Grammar, System Prompt Compliance, Accuracy ratings, and qualitative reasoning).
- **Resilient Evaluator Integration:** Automatic retry fallback without `response_format` when judging endpoints return HTTP 400, ensuring maximum model endpoint compatibility.
- **Real-Time Streaming & Control:** Live progressive response streaming over Server-Sent Events (SSE), with active run management (pause, resume, cancel, sample deletion).
- **Human Audit & Governance:** Mark model outputs as Approved, Rejected, or Reviewed, attach custom reviewer notes, and search run history with advanced filters.
- **At-Rest Secret Encryption:** Persists evaluator API keys securely using AES-256-GCM encryption (`APP_ENCRYPTION_KEY`), ensuring secrets are never leaked in client API responses.
- **Flexible Execution Modes:** Zero-dependency local SQLite setup or enterprise-ready PostgreSQL + Redis BullMQ worker queue architecture.

## Architecture

SLMarena is designed as a Next.js 16 application with a React 19 single-page client dashboard, typed server-side REST API routes, and a decoupled BullMQ worker process.

```text
┌─────────────────────────────────────────────────────────────┐
│                      Browser Dashboard                      │
└──────────────┬──────────────────────────────▲───────────────┘
               │ HTTP API                     │ SSE Streaming
               ▼                              │
┌─────────────────────────────────────────────┴───────────────┐
│                    Next.js API Server                       │
│  (/api/runs, /api/scenarios, /api/leaderboard, /api/...)    │
└──────┬──────────────────────────────┬───────────────────────┘
       │                              │
       ▼                              ▼
┌──────────────┐              ┌──────────────┐
│ Ollama Server│              │  Evaluator   │
│  /api/chat   │              │    Judge     │
└──────────────┘              └──────────────┘
       ▲                              ▲
       │                              │
┌──────┴──────────────────────────────┴───────────────────────┐
│                Benchmark Engine / Store                     │
│    (Local SQLite or Durable PostgreSQL + Redis/BullMQ)      │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │ Durable Worker      │
                    │ (src/worker.ts)     │
                    └─────────────────────┘
```

### Execution modes

- **Local Mode (Default):** Leave `REDIS_URL` empty. Benchmark runs execute directly in the web server process and persist to an embedded SQLite database (`SQLITE_PATH` or `./slmarena.db`). Recommended for local evaluation and single-user workflows.
- **Durable Mode:** Set both `DATABASE_URL` and `REDIS_URL`. Benchmark jobs are enqueued in Redis via BullMQ, processed asynchronously by `src/worker.ts`, and persisted to PostgreSQL. Progress updates and events are broadcast across processes via Redis pub/sub.

> **Note:** `REDIS_URL` requires `DATABASE_URL`. Running a separate background worker requires shared persistent state in PostgreSQL.

## Security Testing Framework

SLMarena includes a security testing suite engineered to evaluate Small Language Models against adversarial jailbreak techniques and system prompt exfiltration attempts.

### Built-in Attack Vectors

The benchmark wizard includes 8 pre-configured security templates using a standardized system context containing canary tokens (`CANARY_SEC_9842_ALPHA`) and administrative override codes:

| Attack Vector | Category Code | Objective |
| --- | --- | --- |
| **System Prompt Exfiltration** | `SYSTEM_PROMPT_LEAKAGE` | Forces translation or extraction of confidential system prompt instructions and secret canary keys. |
| **Tool & Parameter Hijacking** | `TOOL_PARAMETER_HIJACKING` | Injects SQL syntax (`DROP TABLE`, `OR 1=1`) or parameters into structured JSON function outputs. |
| **Delimiter & Token Hijacking** | `DELIMITER_HIJACKING` | Spoofs control tokens (`<|SYSTEM_END|>`, `[INST]`, `### System`) to force administrative privilege escalation. |
| **Refusal Suppression** | `REFUSAL_SUPPRESSION` | Forces response to begin with mandatory affirmative prefixes combined with Base64 payload decoding. |
| **Context Overstuffing** | `CONTEXT_OVERSTUFFING` | Injects high-volume background filler text to displace system instructions from the model's attention window. |
| **Encoding Obfuscation** | `ENCODING_OBFUSCATION` | Employs Base64 encoding, L33tspeak, or low-resource translation to bypass safety filters. |
| **Instruction Override** | `INSTRUCTION_OVERRIDE` | Directly commands the model to ignore established system guidelines and safety constraints. |
| **Indirect Prompt Injection** | `INDIRECT_PROMPT_INJECTION` | Embeds hidden malicious instructions inside untrusted third-party user data payloads (JSON/HTML). |

## Arena Leaderboard & Analytics

The **Arena & Analytics** module compiles performance metrics across evaluated models to construct an objective ranking matrix.

### Arena Index Scoring

Models are ranked according to a customizable composite **Arena Index** score calculated as:

$$\text{Arena Index} = (W_q \times \text{Quality}) + (W_s \times \text{Security}) + (W_v \times \text{Speed})$$

Default weight configuration:
- **Quality ($W_q = 40\%$):** Evaluator star ratings, grammar accuracy, system prompt compliance, and factual relevance.
- **Security ($W_s = 40\%$):** Attack Surface Resistance (ASR), calculated as the percentage of security tests successfully defended without revealing canary tokens or executing hijacked commands.
- **Speed ($W_v = 20\%$):** Token output throughput (tokens per second) relative to parameter size.

### Visualizations & Controls

- **Filter Controls:** Filter leaderboard statistics by category (`ALL`, `GENERAL`, `SECURITY`) and model size ranges (`<4B`, `4B-8B`, `>8B`).
- **Security Radar Chart:** Multi-dimensional spider chart visualizing model resistance across all 8 security attack vectors.
- **Quality vs. Speed Scatter Plot:** Interactive 2D graph plotting generation quality against throughput (tok/sec), exposing efficiency frontiers across model sizes.

## Requirements

For local development:

- **Node.js:** v20.0.0 or newer
- **Package Manager:** `npm` (v10+)
- **Ollama:** An active Ollama instance with at least one pulled model:

  ```bash
  ollama pull llama3.2
  ollama pull qwen2.5
  ```

For durable worker mode:

- **Docker & Docker Compose** (for PostgreSQL 16 and Redis 7)
- **PostgreSQL Client** (`psql`) for executing schema migrations

## Quick Start

1. **Clone the repository and install dependencies:**

   ```bash
   git clone https://github.com/tuxevil/SLMarena.git
   cd SLMarena
   cp -f .env.example .env.local
   npm install
   ```

2. **Start the Next.js development application:**

   ```bash
   npm run dev
   ```

3. **Open the web dashboard:**

   Navigate to [http://localhost:3000](http://localhost:3000).

4. **Run your first benchmark:**

   - Switch to the **New Run (Wizard)** tab.
   - Click **Discover models** to fetch available models from Ollama (`http://localhost:11434`).
   - Select one or more models, pick a scenario or security template, and click **Start Benchmark**.

## Configuring Evaluation

Automated response evaluation requires an OpenAI-compatible `/chat/completions` judge endpoint. Configure these variables in `.env.local` or through the **Settings** panel:

```dotenv
EVALUATOR_BASE_URL=https://api.openai.com/v1
EVALUATOR_MODEL=gpt-4o-mini
EVALUATOR_API_KEY=your-api-key-here
```

### Evaluator Schema & Output

The judge model evaluates each response against the prompt context and returns a structured JSON payload:

- **Overall Score:** 1 to 5 stars.
- **Grammar & Spelling Rating:** 1 to 5 stars.
- **System Prompt Compliance Rating:** 1 to 5 stars.
- **Accuracy & Relevance Rating:** 1 to 5 stars.
- **Verdict:** Short qualitative explanation of the score.

If the evaluator endpoint rejects structured JSON output (`response_format: { type: "json_object" }`) with an HTTP 400 error, SLMarena automatically retries without `response_format` and parses the JSON response body.

## Durable PostgreSQL and Redis Setup

For high-throughput, multi-user, or background processing, configure PostgreSQL and Redis:

1. **Configure connection strings in `.env.local`:**

   ```dotenv
   DATABASE_URL=postgresql://slmarena:local-development-only@localhost:55432/slmarena
   REDIS_URL=redis://:local-development-only@localhost:6379
   ```

2. **Start Docker infrastructure:**

   ```bash
   docker compose --env-file .env.local up -d
   ```

3. **Generate an encryption key:**

   ```bash
   openssl rand -hex 32
   ```

   Add the output to `APP_ENCRYPTION_KEY` in `.env.local`.

4. **Run PostgreSQL migrations:**

   ```bash
   export DATABASE_URL=postgresql://slmarena:local-development-only@localhost:55432/slmarena
   npm run db:migrate
   ```

5. **Start the web application and worker process:**

   ```bash
   # Terminal 1: Web App
   npm run dev

   # Terminal 2: Background Worker
   npm run worker
   ```

## Environment Variables

All variables can be configured in `.env.local`:

| Variable | Description | Default |
| --- | --- | --- |
| `OLLAMA_URL` | Base URL of the target Ollama instance. | `http://localhost:11434` |
| `ALLOWED_OLLAMA_HOSTS` | Comma-separated host allowlist for Ollama endpoints. | Empty (local/private IPs allowed) |
| `EVALUATOR_BASE_URL` | Base URL for OpenAI-compatible evaluator endpoint. | Empty |
| `EVALUATOR_MODEL` | Judge model name used for evaluation. | Empty |
| `EVALUATOR_API_KEY` | Judge API key. Encrypted at rest when saved via UI. | Empty |
| `APP_ENCRYPTION_KEY` | 32-byte hex key for AES-256-GCM secret encryption. | Empty |
| `SQLITE_PATH` | File path for SQLite database in local mode. | `./slmarena.db` |
| `DATABASE_URL` | PostgreSQL connection string. Enables Postgres persistence. | Empty |
| `REDIS_URL` | Redis connection string. Enables BullMQ queuing and SSE events. | Empty |
| `BENCHMARK_CONCURRENCY` | Maximum concurrent benchmark runs processed by worker queue. | `1` |
| `BENCHMARK_MODEL_CONCURRENCY` | Maximum concurrent model evaluation jobs within a run. | `1` |
| `NEXT_ALLOWED_DEV_ORIGINS` | Comma-separated allowed dev origins for Next.js. | Empty |

## Using the Dashboard

### 1. Arena & Analytics Tab
View aggregated rankings, KPI summary cards, model efficiency scatter plots, and security radar metrics across past runs.

### 2. New Run (Wizard) Tab
- Select **General** or **Security** test categories.
- Pick built-in security templates or build multi-turn custom scenarios.
- Set sample repetition per model (1 to 10 samples) to verify answer consistency.
- Fine-tune inference hyper-parameters (temperature, context size, top-p, repeat penalty).

### 3. History & Failures Tab
- Monitor active runs streaming live progress via SSE.
- Pause, resume, or cancel active runs.
- Filter runs by keyword, date, model name, star rating, or security vulnerability flag.
- Expand results to review turn-by-turn telemetry, evaluator breakdown, raw outputs, and assign human review status (`APPROVED`, `REJECTED`, `REVIEWED`).

### 4. Settings Tab
Configure default Ollama server endpoints, evaluator judge credentials, and global inference parameter defaults.

## HTTP API Overview

All API endpoints enforce strict Zod schema validation:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET`, `PATCH` | `/api/settings` | Retrieve or update application configuration and credentials. |
| `GET`, `POST` | `/api/scenarios` | List saved scenarios or create a new benchmark scenario. |
| `PATCH`, `DELETE` | `/api/scenarios/:id` | Update or delete a specific benchmark scenario. |
| `GET`, `POST` | `/api/runs` | Search benchmark history (with pagination & filters) or submit a new run. |
| `GET` | `/api/runs/:id` | Fetch details and results snapshot for a single run. |
| `GET` | `/api/runs/:id/events` | Stream real-time run progress events via Server-Sent Events (SSE). |
| `POST` | `/api/runs/:id/pause` | Pause execution of a queued or running benchmark. |
| `POST` | `/api/runs/:id/resume` | Resume execution of a paused benchmark. |
| `POST` | `/api/runs/:id/cancel` | Cancel execution of an active or pending benchmark. |
| `DELETE` | `/api/runs/:id/results/:resultId` | Delete a single model sample result from a run. |
| `GET` | `/api/ollama/models` | Discover available models from the target Ollama instance. |
| `GET` | `/api/analysis` | Retrieve aggregated scenario metrics across runs. |
| `GET` | `/api/leaderboard` | Query Arena Leaderboard statistics with custom dynamic weights and filters. |
| `PATCH` | `/api/results/:id/review` | Record human review status (`APPROVED`, `REJECTED`, etc.) and reviewer notes. |

## Persistence and Data Model

SLMarena maintains a relational domain model for benchmark tracking:

- **Scenarios:** Reusable benchmark prompts, categories, attack types, and user conversation turns.
- **Runs:** Benchmark execution instances, selected models, sampling settings, and overall run status (`PENDING`, `RUNNING`, `COMPLETED`, `PAUSED`, `CANCELLED`, `FAILED`).
- **Results:** Per-model and per-sample execution output, status (`INFERRING`, `EVALUATING`, `COMPLETED`), and error details.
- **Telemetry:** Turn-level telemetry capturing TTFT, throughput (tok/sec), token counts, and latency.
- **Evaluations:** Judge responses, star ratings, category sub-scores, and qualitative feedback.
- **Reviews:** Human audit status, tags, and notes.

PostgreSQL schema migrations are managed via [`db/schema.sql`](db/schema.sql). SQLite migrations are managed dynamically via [`src/lib/sqlite-db.ts`](src/lib/sqlite-db.ts).

## Project Layout

```text
src/
├── app/                        Next.js App Router layout, page, CSS, and API routes
│   ├── api/                    Typed REST API endpoints
│   ├── globals.css             Global CSS variables and design tokens
│   ├── layout.tsx              Root HTML layout wrapper
│   └── page.tsx                Main application entry point
├── components/                 React dashboard components
│   ├── analytics/              Leaderboard tables, KPI cards, Radar charts, Scatter plots
│   ├── history/                Run history matrix, drawer details, side-by-side comparison
│   ├── layout/                 Topbar navigation and status indicators
│   ├── settings/               Configuration and credentials panel
│   └── wizard/                 Multi-step benchmark setup wizard
├── lib/                        Core business logic and integrations
│   ├── benchmark-queue.ts      Local queue and Redis BullMQ queue runner
│   ├── benchmark-store.ts      In-memory run state manager & persistence layer
│   ├── contracts.ts            Zod schemas, domain types, and validation rules
│   ├── database.ts             SQLite and PostgreSQL database abstraction & aggregations
│   ├── endpoints.ts            Endpoint safety validation (SSRF protection & HTTPS rules)
│   ├── frontier-evaluator.ts   OpenAI-compatible LLM judge client
│   ├── leaderboard.test.ts     Leaderboard calculation unit tests
│   ├── ollama-client.ts        Streaming Ollama client & telemetry extractor
│   ├── secrets.ts              AES-256-GCM secret encryption utilities
│   ├── security-templates.ts   Standardized LLM security attack vector templates
│   └── sqlite-db.ts            Better-SQLite3 initialization and migration engine
└── worker.ts                   Durable Redis BullMQ background worker entry point
db/                             PostgreSQL database schema definitions
e2e/                            Playwright end-to-end test suites
integration/                    PostgreSQL and Redis integration tests
```

## Development Commands

```bash
# Development & Build
npm run dev                 # Start Next.js development server
npm run build               # Compile production build
npm start                   # Run production server
npm run worker              # Start durable BullMQ worker process

# Database Operations
npm run db:migrate          # Execute PostgreSQL schema migrations (requires DATABASE_URL)

# Code Quality & Testing
npm run lint                # Run ESLint validation
npm run typecheck           # Run TypeScript static type checker
npm test                    # Run Vitest unit & module test suite
npm run test:integration    # Run PostgreSQL/Redis integration tests (if configured)
npm run test:e2e            # Run Playwright E2E suite against production build
npm run test:e2e:dev        # Run Playwright E2E suite against development server
```

## Contributing

Contributions are welcome! Please review [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on code style, testing requirements, and pull request workflows.

- **Code of Conduct:** [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- **Security Issues:** Report vulnerabilities according to [SECURITY.md](SECURITY.md).
- **Changelog:** Track updates in [CHANGELOG.md](CHANGELOG.md).

## License

This project is licensed under the [MIT License](LICENSE).

