import type {
  CreateRunInput,
  AppSettings,
  Evaluation,
  HumanStatus,
  ModelResult,
  PromptTemplate,
  RunEvent,
  TestRun,
  TestSuite,
  TurnResult,
} from "@/lib/contracts";
import {
  loadPersistedSettings,
  loadPersistedState,
  queuePersistedRun,
  deletePersistedPrompt,
  deletePersistedSuite,
  persistPrompt,
  persistSuite,
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
  prompts: Map<string, PromptTemplate>;
  suites: Map<string, TestSuite>;
  hydrated: boolean;
  hydrationPromise?: Promise<void>;
  settings: PersistedSettings;
};

const globalStore = globalThis as typeof globalThis & {
  __compareStore?: StoreState;
};

const state: StoreState =
  globalStore.__compareStore ?? {
    runs: new Map(),
    prompts: new Map(),
    suites: new Map(),
    hydrated: false,
    settings: defaultSettings(),
  };

globalStore.__compareStore = state;

export const benchmarkStore = {
  createRun(input: CreateRunInput): TestRun {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const run: StoredRun = {
      id,
      status: "PENDING",
      paused: false,
      controlVersion: 0,
      systemPrompt: input.systemPrompt,
      userMessages: input.userMessages,
      models: input.models,
      parameters: input.parameters,
      evaluatorModel: input.evaluator?.model ?? null,
      results: input.models.map((modelName) => createModelResult(modelName)),
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
    if (state.hydrated) return;
    if (state.hydrationPromise) return state.hydrationPromise;
    state.hydrationPromise = (async () => {
      const [persisted, persistedSettings] = await Promise.all([loadPersistedState(), loadPersistedSettings()]);
      if (persistedSettings) state.settings = persistedSettings;
      if (persisted) {
        for (const run of persisted.runs) restoreRun(run.run, run.config);
        for (const prompt of persisted.prompts) state.prompts.set(prompt.id, prompt);
        for (const suite of persisted.suites) state.suites.set(suite.id, suite);
      }
      state.hydrated = true;
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
    ollamaUrl: string;
    evaluatorBaseUrl: string;
    evaluatorModel: string;
    evaluatorApiKey?: string;
    clearEvaluatorApiKey: boolean;
    parameters?: import("@/lib/contracts").BenchmarkParameters;
  }) {
    const nextSettings: PersistedSettings = {
      ollamaUrl: input.ollamaUrl,
      evaluatorBaseUrl: input.evaluatorBaseUrl,
      evaluatorModel: input.evaluatorModel,
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

  subscribe(id: string, listener: RunListener) {
    const run = getRequiredRun(id);
    run.listeners.add(listener);
    return () => {
      run.listeners.delete(listener);
    };
  },

  listPrompts() {
    return [...state.prompts.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async createPrompt(input: Pick<PromptTemplate, "title" | "systemPrompt" | "tags">) {
    const now = new Date().toISOString();
    const prompt: PromptTemplate = { id: crypto.randomUUID(), ...input, createdAt: now, updatedAt: now };
    await persistPrompt(prompt);
    state.prompts.set(prompt.id, prompt);
    return prompt;
  },

  async updatePrompt(id: string, input: Pick<PromptTemplate, "title" | "systemPrompt" | "tags">) {
    const prompt = state.prompts.get(id);
    if (!prompt) return null;
    const updatedPrompt = { ...prompt, ...input, updatedAt: new Date().toISOString() };
    await persistPrompt(updatedPrompt);
    state.prompts.set(id, updatedPrompt);
    return updatedPrompt;
  },

  async deletePrompt(id: string) {
    if (!state.prompts.has(id)) return false;
    await deletePersistedPrompt(id);
    return state.prompts.delete(id);
  },

  listSuites() {
    return [...state.suites.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async createSuite(input: Pick<TestSuite, "name" | "description" | "promptTemplateId" | "userMessages" | "tags">) {
    const now = new Date().toISOString();
    const suite: TestSuite = { id: crypto.randomUUID(), ...input, createdAt: now, updatedAt: now };
    await persistSuite(suite);
    state.suites.set(suite.id, suite);
    return suite;
  },

  async updateSuite(id: string, input: Pick<TestSuite, "name" | "description" | "promptTemplateId" | "userMessages" | "tags">) {
    const suite = state.suites.get(id);
    if (!suite) return null;
    const updatedSuite = { ...suite, ...input, updatedAt: new Date().toISOString() };
    await persistSuite(updatedSuite);
    state.suites.set(id, updatedSuite);
    return updatedSuite;
  },

  async deleteSuite(id: string) {
    if (!state.suites.has(id)) return false;
    await deletePersistedSuite(id);
    return state.suites.delete(id);
  },
};

function createModelResult(modelName: string): ModelResult {
  return {
    id: crypto.randomUUID(),
    modelName,
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

function emit(run: StoredRun, type: string) {
  const event: RunEvent = {
    id: ++run.eventSequence,
    type,
    run: snapshot(run),
    createdAt: new Date().toISOString(),
  };

  const config: RunPersistenceConfig = { ollamaUrl: run.ollamaUrl, evaluator: run.evaluator };
  queuePersistedRun(event.run, type, config);
  void publishRunEvent(event).catch((error) => console.error("[compare] run event publish failed", error));
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
    status: run.status,
    paused: run.paused,
    controlVersion: run.controlVersion,
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
