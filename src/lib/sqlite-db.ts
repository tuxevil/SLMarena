import Database from "better-sqlite3";
import type {
  BenchmarkParameters,
  Evaluation,
  HumanStatus,
  ModelResult,
  PromptTemplate,
  RunStatus,
  TestRun,
  TestSuite,
  TurnResult,
} from "@/lib/contracts";

type SqlRow = Record<string, unknown>;
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import path from "node:path";

let dbInstance: Database.Database | null = null;

export function getSqliteDb(): Database.Database {
  if (!dbInstance) {
    const dbPath = process.env.SQLITE_PATH?.trim() || path.join(process.cwd(), "compare.db");
    dbInstance = new Database(dbPath);
    dbInstance.pragma("journal_mode = WAL");
    dbInstance.pragma("foreign_keys = ON");
    initSqliteTables(dbInstance);
  }
  return dbInstance;
}

function initSqliteTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS prompt_templates (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      ollama_url TEXT NOT NULL,
      evaluator_base_url TEXT,
      evaluator_model TEXT,
      evaluator_api_key_encrypted TEXT,
      parameters_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS test_suites (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      system_prompt_id TEXT,
      user_messages TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS test_runs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      paused INTEGER NOT NULL DEFAULT 0,
      control_version INTEGER NOT NULL DEFAULT 1,
      system_prompt TEXT NOT NULL,
      ollama_url TEXT NOT NULL,
      user_messages TEXT NOT NULL,
      selected_models TEXT NOT NULL,
      parameters TEXT NOT NULL,
      evaluator_config TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS model_results (
      id TEXT PRIMARY KEY,
      test_run_id TEXT NOT NULL,
      model_name TEXT NOT NULL,
      status TEXT NOT NULL,
      eval_status TEXT NOT NULL DEFAULT 'PENDING',
      response_text TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      ttft_ms INTEGER,
      tok_per_sec REAL,
      total_duration_ms INTEGER,
      error_message TEXT,
      human_status TEXT NOT NULL DEFAULT 'UNREVIEWED',
      human_notes TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(test_run_id) REFERENCES test_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS model_result_turns (
      id TEXT PRIMARY KEY,
      model_result_id TEXT NOT NULL,
      step_order INTEGER NOT NULL,
      user_message TEXT NOT NULL,
      response_text TEXT NOT NULL,
      thinking TEXT NOT NULL DEFAULT '',
      input_tokens INTEGER,
      output_tokens INTEGER,
      ttft_ms INTEGER,
      tok_per_sec REAL,
      total_duration_ms INTEGER,
      FOREIGN KEY(model_result_id) REFERENCES model_results(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS evaluations (
      id TEXT PRIMARY KEY,
      model_result_id TEXT UNIQUE NOT NULL,
      evaluator_model TEXT NOT NULL,
      grammar_rating INTEGER NOT NULL,
      compliance_rating INTEGER NOT NULL,
      accuracy_rating INTEGER NOT NULL,
      score_stars INTEGER NOT NULL,
      grammar_analysis TEXT,
      compliance_analysis TEXT,
      accuracy_analysis TEXT,
      feedback_text TEXT,
      evaluator_raw_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(model_result_id) REFERENCES model_results(id) ON DELETE CASCADE
    );
  `  );

  const migrationDb = getSqliteDb();
  const turnColumns = migrationDb.prepare("PRAGMA table_info(model_result_turns)").all() as SqlRow[];
  if (!turnColumns.some((column) => column.name === "thinking")) {
    migrationDb.exec("ALTER TABLE model_result_turns ADD COLUMN thinking TEXT NOT NULL DEFAULT ''");
  }
}

export function sqlitePersistPrompt(prompt: PromptTemplate) {
  const db = getSqliteDb();
  db.prepare(`
    INSERT INTO prompt_templates (id, title, system_prompt, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      system_prompt = excluded.system_prompt,
      tags = excluded.tags,
      updated_at = excluded.updated_at
  `).run(
    prompt.id,
    prompt.title,
    prompt.systemPrompt,
    JSON.stringify(prompt.tags),
    prompt.createdAt,
    prompt.updatedAt,
  );
}

export function sqliteDeletePrompt(id: string) {
  getSqliteDb().prepare("DELETE FROM prompt_templates WHERE id = ?").run(id);
}

export function sqlitePersistSuite(suite: TestSuite) {
  const db = getSqliteDb();
  db.prepare(`
    INSERT INTO test_suites (id, name, description, system_prompt_id, user_messages, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      system_prompt_id = excluded.system_prompt_id,
      user_messages = excluded.user_messages,
      tags = excluded.tags,
      updated_at = excluded.updated_at
  `).run(
    suite.id,
    suite.name,
    suite.description,
    suite.promptTemplateId,
    JSON.stringify(suite.userMessages),
    JSON.stringify(suite.tags),
    suite.createdAt,
    suite.updatedAt,
  );
}

export function sqliteDeleteSuite(id: string) {
  getSqliteDb().prepare("DELETE FROM test_suites WHERE id = ?").run(id);
}

export function sqlitePersistHumanReview(resultId: string, status: string, notes: string) {
  getSqliteDb().prepare(`
    UPDATE model_results
    SET human_status = ?, human_notes = ?
    WHERE id = ?
  `).run(status, notes, resultId);
}

export function sqliteLoadSettings(): {
  ollamaUrl: string;
  evaluatorBaseUrl: string;
  evaluatorModel: string;
  evaluatorApiKeyConfigured: boolean;
  evaluatorApiKey: string | null;
  parameters: BenchmarkParameters;
} | null {
  const row = getSqliteDb().prepare("SELECT * FROM app_settings WHERE id = 1").get() as SqlRow | undefined;
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
  let params: BenchmarkParameters = { temperature: 0.2, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 4096 };
  if (row.parameters_json) {
    try {
      const parsed = JSON.parse(String(row.parameters_json));
      params = {
        temperature: Number(parsed.temperature ?? params.temperature),
        numCtx: Number(parsed.numCtx ?? params.numCtx),
        topP: Number(parsed.topP ?? params.topP),
        repeatPenalty: Number(parsed.repeatPenalty ?? params.repeatPenalty),
        numPredict: Number(parsed.numPredict ?? params.numPredict),
      };
    } catch {}
  }

  return {
    ollamaUrl: String(row.ollama_url),
    evaluatorBaseUrl: String(row.evaluator_base_url || ""),
    evaluatorModel: String(row.evaluator_model || ""),
    evaluatorApiKeyConfigured: Boolean(encrypted),
    evaluatorApiKey: apiKey,
    parameters: params,
  };
}

export function sqlitePersistSettings(settings: {
  ollamaUrl: string;
  evaluatorBaseUrl: string;
  evaluatorModel: string;
  evaluatorApiKey: string | null;
  parameters: BenchmarkParameters;
}) {
  const encrypted = settings.evaluatorApiKey ? encryptSecret(settings.evaluatorApiKey) : null;
  getSqliteDb().prepare(`
    INSERT INTO app_settings (id, ollama_url, evaluator_base_url, evaluator_model, evaluator_api_key_encrypted, parameters_json, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      ollama_url = excluded.ollama_url,
      evaluator_base_url = excluded.evaluator_base_url,
      evaluator_model = excluded.evaluator_model,
      evaluator_api_key_encrypted = excluded.evaluator_api_key_encrypted,
      parameters_json = excluded.parameters_json,
      updated_at = excluded.updated_at
  `).run(
    settings.ollamaUrl,
    settings.evaluatorBaseUrl || null,
    settings.evaluatorModel || null,
    encrypted,
    JSON.stringify(settings.parameters),
    new Date().toISOString(),
  );
}

export function sqlitePersistRun(
  run: TestRun,
  config: { ollamaUrl: string; evaluator?: { baseUrl: string; model: string; apiKey: string } },
) {
  const db = getSqliteDb();
  const evaluatorConfigJson = config.evaluator
    ? JSON.stringify({
        apiKeyEncrypted: config.evaluator.apiKey ? encryptSecret(config.evaluator.apiKey) : null,
        baseUrl: config.evaluator.baseUrl,
        model: config.evaluator.model,
      })
    : null;

  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO test_runs (id, status, paused, control_version, system_prompt, ollama_url, user_messages, selected_models, parameters, evaluator_config, created_at, started_at, finished_at, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = CASE WHEN excluded.control_version >= test_runs.control_version THEN excluded.status ELSE test_runs.status END,
        paused = CASE WHEN excluded.control_version >= test_runs.control_version THEN excluded.paused ELSE test_runs.paused END,
        control_version = MAX(test_runs.control_version, excluded.control_version),
        system_prompt = excluded.system_prompt,
        ollama_url = excluded.ollama_url,
        user_messages = excluded.user_messages,
        selected_models = excluded.selected_models,
        parameters = excluded.parameters,
        evaluator_config = excluded.evaluator_config,
        started_at = CASE WHEN excluded.control_version >= test_runs.control_version THEN excluded.started_at ELSE test_runs.started_at END,
        finished_at = CASE WHEN excluded.control_version >= test_runs.control_version THEN excluded.finished_at ELSE test_runs.finished_at END,
        error_message = CASE WHEN excluded.control_version >= test_runs.control_version THEN excluded.error_message ELSE test_runs.error_message END
    `).run(
      run.id,
      run.status,
      run.paused ? 1 : 0,
      run.controlVersion,
      run.systemPrompt,
      config.ollamaUrl,
      JSON.stringify(run.userMessages),
      JSON.stringify(run.models),
      JSON.stringify(run.parameters),
      evaluatorConfigJson,
      run.createdAt,
      run.startedAt,
      run.finishedAt,
      run.errorMessage,
    );

    for (const result of run.results) {
      db.prepare(`
        INSERT INTO model_results (id, test_run_id, model_name, status, eval_status, response_text, input_tokens, output_tokens, ttft_ms, tok_per_sec, total_duration_ms, error_message, human_status, human_notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          model_name = excluded.model_name,
          status = excluded.status,
          eval_status = excluded.eval_status,
          response_text = excluded.response_text,
          input_tokens = excluded.input_tokens,
          output_tokens = excluded.output_tokens,
          ttft_ms = excluded.ttft_ms,
          tok_per_sec = excluded.tok_per_sec,
          total_duration_ms = excluded.total_duration_ms,
          error_message = excluded.error_message,
          human_status = excluded.human_status,
          human_notes = excluded.human_notes
      `).run(
        result.id,
        run.id,
        result.modelName,
        result.status,
        result.evalStatus,
        result.responseText,
        result.inputTokens,
        result.outputTokens,
        result.ttftMs,
        result.tokPerSec,
        result.totalDurationMs,
        result.errorMessage,
        result.humanStatus,
        result.humanNotes,
        run.createdAt,
      );

      if (result.turns && result.turns.length > 0) {
        db.prepare("DELETE FROM model_result_turns WHERE model_result_id = ?").run(result.id);
        const insertTurn = db.prepare(`
          INSERT INTO model_result_turns (id, model_result_id, step_order, user_message, response_text, thinking, input_tokens, output_tokens, ttft_ms, tok_per_sec, total_duration_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const turn of result.turns) {
          insertTurn.run(
            turn.id,
            result.id,
            turn.stepOrder,
            turn.userMessage,
            turn.responseText,
            turn.thinking ?? "",
            turn.inputTokens,
            turn.outputTokens,
            turn.ttftMs,
            turn.tokPerSec,
            turn.totalDurationMs,
          );
        }
      }

      if (result.evaluation) {
        db.prepare(`
          INSERT INTO evaluations (id, model_result_id, evaluator_model, grammar_rating, compliance_rating, accuracy_rating, score_stars, grammar_analysis, compliance_analysis, accuracy_analysis, feedback_text, evaluator_raw_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(model_result_id) DO UPDATE SET
            evaluator_model = excluded.evaluator_model,
            grammar_rating = excluded.grammar_rating,
            compliance_rating = excluded.compliance_rating,
            accuracy_rating = excluded.accuracy_rating,
            score_stars = excluded.score_stars,
            grammar_analysis = excluded.grammar_analysis,
            compliance_analysis = excluded.compliance_analysis,
            accuracy_analysis = excluded.accuracy_analysis,
            feedback_text = excluded.feedback_text,
            evaluator_raw_json = excluded.evaluator_raw_json
        `).run(
          crypto.randomUUID(),
          result.id,
          result.evaluation.evaluatorModel,
          result.evaluation.grammarRating,
          result.evaluation.complianceRating,
          result.evaluation.accuracyRating,
          result.evaluation.scoreStars,
          result.evaluation.grammarAnalysis,
          result.evaluation.complianceAnalysis,
          result.evaluation.accuracyAnalysis,
          result.evaluation.feedbackText,
          JSON.stringify(result.evaluation.rawJson),
          run.createdAt,
        );
      }
    }
  });

  transaction();
}

export function sqliteLoadState(targetRunId?: string) {
  const db = getSqliteDb();

  const runRows = targetRunId
    ? (db.prepare("SELECT * FROM test_runs WHERE id = ?").all(targetRunId) as SqlRow[])
    : (db.prepare("SELECT * FROM test_runs ORDER BY created_at DESC").all() as SqlRow[]);

  const resultRows = targetRunId
    ? (db.prepare("SELECT * FROM model_results WHERE test_run_id = ?").all(targetRunId) as SqlRow[])
    : (db.prepare("SELECT * FROM model_results").all() as SqlRow[]);

  const resultIds = resultRows.map((r) => String(r.id));

  let turnRows: SqlRow[] = [];
  let evalRows: SqlRow[] = [];

  if (resultIds.length > 0) {
    if (targetRunId) {
      turnRows = db
        .prepare(
          `SELECT * FROM model_result_turns WHERE model_result_id IN (SELECT id FROM model_results WHERE test_run_id = ?) ORDER BY step_order ASC`,
        )
        .all(targetRunId) as SqlRow[];
      evalRows = db
        .prepare(
          `SELECT * FROM evaluations WHERE model_result_id IN (SELECT id FROM model_results WHERE test_run_id = ?)`,
        )
        .all(targetRunId) as SqlRow[];
    } else {
      turnRows = db.prepare("SELECT * FROM model_result_turns ORDER BY step_order ASC").all() as SqlRow[];
      evalRows = db.prepare("SELECT * FROM evaluations").all() as SqlRow[];
    }
  }

  const promptRows = targetRunId ? [] : (db.prepare("SELECT * FROM prompt_templates ORDER BY updated_at DESC").all() as SqlRow[]);
  const suiteRows = targetRunId ? [] : (db.prepare("SELECT * FROM test_suites ORDER BY updated_at DESC").all() as SqlRow[]);

  const turnsByResult = new Map<string, TurnResult[]>();
  for (const row of turnRows) {
    const key = String(row.model_result_id);
    const list = turnsByResult.get(key) || [];
    list.push({
      id: String(row.id),
      stepOrder: Number(row.step_order),
      userMessage: String(row.user_message),
      responseText: String(row.response_text),
      thinking: row.thinking ? String(row.thinking) : null,
      inputTokens: row.input_tokens !== null ? Number(row.input_tokens) : null,
      outputTokens: row.output_tokens !== null ? Number(row.output_tokens) : null,
      ttftMs: row.ttft_ms !== null ? Number(row.ttft_ms) : null,
      tokPerSec: row.tok_per_sec !== null ? Number(row.tok_per_sec) : null,
      totalDurationMs: row.total_duration_ms !== null ? Number(row.total_duration_ms) : null,
    });
    turnsByResult.set(key, list);
  }

  const evalsByResult = new Map<string, Evaluation>();
  for (const row of evalRows) {
    evalsByResult.set(String(row.model_result_id), {
      evaluatorModel: String(row.evaluator_model),
      grammarRating: row.grammar_rating !== null ? Number(row.grammar_rating) : null,
      complianceRating: row.compliance_rating !== null ? Number(row.compliance_rating) : null,
      accuracyRating: row.accuracy_rating !== null ? Number(row.accuracy_rating) : null,
      scoreStars: row.score_stars !== null ? Number(row.score_stars) : null,
      grammarAnalysis: String(row.grammar_analysis || ""),
      complianceAnalysis: String(row.compliance_analysis || ""),
      accuracyAnalysis: String(row.accuracy_analysis || ""),
      feedbackText: String(row.feedback_text || ""),
      rawJson: row.evaluator_raw_json ? JSON.parse(String(row.evaluator_raw_json)) : null,
    });
  }

  const resultsByRun = new Map<string, ModelResult[]>();
  for (const row of resultRows) {
    const rowId = String(row.id);
    const turns = turnsByResult.get(rowId) || [];
    const evaluation = evalsByResult.get(rowId) || null;
    const result: ModelResult = {
      id: rowId,
      modelName: String(row.model_name),
      status: row.status as ModelResult["status"],
      evalStatus: row.eval_status as ModelResult["evalStatus"],
      responseText: String(row.response_text || ""),
      inputTokens: row.input_tokens !== null ? Number(row.input_tokens) : null,
      outputTokens: row.output_tokens !== null ? Number(row.output_tokens) : null,
      ttftMs: row.ttft_ms !== null ? Number(row.ttft_ms) : null,
      tokPerSec: row.tok_per_sec !== null ? Number(row.tok_per_sec) : null,
      totalDurationMs: row.total_duration_ms !== null ? Number(row.total_duration_ms) : null,
      turns,
      evaluation,
      errorMessage: row.error_message ? String(row.error_message) : null,
      humanStatus: row.human_status as HumanStatus,
      humanNotes: row.human_notes ? String(row.human_notes) : "",
    };
    const runId = String(row.test_run_id);
    const list = resultsByRun.get(runId) || [];
    list.push(result);
    resultsByRun.set(runId, list);
  }

  const runs = runRows.map((row) => {
    let evaluatorConfig: { baseUrl: string; model: string; apiKey: string } | undefined;
    if (row.evaluator_config) {
      try {
        const parsed = JSON.parse(String(row.evaluator_config));
        evaluatorConfig = {
          baseUrl: parsed.baseUrl,
          model: parsed.model,
          apiKey: parsed.apiKeyEncrypted ? decryptSecret(parsed.apiKeyEncrypted) : "",
        };
      } catch {}
    }

    const runId = String(row.id);
    const run: TestRun = {
      id: runId,
      status: row.status as RunStatus,
      paused: Boolean(row.paused),
      controlVersion: Number(row.control_version || 1),
      systemPrompt: String(row.system_prompt),
      userMessages: JSON.parse(String(row.user_messages)),
      models: JSON.parse(String(row.selected_models)),
      parameters: JSON.parse(String(row.parameters)),
      evaluatorModel: evaluatorConfig?.model ?? null,
      results: resultsByRun.get(runId) || [],
      createdAt: String(row.created_at),
      startedAt: row.started_at ? String(row.started_at) : null,
      finishedAt: row.finished_at ? String(row.finished_at) : null,
      errorMessage: row.error_message ? String(row.error_message) : null,
    };
    return {
      run,
      config: {
        ollamaUrl: String(row.ollama_url),
        evaluator: evaluatorConfig,
      },
    };
  });

  const prompts: PromptTemplate[] = promptRows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    systemPrompt: String(row.system_prompt),
    tags: JSON.parse(String(row.tags || "[]")),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }));

  const suites: TestSuite[] = suiteRows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    description: String(row.description || ""),
    promptTemplateId: row.system_prompt_id ? String(row.system_prompt_id) : null,
    userMessages: JSON.parse(String(row.user_messages)),
    tags: JSON.parse(String(row.tags || "[]")),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }));

  return { runs, prompts, suites };
}
