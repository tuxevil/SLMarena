import { z } from "zod";
import { validateEvaluatorEndpoint } from "@/lib/endpoints";

export const httpUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith("http://") || value.startsWith("https://"), "URL must use HTTP or HTTPS.");

export const testCategorySchema = z.enum(["GENERAL", "SECURITY"]);
export const securityAttackTypeSchema = z.enum([
  "INSTRUCTION_OVERRIDE",
  "SYSTEM_PROMPT_LEAKAGE",
  "INDIRECT_PROMPT_INJECTION",
]);

export type TestCategory = z.infer<typeof testCategorySchema>;
export type SecurityAttackType = z.infer<typeof securityAttackTypeSchema>;

export const benchmarkParametersSchema = z.object({
  temperature: z.number().min(0).max(2),
  numCtx: z.number().int().min(128).max(131_072),
  topP: z.number().min(0).max(1),
  repeatPenalty: z.number().min(0).max(3),
  numPredict: z.number().int().min(1).max(32_768),
});

export const evaluatorConfigSchema = z.object({
  baseUrl: httpUrlSchema.refine((value) => !validateEvaluatorEndpoint(value), "Evaluator endpoint must use HTTPS unless local."),
  apiKey: z.string().min(1).max(4_096),
  model: z.string().trim().min(1).max(255),
});

export const createRunSchema = z
  .object({
    ollamaUrl: httpUrlSchema,
    scenarioId: z.string().uuid().nullable().optional(),
    samplesPerModel: z.number().int().min(1).max(10).default(1),
    category: testCategorySchema.default("GENERAL"),
    attackType: securityAttackTypeSchema.nullable().optional(),
    systemPrompt: z.string().trim().min(1).max(50_000),
    userMessages: z.array(z.string().trim().min(1).max(50_000)).min(1).max(100),
    models: z
      .array(z.string().trim().min(1).max(255))
      .min(1)
      .max(50)
      .refine((models) => new Set(models).size === models.length, "Models must be unique."),
    parameters: benchmarkParametersSchema,
    evaluator: evaluatorConfigSchema.optional(),
  })
  .refine(
    (data) => data.category !== "SECURITY" || Boolean(data.attackType),
    {
      message: "An attack type must be specified for security tests.",
      path: ["attackType"],
    }
  );

export const humanReviewSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED", "REVIEWED", "UNREVIEWED"]),
  notes: z.string().max(10_000).optional().default(""),
});

export const settingsUpdateSchema = z.object({
  ollamaUrl: httpUrlSchema.optional(),
  evaluatorBaseUrl: z
    .union([
      z.literal(""),
      httpUrlSchema.refine((value) => !validateEvaluatorEndpoint(value), "Evaluator endpoint must use HTTPS unless local."),
    ])
    .optional(),
  evaluatorModel: z.string().trim().max(255).optional(),
  evaluatorApiKey: z
    .string()
    .max(4_096)
    .nullish()
    .transform((value) => value ?? undefined),
  clearEvaluatorApiKey: z.boolean().default(false),
  parameters: benchmarkParametersSchema.optional(),
});

export type BenchmarkParameters = z.infer<typeof benchmarkParametersSchema>;
export type EvaluatorConfig = z.infer<typeof evaluatorConfigSchema>;
export type CreateRunInput = z.input<typeof createRunSchema>;
export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;

export type RunStatus = "PENDING" | "RUNNING" | "COMPLETED" | "CANCELLED" | "FAILED";
export type ModelStatus = "PENDING" | "INFERRING" | "EVALUATING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type EvaluationStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED";
export type HumanStatus = "APPROVED" | "REJECTED" | "REVIEWED" | "UNREVIEWED";

export type Telemetry = {
  ttftMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  tokPerSec: number | null;
  totalDurationMs: number | null;
};

export type TurnResult = Telemetry & {
  id: string;
  stepOrder: number;
  userMessage: string;
  responseText: string;
  thinking: string | null;
};

export type Evaluation = {
  evaluatorModel: string;
  grammarRating: number | null;
  complianceRating: number | null;
  accuracyRating: number | null;
  scoreStars: number | null;
  grammarAnalysis: string | null;
  complianceAnalysis: string | null;
  accuracyAnalysis: string | null;
  feedbackText: string;
  rawJson: unknown;
  securityScore: number | null;
  injectionSuccessful: boolean | null;
  systemLeakageDetected: boolean | null;
  vulnerabilityAnalysis: string | null;
};

export type ModelResult = Telemetry & {
  id: string;
  modelName: string;
  sampleIndex: number;
  status: ModelStatus;
  evalStatus: EvaluationStatus;
  responseText: string | null;
  turns: TurnResult[];
  evaluation: Evaluation | null;
  humanStatus: HumanStatus;
  humanNotes: string;
  errorMessage: string | null;
};

export type TestRun = {
  id: string;
  category: TestCategory;
  attackType: SecurityAttackType | null;
  status: RunStatus;
  paused: boolean;
  controlVersion: number;
  scenarioId: string | null;
  samplesPerModel: number;
  systemPrompt: string;
  userMessages: string[];
  models: string[];
  parameters: BenchmarkParameters;
  evaluatorModel: string | null;
  results: ModelResult[];
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
};

export type AppSettings = {
  ollamaUrl: string;
  evaluatorBaseUrl: string;
  evaluatorModel: string;
  evaluatorApiKeyConfigured: boolean;
  parameters: BenchmarkParameters;
};

export type Scenario = {
  id: string;
  name: string;
  category: TestCategory;
  attackType: SecurityAttackType | null;
  systemPrompt: string;
  userMessages: string[];
  createdAt: string;
  updatedAt: string;
};

export const scenarioSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    category: testCategorySchema.default("GENERAL"),
    attackType: securityAttackTypeSchema.nullish().transform((v) => v ?? null),
    systemPrompt: z.string().trim().min(1).max(50_000),
    userMessages: z.array(z.string().trim().min(1).max(50_000)).min(1).max(100),
  })
  .refine(
    (data) => data.category !== "SECURITY" || Boolean(data.attackType),
    {
      message: "An attack type must be specified for security scenarios.",
      path: ["attackType"],
    }
  );

export type ScenarioInput = z.infer<typeof scenarioSchema>;

export type RunEvent = {
  id: number;
  type: string;
  run: TestRun;
  createdAt: string;
};
