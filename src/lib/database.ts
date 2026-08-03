import postgres, { type TransactionSql } from "postgres";
import type {
  EvaluatorConfig,
  AppSettings,
  ModelResult,
  PromptTemplate,
  TestRun,
  TestSuite,
  TurnResult,
} from "@/lib/contracts";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import {
  sqliteDeletePrompt,
  sqliteDeleteSuite,
  sqliteLoadSettings,
  sqliteLoadState,
  sqlitePersistHumanReview,
  sqlitePersistPrompt,
  sqlitePersistRun,
  sqlitePersistSettings,
  sqlitePersistSuite,
} from "@/lib/sqlite-db";

export type RunPersistenceConfig = {
  ollamaUrl: string;
  evaluator?: EvaluatorConfig;
};

export type PersistedSettings = AppSettings & {
  evaluatorApiKey: string | null;
};

type PersistedRun = {
  run: TestRun;
  config: RunPersistenceConfig;
};

export type DatabaseState = {
  runs: PersistedRun[];
  prompts: PromptTemplate[];
  suites: TestSuite[];
};

type SqlClient = ReturnType<typeof postgres>;

let client: SqlClient | null | undefined;
const persistenceChains = new Map<string, Promise<void>>();

export function isPostgres() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function hasDatabase() {
  return true;
}

export function queuePersistedRun(run: TestRun, eventType: string, config: RunPersistenceConfig) {
  if (eventType === "model.token") return;
  const previous = persistenceChains.get(run.id) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => persistRun(run, config))
    .finally(() => {
      if (persistenceChains.get(run.id) === next) persistenceChains.delete(run.id);
    });
  persistenceChains.set(run.id, next);
  void next.catch(reportPersistenceError);
}

export async function waitForPersistedRun(id: string) {
  await persistenceChains.get(id);
}

export async function persistPrompt(prompt: PromptTemplate) {
  if (!isPostgres()) {
    sqlitePersistPrompt(prompt);
    return;
  }
  await getClient()!`
    INSERT INTO prompt_templates (id, title, system_prompt, tags, created_at, updated_at)
    VALUES (${prompt.id}, ${prompt.title}, ${prompt.systemPrompt}, ${prompt.tags}, ${new Date(prompt.createdAt)}, ${new Date(prompt.updatedAt)})
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title,
      system_prompt = EXCLUDED.system_prompt,
      tags = EXCLUDED.tags,
      updated_at = EXCLUDED.updated_at
  `;
}

export async function deletePersistedPrompt(id: string) {
  if (!isPostgres()) {
    sqliteDeletePrompt(id);
    return;
  }
  await getClient()!`DELETE FROM prompt_templates WHERE id = ${id}`;
}

export async function persistSuite(suite: TestSuite) {
  if (!isPostgres()) {
    sqlitePersistSuite(suite);
    return;
  }
  await getClient()!`
    INSERT INTO test_suites (id, name, description, system_prompt_id, user_messages, tags, created_at, updated_at)
    VALUES (${suite.id}, ${suite.name}, ${suite.description}, ${suite.promptTemplateId}, ${JSON.stringify(suite.userMessages)}::jsonb, ${suite.tags}, ${new Date(suite.createdAt)}, ${new Date(suite.updatedAt)})
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      system_prompt_id = EXCLUDED.system_prompt_id,
      user_messages = EXCLUDED.user_messages,
      tags = EXCLUDED.tags,
      updated_at = EXCLUDED.updated_at
  `;
}

export async function deletePersistedSuite(id: string) {
  if (!isPostgres()) {
    sqliteDeleteSuite(id);
    return;
  }
  await getClient()!`DELETE FROM test_suites WHERE id = ${id}`;
}

export async function persistHumanReview(resultId: string, status: string, notes: string) {
  if (!isPostgres()) {
    sqlitePersistHumanReview(resultId, status, notes);
    return;
  }
  await getClient()!`
    UPDATE model_results
    SET human_status = ${status}, human_notes = ${notes}
    WHERE id = ${resultId}
  `;
}

