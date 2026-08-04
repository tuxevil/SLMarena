import postgres, { type TransactionSql } from "postgres";
import { createHash } from "node:crypto";
import type {
  EvaluatorConfig,
  AppSettings,
  ModelResult,
  Scenario,
  TestRun,
  TurnResult,
} from "@/lib/contracts";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import {
  sqliteDeleteResult,
  sqliteDeleteScenario,
  sqliteLoadSettings,
  sqliteLoadState,
  sqlitePersistHumanReview,
  sqlitePersistRun,
  sqlitePersistScenario,
  sqlitePersistSettings,
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
  scenarios: Scenario[];
};

export type ModelAggregate = {
  modelName: string;
  samples: number;
  evaluatedSamples: number;
  failures: number;
  distribution: Record<number, number>;
  averageStars: number | null;
  averageTtftMs: number | null;
  averageOutputTokens: number | null;
  averageTokPerSec: number | null;
  averageTotalDurationMs: number | null;
};

export type ConsolidatedResult = {
  runId: string;
  runCreatedAt: string;
  result: ModelResult;
};

export type ScenarioAnalysis = {
  scenarioKey: string;
  runs: number;
  models: ModelAggregate[];
  results: ConsolidatedResult[];
  bestModel: { modelName: string; averageStars: number } | null;
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

export function scenarioKeyFor(input: { scenarioId: string | null; systemPrompt: string; userMessages: string[] }) {
  if (input.scenarioId) return `scenario:${input.scenarioId}`;
  return contentKey(input.systemPrompt, input.userMessages);
}

function contentKey(systemPrompt: string, userMessages: string[]) {
  return `content:${createHash("sha256").update(`${systemPrompt}\u0000${JSON.stringify(userMessages)}`).digest("hex")}`;
}

export async function aggregateScenarioAnalysis(input: {
  scenarioId: string | null;
  systemPrompt: string;
  userMessages: string[];
}): Promise<ScenarioAnalysis> {
  const state = await loadPersistedState();
  if (!state) return { scenarioKey: "", runs: 0, models: [], results: [], bestModel: null };

  const key = scenarioKeyFor(input);
  const runs = state.runs.filter((entry) => scenarioKeyFor(entry.run) === key);

  const byModel = new Map<string, { stars: number[]; ttft: number[]; output: number[]; tokPerSec: number[]; total: number[]; failures: number }>();
  for (const entry of runs) {
    for (const result of entry.run.results) {
      const bucket = byModel.get(result.modelName) ?? { stars: [], ttft: [], output: [], tokPerSec: [], total: [], failures: 0 };
      if (result.status === "FAILED" || result.status === "CANCELLED") bucket.failures += 1;
      if (result.evaluation?.scoreStars != null) bucket.stars.push(result.evaluation.scoreStars);
      if (result.ttftMs != null) bucket.ttft.push(result.ttftMs);
      if (result.outputTokens != null) bucket.output.push(result.outputTokens);
      if (result.tokPerSec != null) bucket.tokPerSec.push(result.tokPerSec);
      if (result.totalDurationMs != null) bucket.total.push(result.totalDurationMs);
      byModel.set(result.modelName, bucket);
    }
  }

  const models: ModelAggregate[] = [...byModel.entries()].map(([modelName, bucket]) => {
    const distribution: Record<number, number> = {};
    for (const star of bucket.stars) distribution[star] = (distribution[star] ?? 0) + 1;
    return {
      modelName,
      samples: bucket.stars.length + bucket.failures,
      evaluatedSamples: bucket.stars.length,
      failures: bucket.failures,
      distribution,
      averageStars: average(bucket.stars),
      averageTtftMs: average(bucket.ttft),
      averageOutputTokens: average(bucket.output),
      averageTokPerSec: average(bucket.tokPerSec),
      averageTotalDurationMs: average(bucket.total),
    };
  });

  models.sort((a, b) => {
    const byStars = (b.averageStars ?? 0) - (a.averageStars ?? 0);
    if (byStars !== 0) return byStars;
    return (b.evaluatedSamples + b.failures) - (a.evaluatedSamples + a.failures);
  });

  const ranked = models.filter((model) => model.averageStars !== null);
  const results: ConsolidatedResult[] = runs
    .flatMap((entry) =>
      entry.run.results.map((result) => ({
        runId: entry.run.id,
        runCreatedAt: entry.run.createdAt,
        result,
      })),
    )
    .sort((a, b) => a.runCreatedAt.localeCompare(b.runCreatedAt) || a.result.modelName.localeCompare(b.result.modelName) || a.result.sampleIndex - b.result.sampleIndex);

  return {
    scenarioKey: key,
    runs: runs.length,
    models,
    results,
    bestModel: ranked.length > 0 ? { modelName: ranked[0].modelName, averageStars: ranked[0].averageStars! } : null,
  };
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
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

export async function persistScenario(scenario: Scenario) {
  if (!isPostgres()) {
    sqlitePersistScenario(scenario);
    return;
  }
  await getClient()!`
    INSERT INTO scenarios (id, name, system_prompt, user_messages, created_at, updated_at)
    VALUES (${scenario.id}, ${scenario.name}, ${scenario.systemPrompt}, ${JSON.stringify(scenario.userMessages)}::jsonb, ${new Date(scenario.createdAt)}, ${new Date(scenario.updatedAt)})
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      system_prompt = EXCLUDED.system_prompt,
      user_messages = EXCLUDED.user_messages,
      updated_at = EXCLUDED.updated_at
  `;
}

export async function deletePersistedScenario(id: string) {
  if (!isPostgres()) {
    sqliteDeleteScenario(id);
    return;
  }
  await getClient()!`DELETE FROM scenarios WHERE id = ${id}`;
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

export async function deletePersistedResult(runId: string, resultId: string): Promise<boolean> {
  if (!isPostgres()) {
    return sqliteDeleteResult(runId, resultId);
  }
  const sql = getClient()!;
  const [deleted] = await sql`
    DELETE FROM model_results WHERE id = ${resultId} AND test_run_id = ${runId}
    RETURNING id
  `;
  return Boolean(deleted);
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
    const [runRows, resultRows, turnRows, evaluationRows, scenarioRows] = await sql.begin(async (transaction) => Promise.all([
      runId
        ? transaction`SELECT id, status, paused, control_version, scenario_id, samples_per_model, system_prompt, ollama_url, user_messages, selected_models, parameters, evaluator_config, created_at, started_at, finished_at, error_message FROM test_runs WHERE id = ${runId}`
        : transaction`SELECT id, status, paused, control_version, scenario_id, samples_per_model, system_prompt, ollama_url, user_messages, selected_models, parameters, evaluator_config, created_at, started_at, finished_at, error_message FROM test_runs ORDER BY created_at DESC`,
      runId
        ? transaction`SELECT id, test_run_id, model_name, sample_index, status, eval_status, response_text, input_tokens, output_tokens, ttft_ms, tok_per_sec, total_duration_ms, error_message, human_status, human_notes FROM model_results WHERE test_run_id = ${runId}`
        : transaction`SELECT id, test_run_id, model_name, sample_index, status, eval_status, response_text, input_tokens, output_tokens, ttft_ms, tok_per_sec, total_duration_ms, error_message, human_status, human_notes FROM model_results`,
      runId
        ? transaction`SELECT id, model_result_id, step_order, user_message, response_text, thinking, input_tokens, output_tokens, ttft_ms, tok_per_sec, total_duration_ms FROM model_result_turns WHERE model_result_id IN (SELECT id FROM model_results WHERE test_run_id = ${runId}) ORDER BY step_order ASC`
        : transaction`SELECT id, model_result_id, step_order, user_message, response_text, thinking, input_tokens, output_tokens, ttft_ms, tok_per_sec, total_duration_ms FROM model_result_turns ORDER BY step_order ASC`,
      runId
        ? transaction`SELECT model_result_id, evaluator_model, grammar_rating, compliance_rating, accuracy_rating, score_stars, grammar_analysis, compliance_analysis, accuracy_analysis, feedback_text, evaluator_raw_json FROM evaluations WHERE model_result_id IN (SELECT id FROM model_results WHERE test_run_id = ${runId})`
        : transaction`SELECT model_result_id, evaluator_model, grammar_rating, compliance_rating, accuracy_rating, score_stars, grammar_analysis, compliance_analysis, accuracy_analysis, feedback_text, evaluator_raw_json FROM evaluations`,
      runId ? emptyRows : transaction`SELECT id, name, system_prompt, user_messages, created_at, updated_at FROM scenarios ORDER BY updated_at DESC`,
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
      scenarios: scenarioRows.map(restoreScenario),
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
      INSERT INTO test_runs (id, status, paused, control_version, scenario_id, samples_per_model, system_prompt, ollama_url, user_messages, selected_models, parameters, evaluator_config, created_at, started_at, finished_at, error_message)
      VALUES (${run.id}, ${run.status}, ${run.paused}, ${run.controlVersion}, ${run.scenarioId}, ${run.samplesPerModel}, ${run.systemPrompt}, ${config.ollamaUrl}, ${JSON.stringify(run.userMessages)}::jsonb, ${JSON.stringify(run.models)}::jsonb, ${JSON.stringify(run.parameters)}::jsonb, ${evaluatorConfig}::jsonb, ${new Date(run.createdAt)}, ${dateOrNull(run.startedAt)}, ${dateOrNull(run.finishedAt)}, ${run.errorMessage})
      ON CONFLICT (id) DO UPDATE SET
        status = CASE WHEN EXCLUDED.control_version >= test_runs.control_version THEN EXCLUDED.status ELSE test_runs.status END,
        paused = CASE WHEN EXCLUDED.control_version >= test_runs.control_version THEN EXCLUDED.paused ELSE test_runs.paused END,
        control_version = GREATEST(test_runs.control_version, EXCLUDED.control_version),
        scenario_id = EXCLUDED.scenario_id,
        samples_per_model = EXCLUDED.samples_per_model,
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
        INSERT INTO model_results (id, test_run_id, model_name, sample_index, status, eval_status, response_text, input_tokens, output_tokens, ttft_ms, tok_per_sec, total_duration_ms, error_message, human_status, human_notes)
        VALUES (${result.id}, ${run.id}, ${result.modelName}, ${result.sampleIndex}, ${result.status}, ${result.evalStatus}, ${result.responseText}, ${result.inputTokens}, ${result.outputTokens}, ${result.ttftMs}, ${result.tokPerSec}, ${result.totalDurationMs}, ${result.errorMessage}, ${result.humanStatus}, ${result.humanNotes})
        ON CONFLICT (id) DO UPDATE SET
          model_name = EXCLUDED.model_name,
          sample_index = EXCLUDED.sample_index,
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
      scenarioId: row.scenario_id ? String(row.scenario_id) : null,
      samplesPerModel: Number(row.samples_per_model ?? 1),
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
    sampleIndex: Number(row.sample_index ?? 0),
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

function restoreScenario(row: Record<string, unknown>): Scenario {
  return {
    id: String(row.id),
    name: String(row.name),
    systemPrompt: String(row.system_prompt),
    userMessages: parseJsonArray(row.user_messages),
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
