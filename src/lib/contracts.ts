import { z } from "zod";
import { validateEvaluatorEndpoint } from "@/lib/endpoints";

export const httpUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith("http://") || value.startsWith("https://"), "URL must use HTTP or HTTPS.");

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

export const createRunSchema = z.object({
  ollamaUrl: httpUrlSchema,
  systemPrompt: z.string().trim().min(1).max(50_000),
  userMessages: z.array(z.string().trim().min(1).max(50_000)).min(1).max(100),
  models: z
    .array(z.string().trim().min(1).max(255))
    .min(1)
    .max(50)
    .refine((models) => new Set(models).size === models.length, "Models must be unique."),
  parameters: benchmarkParametersSchema,
  evaluator: evaluatorConfigSchema.optional(),
});

export const humanReviewSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED", "REVIEWED", "UNREVIEWED"]),
  notes: z.string().max(10_000).optional().default(""),
});

export const settingsUpdateSchema = z.object({
  ollamaUrl: httpUrlSchema,
  evaluatorBaseUrl: z.union([
    z.literal(""),
    httpUrlSchema.refine((value) => !validateEvaluatorEndpoint(value), "Evaluator endpoint must use HTTPS unless local."),
  ]),
  evaluatorModel: z.string().trim().max(255),
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
export type CreateRunInput = z.infer<typeof createRunSchema>;
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
  grammarAnalysis: string;
  complianceAnalysis: string;
  accuracyAnalysis: string;
  feedbackText: string;
  rawJson: unknown;
};

export type ModelResult = Telemetry & {
  id: string;
  modelName: string;
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
  status: RunStatus;
  paused: boolean;
  controlVersion: number;
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

export type PromptTemplate = {
  id: string;
  title: string;
  systemPrompt: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type TestSuite = {
  id: string;
  name: string;
  description: string;
  promptTemplateId: string | null;
  userMessages: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type RunEvent = {
  id: number;
  type: string;
  run: TestRun;
  createdAt: string;
};