export async function loadPersistedSettings(): Promise<PersistedSettings | null> {
  if (!isPostgres()) {
    return sqliteLoadSettings();
  }
  const rows = await getClient()!`
    SELECT ollama_url, evaluator_base_url, evaluator_model, evaluator_api_key_encrypted, parameters_json
    FROM app_settings
    WHERE id = 1
  `;
  const row = rows[0];
  if (!row) return null;
  const encrypted = row.evaluator_api_key_encrypted ? String(row.evaluator_api_key_encrypted) : null;
  let apiKey: string | null = null;
  if (encrypted) {
    try {
      apiKey = decryptSecret(encrypted);
    } catch (error) {
      console.error("[compare] [Settings] Could not decrypt evaluator credentials:", error instanceof Error ? error.message : String(error));
    }
  }
  const params = parsePersistedParameters(row.parameters_json);
  return {
    ollamaUrl: String(row.ollama_url),
    evaluatorBaseUrl: String(row.evaluator_base_url ?? ""),
    evaluatorModel: String(row.evaluator_model ?? ""),
    evaluatorApiKeyConfigured: Boolean(encrypted),
    evaluatorApiKey: apiKey,
    parameters: params,
  };
}

function parsePersistedParameters(raw: unknown): import("@/lib/contracts").BenchmarkParameters {
  const defaults = { temperature: 0.2, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 4096 };
  if (!raw) return defaults;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return {
      temperature: Number(parsed.temperature ?? defaults.temperature),
      numCtx: Number(parsed.numCtx ?? defaults.numCtx),
      topP: Number(parsed.topP ?? defaults.topP),
      repeatPenalty: Number(parsed.repeatPenalty ?? defaults.repeatPenalty),
      numPredict: Number(parsed.numPredict ?? defaults.numPredict),
    };
  } catch {
    return defaults;
  }
}

export async function persistSettings(settings: {
  ollamaUrl: string;
  evaluatorBaseUrl: string;
  evaluatorModel: string;
  evaluatorApiKey: string | null;
  parameters: import("@/lib/contracts").BenchmarkParameters;
}) {
  if (!isPostgres()) {
    sqlitePersistSettings(settings);
    return;
  }
  const encrypted = settings.evaluatorApiKey ? encryptSecret(settings.evaluatorApiKey) : null;
  await getClient()!`
    INSERT INTO app_settings (id, ollama_url, evaluator_base_url, evaluator_model, evaluator_api_key_encrypted, parameters_json, updated_at)
    VALUES (1, ${settings.ollamaUrl}, ${settings.evaluatorBaseUrl || null}, ${settings.evaluatorModel || null}, ${encrypted}, ${JSON.stringify(settings.parameters)}::jsonb, CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO UPDATE SET
      ollama_url = EXCLUDED.ollama_url,
      evaluator_base_url = EXCLUDED.evaluator_base_url,
      evaluator_model = EXCLUDED.evaluator_model,
      evaluator_api_key_encrypted = EXCLUDED.evaluator_api_key_encrypted,
      parameters_json = EXCLUDED.parameters_json,
      updated_at = EXCLUDED.updated_at
  `;
}

