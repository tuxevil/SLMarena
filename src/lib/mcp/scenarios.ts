import { z } from "zod";
import { slmarenaFetch } from "./http-client";

export const listTestInputSchema = {
  category: z.enum(["GENERAL", "SECURITY"]).optional().describe("Filtrar escenarios por categoría."),
};

export type ListScenariosInput = { category?: "GENERAL" | "SECURITY" };

export type Scenario = {
  id: string;
  name: string;
  category: "GENERAL" | "SECURITY";
  attackType: string | null;
  systemPrompt: string;
  userMessages: string[];
  createdAt: string;
  updatedAt: string;
};

type ScenariosPayload = { scenarios: Scenario[] };

export async function listTestScenarios(args: ListScenariosInput): Promise<unknown> {
  const data = await slmarenaFetch<ScenariosPayload>("/api/scenarios");
  const scenarios = data.scenarios ?? [];
  return {
    scenarios: args.category ? scenarios.filter((s) => s.category === args.category) : scenarios,
  };
}

export const createScenarioInputSchema = {
  name: z.string().min(1).max(255).describe("Nombre descriptivo del escenario."),
  category: z.enum(["GENERAL", "SECURITY"]).default("GENERAL"),
  attack_vector: z
    .enum([
      "INSTRUCTION_OVERRIDE",
      "SYSTEM_PROMPT_LEAKAGE",
      "INDIRECT_PROMPT_INJECTION",
      "DELIMITER_HIJACKING",
      "CONTEXT_OVERSTUFFING",
      "ENCODING_OBFUSCATION",
      "TOOL_PARAMETER_HIJACKING",
      "REFUSAL_SUPPRESSION",
    ])
    .optional()
    .describe("Tipo de ataque si el escenario es de seguridad."),
  system_prompt: z.string().min(1).max(50_000).describe("Las instrucciones base del System Prompt para el modelo local."),
  user_messages: z.array(z.string().min(1).max(50_000)).min(1).max(100).describe("Secuencia de mensajes de usuario a evaluar."),
};

export type CreateScenarioInput = {
  name: string;
  category: "GENERAL" | "SECURITY";
  attack_vector?: string;
  system_prompt: string;
  user_messages: string[];
};

export async function createTestScenario(args: CreateScenarioInput): Promise<unknown> {
  const body = {
    name: args.name,
    category: args.category,
    attackType: args.attack_vector ?? null,
    systemPrompt: args.system_prompt,
    userMessages: args.user_messages,
  };
  const data = await slmarenaFetch<{ scenario: Scenario }>("/api/scenarios", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return { scenario: data.scenario };
}