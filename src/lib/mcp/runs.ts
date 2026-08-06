import { z } from "zod";
import { slmarenaFetch } from "./http-client";
import type { Scenario } from "./scenarios";

export const runDetailsInputSchema = {
  run_id: z.string().min(1).describe("ID de la ejecución (UUID) a inspeccionar."),
};

export type RunDetailsInput = { run_id: string };

export type TestRun = {
  id: string;
  category: "GENERAL" | "SECURITY";
  attackType: string | null;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "CANCELLED" | "FAILED";
  paused: boolean;
  scenarioId: string | null;
  samplesPerModel: number;
  systemPrompt: string;
  userMessages: string[];
  models: string[];
  parameters: Record<string, unknown>;
  evaluatorModel: string | null;
  results: Array<{
    id: string;
    modelName: string;
    status: string;
    evalStatus: string;
    responseText: string | null;
    evaluation: unknown;
    [key: string]: unknown;
  }>;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
};

type RunPayload = { run: TestRun };

export async function getTestRunDetails(args: RunDetailsInput): Promise<unknown> {
  const data = await slmarenaFetch<RunPayload>(`/api/runs/${encodeURIComponent(args.run_id)}`);
  return { run: data.run };
}

const benchmarkParametersInput = z
  .object({
    temperature: z.number().min(0).max(2).optional(),
    numCtx: z.number().int().min(128).max(131_072).optional(),
    topP: z.number().min(0).max(1).optional(),
    repeatPenalty: z.number().min(0).max(3).optional(),
    numPredict: z.number().int().min(1).max(32_768).optional(),
  })
  .passthrough();

export const launchMatrixInputSchema = {
  target_models: z.array(z.string().min(1)).min(1).max(50).describe("Modelos a evaluar. Usa [\"ALL\"] para todos los modelos de Ollama."),
  scenario_ids: z.array(z.string().min(1)).min(1).max(50).describe("IDs de escenarios a aplicar. Usa [\"ALL_SECURITY\"] para todos los escenarios de seguridad."),
  parameters: benchmarkParametersInput.optional().describe("Configuraciones de inferencia (temperature, numCtx, topP, repeatPenalty, numPredict)."),
};

export type LaunchMatrixInput = {
  target_models: string[];
  scenario_ids: string[];
  parameters?: Record<string, unknown>;
};

type SettingsPayload = {
  settings: {
    ollamaUrl: string;
    parameters: {
      temperature: number;
      numCtx: number;
      topP: number;
      repeatPenalty: number;
      numPredict: number;
    };
  };
};

type OllamaModelsPayload = { models: Array<{ name: string; size?: string }> };

type RunCreateResponse = { run: TestRun };

async function resolveModels(targetModels: string[]): Promise<string[]> {
  const models: string[] = [];
  for (const target of targetModels) {
    if (target === "ALL") {
      const data = await slmarenaFetch<OllamaModelsPayload>("/api/ollama/models");
      models.push(...(data.models ?? []).map((m) => m.name));
    } else {
      models.push(target);
    }
  }
  return [...new Set(models)];
}

async function resolveScenarios(scenarioIds: string[]): Promise<Scenario[]> {
  const data = await slmarenaFetch<{ scenarios: Scenario[] }>("/api/scenarios");
  const all = data.scenarios ?? [];
  const selected: Scenario[] = [];
  for (const id of scenarioIds) {
    if (id === "ALL_SECURITY") {
      selected.push(...all.filter((s) => s.category === "SECURITY"));
    } else if (id === "ALL") {
      selected.push(...all);
    } else {
      const found = all.find((s) => s.id === id);
      if (found) selected.push(found);
    }
  }
  return selected;
}

function normalizeParameters(raw: Record<string, unknown> | undefined, defaults: Record<string, unknown>) {
  const result = { ...defaults };
  if (!raw) return result;
  const map: Record<string, keyof typeof result> = {
    temperature: "temperature",
    num_ctx: "numCtx",
    numCtx: "numCtx",
    top_p: "topP",
    topP: "topP",
    repeat_penalty: "repeatPenalty",
    repeatPenalty: "repeatPenalty",
    num_predict: "numPredict",
    numPredict: "numPredict",
  };
  for (const [key, value] of Object.entries(raw)) {
    const target = map[key];
    if (target && value != null) (result as Record<string, unknown>)[target] = value;
  }
  return result;
}

export async function launchMatrixTest(args: LaunchMatrixInput): Promise<unknown> {
  const [settings, scenarios] = await Promise.all([
    slmarenaFetch<SettingsPayload>("/api/settings"),
    resolveScenarios(args.scenario_ids),
  ]);
  const ollamaUrl = settings.settings?.ollamaUrl ?? "http://localhost:11434";
  const defaults = settings.settings?.parameters ?? {};
  const models = await resolveModels(args.target_models);

  if (models.length === 0) {
    throw new Error("No se resolvieron modelos objetivo (revisa target_models o el estado de Ollama).");
  }
  if (scenarios.length === 0) {
    throw new Error("No se resolvieron escenarios (revisa scenario_ids o la categoría solicitada).");
  }

  const parameters = normalizeParameters(args.parameters, defaults);
  const jobs: Array<{ scenario_id: string; scenario_name: string; run_id: string }> = [];

  for (const scenario of scenarios) {
    const body = {
      ollamaUrl,
      scenarioId: scenario.id,
      category: scenario.category,
      attackType: scenario.attackType,
      systemPrompt: scenario.systemPrompt,
      userMessages: scenario.userMessages,
      models,
      parameters,
    };
    const data = await slmarenaFetch<RunCreateResponse>("/api/runs", {
      method: "POST",
      body: JSON.stringify(body),
    });
    jobs.push({ scenario_id: scenario.id, scenario_name: scenario.name, run_id: data.run.id });
  }

  return { jobs };
}

export const jobStatusInputSchema = {
  job_id: z.string().min(1).describe("ID de la ejecución (run_id) devuelto por launch_matrix_test."),
};

export type JobStatusInput = { job_id: string };

export async function checkJobStatus(args: JobStatusInput): Promise<unknown> {
  const data = await slmarenaFetch<RunPayload>(`/api/runs/${encodeURIComponent(args.job_id)}`);
  const run = data.run;
  const total = run.results?.length ?? 0;
  const completed = run.results?.filter((r) => r.status === "COMPLETED").length ?? 0;
  const failed = run.results?.filter((r) => r.status === "FAILED").length ?? 0;
  const progressPct = total > 0 ? Math.round(((completed + failed) / total) * 100) : 0;

  return {
    run_id: run.id,
    status: run.status,
    progress_pct: progressPct,
    paused: run.paused,
    partial_metrics: {
      completed,
      failed,
      total,
      running: run.results?.filter((r) => ["INFERRING", "EVALUATING"].includes(r.status)).length ?? 0,
    },
    error_message: run.errorMessage,
  };
}