export async function loadPersistedState(runId?: string): Promise<DatabaseState | null> {
  if (!isPostgres()) {
    return sqliteLoadState(runId);
  }
  const sql = getClient()!;
  const emptyRows = Promise.resolve([] as Array<Record<string, unknown>>);

  try {
    const [runRows, resultRows, turnRows, evaluationRows, promptRows, suiteRows] = await sql.begin(async (transaction) => Promise.all([
      runId
        ? transaction`SELECT id, status, paused, control_version, system_prompt, ollama_url, user_messages, selected_models, parameters, evaluator_config, created_at, started_at, finished_at, error_message FROM test_runs WHERE id = ${runId}`
        : transaction`SELECT id, status, paused, control_version, system_prompt, ollama_url, user_messages, selected_models, parameters, evaluator_config, created_at, started_at, finished_at, error_message FROM test_runs ORDER BY created_at DESC`,
      runId
        ? transaction`SELECT id, test_run_id, model_name, status, eval_status, response_text, input_tokens, output_tokens, ttft_ms, tok_per_sec, total_duration_ms, error_message, human_status, human_notes FROM model_results WHERE test_run_id = ${runId}`
        : transaction`SELECT id, test_run_id, model_name, status, eval_status, response_text, input_tokens, output_tokens, ttft_ms, tok_per_sec, total_duration_ms, error_message, human_status, human_notes FROM model_results`,
      runId
        ? transaction`SELECT id, model_result_id, step_order, user_message, response_text, thinking, input_tokens, output_tokens, ttft_ms, tok_per_sec, total_duration_ms FROM model_result_turns WHERE model_result_id IN (SELECT id FROM model_results WHERE test_run_id = ${runId}) ORDER BY step_order ASC`
        : transaction`SELECT id, model_result_id, step_order, user_message, response_text, thinking, input_tokens, output_tokens, ttft_ms, tok_per_sec, total_duration_ms FROM model_result_turns ORDER BY step_order ASC`,
      runId
        ? transaction`SELECT model_result_id, evaluator_model, grammar_rating, compliance_rating, accuracy_rating, score_stars, grammar_analysis, compliance_analysis, accuracy_analysis, feedback_text, evaluator_raw_json FROM evaluations WHERE model_result_id IN (SELECT id FROM model_results WHERE test_run_id = ${runId})`
        : transaction`SELECT model_result_id, evaluator_model, grammar_rating, compliance_rating, accuracy_rating, score_stars, grammar_analysis, compliance_analysis, accuracy_analysis, feedback_text, evaluator_raw_json FROM evaluations`,
      runId ? emptyRows : transaction`SELECT id, title, system_prompt, tags, created_at, updated_at FROM prompt_templates ORDER BY updated_at DESC`,
      runId ? emptyRows : transaction`SELECT id, name, description, system_prompt_id, user_messages, tags, created_at, updated_at FROM test_suites ORDER BY updated_at DESC`,
    ]));

    const turnsByResult = groupTurns(turnRows);
    const evaluationsByResult = new Map(evaluationRows.map((row) => [String(row.model_result_id), row]));
    const resultsByRun = new Map<string, ModelResult[]>();

    for (const row of resultRows) {
      const result = restoreResult(row, turnsByResult.get(String(row.id)) ?? [], evaluationsByResult.get(String(row.id)));
      const results = resultsByRun.get(String(row.test_run_id)) ?? [];
      results.push(result);
      resultsByRun.set(String(row.test_run_id), results);
    }

    return {
      runs: runRows.map((row) => restoreRun(row, resultsByRun.get(String(row.id)) ?? [])),
      prompts: promptRows.map(restorePrompt),
      suites: suiteRows.map(restoreSuite),
    };
  } catch (error) {
    reportPersistenceError(error);
    throw error;
  }
}

export async function listPersistedHistory(filters: {
  keyword: string;
  date: string;
  model: string;
  score?: number;
  timezoneOffset: number;
  page: number;
  pageSize: number;
}) {
  if (!isPostgres()) {
    const state = sqliteLoadState();
    let runs = state.runs.map((r) => r.run);
    if (filters.keyword) {
      const kw = filters.keyword.toLowerCase();
      runs = runs.filter(
        (r) =>
          r.systemPrompt.toLowerCase().includes(kw) ||
          r.userMessages.some((m) => m.toLowerCase().includes(kw)) ||
          r.results.some((res) => (res.responseText || "").toLowerCase().includes(kw)),
      );
    }
    if (filters.model) {
      runs = runs.filter((r) => r.results.some((res) => res.modelName === filters.model));
    }
    if (filters.score !== undefined) {
      runs = runs.filter((r) => r.results.some((res) => res.evaluation?.scoreStars === filters.score));
    }
    if (filters.date) {
      runs = runs.filter((r) => {
        const runDate = new Date(new Date(r.createdAt).getTime() - filters.timezoneOffset * 60_000).toISOString().slice(0, 10);
        return runDate === filters.date;
      });
    }
    const total = runs.length;
    const start = (filters.page - 1) * filters.pageSize;
    const paginated = runs.slice(start, start + filters.pageSize);
    return {
      runs: paginated,
      total,
      page: filters.page,
      pageSize: filters.pageSize,
    };
  }
  const sql = getClient()!;
  const score = filters.score ?? null;
  const where = sql`
    WHERE (${filters.keyword} = '' OR test_runs.system_prompt ILIKE '%' || ${filters.keyword} || '%'
      OR test_runs.user_messages::text ILIKE '%' || ${filters.keyword} || '%'
      OR EXISTS (
        SELECT 1 FROM model_results keyword_results
        WHERE keyword_results.test_run_id = test_runs.id
          AND keyword_results.response_text ILIKE '%' || ${filters.keyword} || '%'
      ))
      AND (${filters.date} = '' OR (
        test_runs.created_at >= (NULLIF(${filters.date}, '')::date - ${filters.timezoneOffset} * interval '1 minute')
        AND test_runs.created_at < (NULLIF(${filters.date}, '')::date - ${filters.timezoneOffset} * interval '1 minute' + interval '1 day')
      ))
      AND (${filters.model} = '' OR EXISTS (
        SELECT 1 FROM model_results model_filter
        WHERE model_filter.test_run_id = test_runs.id AND model_filter.model_name = ${filters.model}
      ))
      AND (${score}::int IS NULL OR EXISTS (
        SELECT 1 FROM model_results score_results
        JOIN evaluations score_evaluations ON score_evaluations.model_result_id = score_results.id
        WHERE score_results.test_run_id = test_runs.id AND score_evaluations.score_stars = ${score}::int
      ))
  `;
  const [rows, countRows] = await Promise.all([
    sql`SELECT test_runs.id FROM test_runs ${where} ORDER BY test_runs.created_at DESC LIMIT ${filters.pageSize} OFFSET ${(filters.page - 1) * filters.pageSize}`,
    sql`SELECT COUNT(*)::int AS total FROM test_runs ${where}`,
  ]);
  const restored = await Promise.all(rows.map((row) => loadPersistedState(String(row.id))));
  return {
    runs: restored.flatMap((state) => state?.runs.map((item) => item.run) ?? []),
    total: Number(countRows[0]?.total ?? 0),
    page: filters.page,
    pageSize: filters.pageSize,
  };
}

