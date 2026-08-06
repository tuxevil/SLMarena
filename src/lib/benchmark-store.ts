import { createHash } from "crypto";
import type {
  CreateRunInput,
  AppSettings,
  Evaluation,
  HumanStatus,
  ModelResult,
  RunEvent,
  Scenario,
  SecurityAttackType,
  TestRun,
  TurnResult,
} from "@/lib/contracts";
import { SECURITY_TEMPLATES } from "@/lib/security-templates";
import {
  deletePersistedResult,
  loadPersistedSettings,
  loadPersistedState,
  queuePersistedRun,
  deletePersistedScenario,
  persistScenario,
  persistHumanReview,
  persistSettings,
  type PersistedSettings,
  type RunPersistenceConfig,
  waitForPersistedRun,
} from "@/lib/database";
import { publishRunEvent } from "@/lib/run-events";

type RunListener = (event: RunEvent) => void;

type StoredRun = TestRun & {
  evaluator: CreateRunInput["evaluator"];
  ollamaUrl: string;
  cancelController: AbortController;
  eventSequence: number;
  listeners: Set<RunListener>;
};

type StoreState = {
  runs: Map<string, StoredRun>;
  scenarios: Map<string, Scenario>;
  hydrated: boolean;
  hydrationPromise?: Promise<void>;
  settings: PersistedSettings;
};

const globalStore = globalThis as typeof globalThis & {
  __slmarenaStore?: StoreState;
};

const state: StoreState =
  globalStore.__slmarenaStore ?? {
    runs: new Map(),
    scenarios: new Map(),
    hydrated: false,
    settings: defaultSettings(),
  };

globalStore.__slmarenaStore = state;

