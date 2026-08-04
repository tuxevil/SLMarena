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

### Changed

- Project renamed from "Compare SLM" to **SLMarena**; repository moved to
  `https://github.com/tuxevil/SLMarena`.

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