async function persistRun(run: TestRun, config: RunPersistenceConfig) {
  if (!isPostgres()) {
    sqlitePersistRun(run, config);
    return;
  }
  const sql = getClient();
  if (!sql) return;
  const evaluatorConfig = config.evaluator
    ? JSON.stringify({
        apiKeyEncrypted: config.evaluator.apiKey ? encryptSecret(config.evaluator.apiKey) : null,
        baseUrl: config.evaluator.baseUrl,
        model: config.evaluator.model,
      })
    : null;

  await sql.begin(async (transaction) => {
    await transaction`
      INSERT INTO test_runs (id, status, paused, control_version, system_prompt, ollama_url, user_messages, selected_models, parameters, evaluator_config, created_at, started_at, finished_at, error_message)
      VALUES (${run.id}, ${run.status}, ${run.paused}, ${run.controlVersion}, ${run.systemPrompt}, ${config.ollamaUrl}, ${JSON.stringify(run.userMessages)}::jsonb, ${JSON.stringify(run.models)}::jsonb, ${JSON.stringify(run.parameters)}::jsonb, ${evaluatorConfig}::jsonb, ${new Date(run.createdAt)}, ${dateOrNull(run.startedAt)}, ${dateOrNull(run.finishedAt)}, ${run.errorMessage})
      ON CONFLICT (id) DO UPDATE SET
        status = CASE WHEN EXCLUDED.control_version >= test_runs.control_version THEN EXCLUDED.status ELSE test_runs.status END,
        paused = CASE WHEN EXCLUDED.control_version >= test_runs.control_version THEN EXCLUDED.paused ELSE test_runs.paused END,
        control_version = GREATEST(test_runs.control_version, EXCLUDED.control_version),
        system_prompt = EXCLUDED.system_prompt,
        ollama_url = EXCLUDED.ollama_url,
        user_messages = EXCLUDED.user_messages,
        selected_models = EXCLUDED.selected_models,
        parameters = EXCLUDED.parameters,
        evaluator_config = EXCLUDED.evaluator_config,
        started_at = CASE WHEN EXCLUDED.control_version >= test_runs.control_version THEN EXCLUDED.started_at ELSE test_runs.started_at END,
        finished_at = CASE WHEN EXCLUDED.control_version >= test_runs.control_version THEN EXCLUDED.finished_at ELSE test_runs.finished_at END,
        error_message = CASE WHEN EXCLUDED.control_version >= test_runs.control_version THEN EXCLUDED.error_message ELSE test_runs.error_message END
    `;
    for (const result of run.results) {
      await transaction`
        INSERT INTO model_results (id, test_run_id, model_name, status, eval_status, response_text, input_tokens, output_tokens, ttft_ms, tok_per_sec, total_duration_ms, error_message, human_status, human_notes)
        VALUES (${result.id}, ${run.id}, ${result.modelName}, ${result.status}, ${result.evalStatus}, ${result.responseText}, ${result.inputTokens}, ${result.outputTokens}, ${result.ttftMs}, ${result.tokPerSec}, ${result.totalDurationMs}, ${result.errorMessage}, ${result.humanStatus}, ${result.humanNotes})
        ON CONFLICT (id) DO UPDATE SET
          model_name = EXCLUDED.model_name,
          status = EXCLUDED.status,
          eval_status = EXCLUDED.eval_status,
          response_text = EXCLUDED.response_text,
          input_tokens = EXCLUDED.input_tokens,
          output_tokens = EXCLUDED.output_tokens,
          ttft_ms = EXCLUDED.ttft_ms,
          tok_per_sec = EXCLUDED.tok_per_sec,
          total_duration_ms = EXCLUDED.total_duration_ms,
          error_message = EXCLUDED.error_message,
          human_status = CASE WHEN EXCLUDED.human_status = 'UNREVIEWED' THEN model_results.human_status ELSE EXCLUDED.human_status END,
          human_notes = CASE WHEN EXCLUDED.human_status = 'UNREVIEWED' THEN model_results.human_notes ELSE EXCLUDED.human_notes END
      `;
      await transaction`DELETE FROM model_result_turns WHERE model_result_id = ${result.id}`;
      await transaction`DELETE FROM evaluations WHERE model_result_id = ${result.id}`;
      for (const turn of result.turns) await persistTurn(transaction, result.id, turn);
      if (result.evaluation) await persistEvaluation(transaction, result.id, result.evaluation);
    }
  });
}

