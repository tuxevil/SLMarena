# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Per-model telemetry averages (output tokens, TTFT, tokens/sec, total time) in
  the model group summary cards.
- Horizontal layout for the model score summary: average/range, ratings, and
  telemetry side by side.
- Professional repository metadata: MIT license, governance documents
  (CONTRIBUTING, SECURITY, CODE_OF_CONDUCT), issue and PR templates,
  `.editorconfig`, and `.nvmrc`.
- MCP server (`npm run mcp`, PRD v2.1): Streamable HTTP transport exposing the
  SLMarena REST API as 20 tools (`get_arena_leaderboard`, `list_ollama_models`,
  `get_model_profile`, `list_test_scenarios`, `get_test_scenario`,
  `create_test_scenario`, `update_test_scenario`, `delete_test_scenario`,
  `list_runs`, `pause_run`, `resume_run`, `cancel_run`, `get_settings`,
  `update_settings`, `get_analysis`, `review_result`, `get_run_result_details`,
  `get_test_run_details`, `launch_matrix_test`, `check_job_status`) plus
  read-only resources (`slmarena://leaderboard`, `slmarena://scenarios`) for
  agent-driven benchmarking. Configured via `MCP_PORT` and `APP_URL`.
- `GET /api/runs/:id/results/:resultId` endpoint for fetching a single model
  result directly.

### Changed

- Project renamed from "Compare SLM" to **SLMarena**; repository moved to
  `https://github.com/tuxevil/SLMarena`.
- `OLLAMA_URL` documented as unset-by-default in `.env.example`: leaving it
  empty lets `/api/ollama/models` resolve the Ollama URL saved in the app
  settings instead of shadowing it with a stale local default.
- Public snapshot export (`scripts/export-public-snapshot.ts`) now mirrors the
  internal leaderboard: Overall Rating, Grammar, Compliance and Accuracy
  average **all** evaluations (not only GENERAL), and security attacks include
  the GENERAL bucket, so landing metrics match the internal Arena Leaderboard.

## [0.1.0] - 2026-08-03

### Added

- MVP benchmark workspace: Ollama streaming and telemetry, local and
  Redis/BullMQ queues, SQLite and PostgreSQL persistence, OpenAI-compatible
  evaluator with structured JSON output, SSE live updates, dashboard with
  scenario library and history, encrypted evaluator credentials.
- Quality gates: ESLint, TypeScript, unit tests, integration tests, Playwright
  E2E, and a GitHub Actions CI workflow.

[Unreleased]: https://github.com/tuxevil/SLMarena/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/tuxevil/SLMarena/releases/tag/v0.1.0