export const benchmarkStore = {
  createRun(input: CreateRunInput): TestRun {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const run: StoredRun = {
      id,
      category: input.category ?? "GENERAL",
      attackType: input.attackType ?? null,
      status: "PENDING",
      paused: false,
      controlVersion: 0,
      scenarioId: input.scenarioId ?? null,
      samplesPerModel: input.samplesPerModel ?? 1,
      systemPrompt: input.systemPrompt,
      userMessages: input.userMessages,
      models: input.models,
      parameters: input.parameters,
      evaluatorModel: input.evaluator?.model ?? null,
      results: input.models.flatMap((modelName) =>
        Array.from({ length: input.samplesPerModel ?? 1 }, (_, sampleIndex) => createModelResult(modelName, sampleIndex)),
      ),
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
      evaluator: input.evaluator,
      ollamaUrl: input.ollamaUrl,
      cancelController: new AbortController(),
      eventSequence: 0,
      listeners: new Set(),
    };

    state.runs.set(id, run);
    emit(run, "run.created");
    return snapshot(run);
  },

  async hydrate() {
    if (state.hydrationPromise) return state.hydrationPromise;
    state.hydrationPromise = (async () => {
      if (!state.hydrated) {
        const [persisted, persistedSettings] = await Promise.all([loadPersistedState(), loadPersistedSettings()]);
        if (persistedSettings) state.settings = persistedSettings;
        if (persisted) {
          for (const run of persisted.runs) restoreRun(run.run, run.config);
          for (const scenario of persisted.scenarios) state.scenarios.set(scenario.id, scenario);
        }
        state.hydrated = true;
      }
      await seedSecurityScenarios();
    })().finally(() => {
      state.hydrationPromise = undefined;
    });
    return state.hydrationPromise;
  },

  getSettings(): AppSettings {
    return {
      ollamaUrl: state.settings.ollamaUrl,
      evaluatorBaseUrl: state.settings.evaluatorBaseUrl,
      evaluatorModel: state.settings.evaluatorModel,
      evaluatorApiKeyConfigured: Boolean(state.settings.evaluatorApiKey),
      parameters: state.settings.parameters,
    };
  },

  getEvaluatorConfig(): CreateRunInput["evaluator"] {
    if (!state.settings.evaluatorBaseUrl || !state.settings.evaluatorModel || !state.settings.evaluatorApiKey) return undefined;
    return {
      baseUrl: state.settings.evaluatorBaseUrl,
      model: state.settings.evaluatorModel,
      apiKey: state.settings.evaluatorApiKey,
    };
  },

  async updateSettings(input: {
    ollamaUrl?: string;
    evaluatorBaseUrl?: string;
    evaluatorModel?: string;
    evaluatorApiKey?: string;
    clearEvaluatorApiKey: boolean;
    parameters?: import("@/lib/contracts").BenchmarkParameters;
  }) {
    const nextSettings: PersistedSettings = {
      ollamaUrl: input.ollamaUrl ?? state.settings.ollamaUrl,
      evaluatorBaseUrl: input.evaluatorBaseUrl ?? state.settings.evaluatorBaseUrl,
      evaluatorModel: input.evaluatorModel ?? state.settings.evaluatorModel,
      evaluatorApiKey: input.clearEvaluatorApiKey
        ? null
        : input.evaluatorApiKey?.trim()
          ? input.evaluatorApiKey.trim()
          : state.settings.evaluatorApiKey,
      evaluatorApiKeyConfigured: false,
      parameters: input.parameters ?? state.settings.parameters,
    };
    await persistSettings(nextSettings);
    state.settings = nextSettings;
    return benchmarkStore.getSettings();
  },

  async refreshRun(id: string) {
    const persisted = await loadPersistedState(id);
    if (persisted?.runs[0]) restoreRun(persisted.runs[0].run, persisted.runs[0].config);
    return benchmarkStore.getRun(id);
  },

  async flush(id: string) {
    await waitForPersistedRun(id);
  },

  getRun(id: string) {
    const run = state.runs.get(id);
    return run ? snapshot(run) : null;
  },

  listRuns(filters: {
    keyword?: string;
    date?: string;
    model?: string;
    score?: number;
    vulnerableOnly?: boolean;
    timezoneOffset?: number;
    page?: number;
    pageSize?: number;
  } = {}) {
    const keyword = filters.keyword?.trim().toLowerCase() ?? "";
    const date = filters.date?.trim() ?? "";
    const model = filters.model?.trim() ?? "";
    const filtered = [...state.runs.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .filter((run) => {
        if (keyword && !JSON.stringify(run).toLowerCase().includes(keyword)) return false;
        if (model && !run.models.includes(model)) return false;
        if (filters.score && !run.results.some((result) => result.evaluation?.scoreStars === filters.score)) return false;
        if (
          filters.vulnerableOnly &&
          !run.results.some(
            (res) => res.evaluation?.injectionSuccessful || res.evaluation?.systemLeakageDetected,
          )
        ) {
          return false;
        }
        if (date && localDate(run.createdAt, filters.timezoneOffset ?? 0) !== date) return false;
        return true;
      });
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 50));
    return {
      runs: filtered.slice((page - 1) * pageSize, page * pageSize).map((run) => snapshot(run)),
      total: filtered.length,
      page,
      pageSize,
    };
  },

  getStoredRun(id: string) {
    return state.runs.get(id) ?? null;
  },

  findResult(resultId: string) {
    for (const run of state.runs.values()) {
      if (run.results.some((result) => result.id === resultId)) {
        return run;
      }
    }
    return null;
  },

  updateRun(id: string, patch: Partial<Pick<TestRun, "status" | "paused" | "startedAt" | "finishedAt" | "errorMessage">>) {
    const run = getRequiredRun(id);
    Object.assign(run, patch);
    emit(run, `run.${run.status.toLowerCase()}`);
    return snapshot(run);
  },

  updateResult(id: string, resultId: string, patch: Partial<ModelResult>) {
    const run = getRequiredRun(id);
    const result = getRequiredResult(run, resultId);
    Object.assign(result, patch);
    emit(run, `model.${result.status.toLowerCase()}`);
    return snapshot(run);
  },

  pauseRun(id: string) {
    const run = getRequiredRun(id);
    if (run.status === "PENDING" || run.status === "RUNNING") {
      run.paused = true;
      run.controlVersion += 1;
      emit(run, "run.paused");
    }
    return snapshot(run);
  },

  resumeRun(id: string) {
    const run = getRequiredRun(id);
    run.paused = false;
    run.controlVersion += 1;
    emit(run, "run.resumed");
    return snapshot(run);
  },

  addTurn(id: string, resultId: string, turn: TurnResult) {
    const run = getRequiredRun(id);
    const result = getRequiredResult(run, resultId);
    result.turns = [...result.turns, turn];
    result.responseText = result.turns.map((item) => item.responseText).join("\n\n");
    emit(run, "model.turn.completed");
    return snapshot(run);
  },

  updateStreamingResponse(id: string, resultId: string, partialResponse: string) {
    const run = getRequiredRun(id);
    const result = getRequiredResult(run, resultId);
    result.responseText = [...result.turns.map((turn) => turn.responseText), partialResponse]
      .filter(Boolean)
      .join("\n\n");
    emit(run, "model.token");
  },

  setEvaluation(id: string, resultId: string, evaluation: Evaluation | null) {
    const run = getRequiredRun(id);
    const result = getRequiredResult(run, resultId);
    result.evaluation = evaluation;
    emit(run, "model.evaluation.completed");
    return snapshot(run);
  },

  async updateHumanReview(id: string, resultId: string, status: HumanStatus, notes: string) {
    const run = getRequiredRun(id);
    const result = getRequiredResult(run, resultId);
    result.humanStatus = status;
    result.humanNotes = notes;
    emit(run, "model.review.updated");
    await waitForPersistedRun(run.id);
    await persistHumanReview(resultId, status, notes);
    return snapshot(run);
  },

  cancelRun(id: string) {
    const run = getRequiredRun(id);
    run.cancelController.abort();
    run.status = "CANCELLED";
    run.paused = false;
    run.controlVersion += 1;
    run.finishedAt = new Date().toISOString();
    for (const result of run.results) {
      if (result.status === "PENDING" || result.status === "INFERRING" || result.status === "EVALUATING") {
        result.status = "CANCELLED";
      }
    }
    emit(run, "run.cancelled");
    return snapshot(run);
  },

  async deleteResult(id: string, resultId: string) {
    const run = state.runs.get(id);
    if (!run) return false;
    const index = run.results.findIndex((result) => result.id === resultId);
    if (index === -1) return false;
    run.results.splice(index, 1);
    emit(run, "run.updated");
    await deletePersistedResult(id, resultId);
    return true;
  },

  subscribe(id: string, listener: RunListener) {
    const run = getRequiredRun(id);
    run.listeners.add(listener);
    return () => {
      run.listeners.delete(listener);
    };
  },

  listScenarios() {
    return [...state.scenarios.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async createScenario(input: Pick<Scenario, "name" | "category" | "attackType" | "systemPrompt" | "userMessages">) {
    const now = new Date().toISOString();
    const scenario: Scenario = {
      id: crypto.randomUUID(),
      category: input.category ?? "GENERAL",
      attackType: input.attackType ?? null,
      name: input.name,
      systemPrompt: input.systemPrompt,
      userMessages: input.userMessages,
      createdAt: now,
      updatedAt: now,
    };
    await persistScenario(scenario);
    state.scenarios.set(scenario.id, scenario);
    return scenario;
  },

  async updateScenario(id: string, input: Pick<Scenario, "name" | "category" | "attackType" | "systemPrompt" | "userMessages">) {
    const scenario = state.scenarios.get(id);
    if (!scenario) return null;
    const updatedScenario: Scenario = {
      ...scenario,
      ...input,
      category: input.category ?? scenario.category ?? "GENERAL",
      attackType: input.attackType !== undefined ? input.attackType : scenario.attackType ?? null,
      updatedAt: new Date().toISOString(),
    };
    await persistScenario(updatedScenario);
    state.scenarios.set(id, updatedScenario);
    return updatedScenario;
  },

  async deleteScenario(id: string) {
    if (!state.scenarios.has(id)) return false;
    await deletePersistedScenario(id);
    return state.scenarios.delete(id);
  },
};

function createModelResult(modelName: string, sampleIndex: number): ModelResult {
  return {
    id: crypto.randomUUID(),
    modelName,
    sampleIndex,
    status: "PENDING",
    evalStatus: "PENDING",
    responseText: null,
    turns: [],
    evaluation: null,
    humanStatus: "UNREVIEWED",
    humanNotes: "",
    errorMessage: null,
    ttftMs: null,
    inputTokens: null,
    outputTokens: null,
    tokPerSec: null,
    totalDurationMs: null,
  };
}

function getRequiredRun(id: string) {
  const run = state.runs.get(id);
  if (!run) throw new Error(`Run ${id} was not found.`);
  return run;
}

function getRequiredResult(run: StoredRun, resultId: string) {
  const result = run.results.find((item) => item.id === resultId);
  if (!result) throw new Error(`Result ${resultId} was not found.`);
  return result;
}

async function seedSecurityScenarios() {
  for (const attackType of Object.keys(SECURITY_TEMPLATES) as SecurityAttackType[]) {
    const template = SECURITY_TEMPLATES[attackType];
    const seededId = seedScenarioId(attackType);
    const existing = [...state.scenarios.values()].find(
      (scenario) => scenario.id === seededId || scenario.attackType === attackType,
    );
    if (existing) continue;
    const now = new Date().toISOString();
    const scenario: Scenario = {
      id: seededId,
      category: "SECURITY",
      attackType,
      name: template.name,
      systemPrompt: template.systemPrompt,
      userMessages: template.userMessages,
      createdAt: now,
      updatedAt: now,
    };
    await persistScenario(scenario);
    state.scenarios.set(scenario.id, scenario);
  }
}

function seedScenarioId(attackType: SecurityAttackType) {
  const hash = createHash("sha256").update(`slmarena:security:${attackType}`).digest("hex");
  const hex = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  return hex;
}

function emit(run: StoredRun, type: string) {
  const event: RunEvent = {
    id: ++run.eventSequence,
    type,
    run: snapshot(run),
    createdAt: new Date().toISOString(),
  };

  const config: RunPersistenceConfig = { ollamaUrl: run.ollamaUrl, evaluator: run.evaluator };
  queuePersistedRun(event.run, type, config);
  void publishRunEvent(event).catch((error) => console.error("[slmarena] run event publish failed", error));
  for (const listener of run.listeners) listener(event);
}

function restoreRun(run: TestRun, config: RunPersistenceConfig) {
  const existing = state.runs.get(run.id);
  state.runs.set(run.id, {
    ...run,
    evaluator: config.evaluator,
    ollamaUrl: config.ollamaUrl,
    cancelController: existing?.cancelController ?? new AbortController(),
    eventSequence: existing?.eventSequence ?? 0,
    listeners: existing?.listeners ?? new Set(),
  });
}

function snapshot(run: StoredRun): TestRun {
  return structuredClone({
    id: run.id,
    category: run.category ?? "GENERAL",
    attackType: run.attackType ?? null,
    status: run.status,
    paused: run.paused,
    controlVersion: run.controlVersion,
    scenarioId: run.scenarioId,
    samplesPerModel: run.samplesPerModel,
    systemPrompt: run.systemPrompt,
    userMessages: run.userMessages,
    models: run.models,
    parameters: run.parameters,
    evaluatorModel: run.evaluatorModel,
    results: run.results,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    errorMessage: run.errorMessage,
  });
}

function defaultSettings(): PersistedSettings {
  return {
    ollamaUrl: process.env.OLLAMA_URL ?? "http://localhost:11434",
    evaluatorBaseUrl: process.env.EVALUATOR_BASE_URL ?? "",
    evaluatorModel: process.env.EVALUATOR_MODEL ?? "",
    evaluatorApiKey: process.env.EVALUATOR_API_KEY ?? null,
    evaluatorApiKeyConfigured: Boolean(process.env.EVALUATOR_API_KEY),
    parameters: {
      temperature: 0.2,
      numCtx: 8192,
      topP: 0.9,
      repeatPenalty: 1.1,
      numPredict: 4096,
    },
  };
}

function localDate(timestamp: string, timezoneOffset: number) {
  const date = new Date(new Date(timestamp).getTime() - timezoneOffset * 60_000);
  return [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, "0"), String(date.getUTCDate()).padStart(2, "0")].join("-");
}