async function persistTurn(transaction: TransactionSql, resultId: string, turn: TurnResult) {
  await transaction`
    INSERT INTO model_result_turns (id, model_result_id, step_order, user_message, response_text, thinking, input_tokens, output_tokens, ttft_ms, tok_per_sec, total_duration_ms)
    VALUES (${turn.id}, ${resultId}, ${turn.stepOrder}, ${turn.userMessage}, ${turn.responseText}, ${turn.thinking ?? ""}, ${turn.inputTokens}, ${turn.outputTokens}, ${turn.ttftMs}, ${turn.tokPerSec}, ${turn.totalDurationMs})
  `;
}

async function persistEvaluation(transaction: TransactionSql, resultId: string, evaluation: NonNullable<ModelResult["evaluation"]>) {
  await transaction`
    INSERT INTO evaluations (id, model_result_id, evaluator_model, grammar_rating, compliance_rating, accuracy_rating, score_stars, grammar_analysis, compliance_analysis, accuracy_analysis, feedback_text, evaluator_raw_json)
    VALUES (${crypto.randomUUID()}, ${resultId}, ${evaluation.evaluatorModel}, ${evaluation.grammarRating}, ${evaluation.complianceRating}, ${evaluation.accuracyRating}, ${evaluation.scoreStars}, ${evaluation.grammarAnalysis}, ${evaluation.complianceAnalysis}, ${evaluation.accuracyAnalysis}, ${evaluation.feedbackText}, ${JSON.stringify(evaluation.rawJson)}::jsonb)
  `;
}

function getClient() {
  if (client !== undefined) return client;
  const url = process.env.DATABASE_URL?.trim();
  client = url ? postgres(url, { connect_timeout: 5, idle_timeout: 20, max: 5 }) : null;
  return client;
}

function groupTurns(rows: Array<Record<string, unknown>>) {
  const grouped = new Map<string, TurnResult[]>();
  for (const row of rows) {
    const turns = grouped.get(String(row.model_result_id)) ?? [];
    turns.push({
      id: String(row.id),
      stepOrder: Number(row.step_order),
      userMessage: String(row.user_message),
      responseText: String(row.response_text),
      thinking: row.thinking ? String(row.thinking) : null,
      inputTokens: numberOrNull(row.input_tokens),
      outputTokens: numberOrNull(row.output_tokens),
      ttftMs: numberOrNull(row.ttft_ms),
      tokPerSec: numberOrNull(row.tok_per_sec),
      totalDurationMs: numberOrNull(row.total_duration_ms),
    });
    grouped.set(String(row.model_result_id), turns);
  }
  return grouped;
}

