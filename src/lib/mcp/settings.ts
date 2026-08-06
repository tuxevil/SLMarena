import { z } from "zod";
import { slmarenaFetch } from "./http-client";

export type Settings = {
  ollamaUrl: string;
  evaluatorBaseUrl: string;
  evaluatorModel: string;
  evaluatorApiKeyConfigured: boolean;
  parameters: {
    temperature: number;
    numCtx: number;
    topP: number;
    repeatPenalty: number;
    numPredict: number;
  };
};

type SettingsPayload = { settings: Settings };

export async function getSettings(): Promise<unknown> {
  const data = await slmarenaFetch<SettingsPayload>("/api/settings");
  return { settings: data.settings };
}

const settingsParametersInput = z
  .object({
    temperature: z.number().min(0).max(2).optional(),
    num_ctx: z.number().int().min(128).max(131_072).optional(),
    top_p: z.number().min(0).max(1).optional(),
    repeat_penalty: z.number().min(0).max(3).optional(),
    num_predict: z.number().int().min(1).max(32_768).optional(),
  })
  .optional()
  .describe("Hiperparámetros de inferencia por defecto (opcional).");

export const updateSettingsInputSchema = {
  ollama_url: z.string().url().optional().describe("Nueva URL base del servidor Ollama."),
  evaluator_base_url: z.string().url().optional().describe("Nueva URL base del evaluador OpenAI-compatible."),
  evaluator_model: z.string().max(255).optional().describe("Nombre del modelo juez."),
  evaluator_api_key: z.string().max(4096).optional().describe("API key del evaluador; se guarda cifrada."),
  clear_evaluator_api_key: z.boolean().optional().describe("Si es true, borra la API key guardada."),
  parameters: settingsParametersInput,
};

export type UpdateSettingsInput = {
  ollama_url?: string;
  evaluator_base_url?: string;
  evaluator_model?: string;
  evaluator_api_key?: string;
  clear_evaluator_api_key?: boolean;
  parameters?: Record<string, unknown>;
};

function toCamelParams(raw: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  const map: Record<string, string> = {
    temperature: "temperature",
    num_ctx: "numCtx",
    top_p: "topP",
    repeat_penalty: "repeatPenalty",
    num_predict: "numPredict",
  };
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const target = map[key];
    if (target && value != null) result[target] = value;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export async function updateSettings(args: UpdateSettingsInput): Promise<unknown> {
  const body: Record<string, unknown> = {};
  if (args.ollama_url) body.ollamaUrl = args.ollama_url;
  if (args.evaluator_base_url !== undefined) body.evaluatorBaseUrl = args.evaluator_base_url;
  if (args.evaluator_model !== undefined) body.evaluatorModel = args.evaluator_model;
  if (args.evaluator_api_key !== undefined) body.evaluatorApiKey = args.evaluator_api_key;
  if (args.clear_evaluator_api_key !== undefined) body.clearEvaluatorApiKey = args.clear_evaluator_api_key;
  const parameters = toCamelParams(args.parameters);
  if (parameters) body.parameters = parameters;

  const data = await slmarenaFetch<SettingsPayload>("/api/settings", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return { settings: data.settings };
}