function restoreRun(row: Record<string, unknown>, results: ModelResult[]): PersistedRun {
  const evaluator = parseEvaluatorConfig(row.evaluator_config);
  return {
    run: {
      id: String(row.id),
      status: String(row.status) as TestRun["status"],
      paused: Boolean(row.paused),
      controlVersion: Number(row.control_version ?? 0),
      systemPrompt: String(row.system_prompt),
      userMessages: parseJsonArray(row.user_messages),
      models: parseJsonArray(row.selected_models),
      parameters: parseJson(row.parameters) as TestRun["parameters"],
      evaluatorModel: evaluator?.model ?? null,
      results,
      createdAt: dateToIso(row.created_at),
      startedAt: nullableDateToIso(row.started_at),
      finishedAt: nullableDateToIso(row.finished_at),
      errorMessage: row.error_message ? String(row.error_message) : null,
    },
    config: { ollamaUrl: String(row.ollama_url), evaluator },
  };
}

function restoreResult(row: Record<string, unknown>, turns: TurnResult[], evaluationRow?: Record<string, unknown>) {
  const evaluation = evaluationRow
    ? {
        evaluatorModel: String(evaluationRow.evaluator_model),
        grammarRating: numberOrNull(evaluationRow.grammar_rating),
        complianceRating: numberOrNull(evaluationRow.compliance_rating),
        accuracyRating: numberOrNull(evaluationRow.accuracy_rating),
        scoreStars: numberOrNull(evaluationRow.score_stars),
        grammarAnalysis: String(evaluationRow.grammar_analysis ?? ""),
        complianceAnalysis: String(evaluationRow.compliance_analysis ?? ""),
        accuracyAnalysis: String(evaluationRow.accuracy_analysis ?? ""),
        feedbackText: String(evaluationRow.feedback_text ?? ""),
        rawJson: evaluationRow.evaluator_raw_json,
      }
    : null;
  return {
    id: String(row.id),
    modelName: String(row.model_name),
    status: String(row.status) as ModelResult["status"],
    evalStatus: String(row.eval_status) as ModelResult["evalStatus"],
    responseText: row.response_text ? String(row.response_text) : null,
    turns,
    evaluation,
    humanStatus: String(row.human_status) as ModelResult["humanStatus"],
    humanNotes: String(row.human_notes ?? ""),
    errorMessage: row.error_message ? String(row.error_message) : null,
    ttftMs: numberOrNull(row.ttft_ms),
    inputTokens: numberOrNull(row.input_tokens),
    outputTokens: numberOrNull(row.output_tokens),
    tokPerSec: numberOrNull(row.tok_per_sec),
    totalDurationMs: numberOrNull(row.total_duration_ms),
  } satisfies ModelResult;
}

function restorePrompt(row: Record<string, unknown>): PromptTemplate {
  return {
    id: String(row.id),
    title: String(row.title),
    systemPrompt: String(row.system_prompt),
    tags: parseJsonArray(row.tags),
    createdAt: dateToIso(row.created_at),
    updatedAt: dateToIso(row.updated_at),
  };
}

function restoreSuite(row: Record<string, unknown>): TestSuite {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ""),
    promptTemplateId: row.system_prompt_id ? String(row.system_prompt_id) : null,
    userMessages: parseJsonArray(row.user_messages),
    tags: parseJsonArray(row.tags),
    createdAt: dateToIso(row.created_at),
    updatedAt: dateToIso(row.updated_at),
  };
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseJson(value: unknown) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseEvaluatorConfig(value: unknown): EvaluatorConfig | undefined {
  if (!value) return undefined;
  const parsed = parseJson(value) as { apiKeyEncrypted?: string; baseUrl?: string; model?: string } | null;
  if (!parsed?.apiKeyEncrypted || !parsed.baseUrl || !parsed.model) return undefined;
  return {
    apiKey: decryptSecret(parsed.apiKeyEncrypted),
    baseUrl: parsed.baseUrl,
    model: parsed.model,
  };
}

function numberOrNull(value: unknown) {
  return value === null || value === undefined ? null : Number(value);
}

function dateToIso(value: unknown) {
  return new Date(String(value)).toISOString();
}

function nullableDateToIso(value: unknown) {
  return value ? dateToIso(value) : null;
}

function dateOrNull(value: string | null) {
  return value ? new Date(value) : null;
}

function reportPersistenceError(error: unknown) {
  console.error("[compare] database persistence failed", error);
}
