import { describe, expect, it } from "vitest";
import { aggregateLeaderboard, extractParamSize, queuePersistedRun, waitForPersistedRun } from "@/lib/database";
import type { Evaluation, ModelResult, TestRun } from "./contracts";

const TEST_MODEL = "eval-fail-test:2b";

function makeEvaluation(overrides: Partial<Evaluation> = {}): Evaluation {
  return {
    evaluatorModel: "juez-1",
    grammarRating: 5,
    complianceRating: 5,
    accuracyRating: 5,
    scoreStars: 5,
    grammarAnalysis: "",
    complianceAnalysis: "",
    accuracyAnalysis: "",
    feedbackText: "",
    rawJson: null,
    securityScore: null,
    injectionSuccessful: null,
    systemLeakageDetected: null,
    vulnerabilityAnalysis: null,
    ...overrides,
  };
}

function makeResult(overrides: Partial<ModelResult> = {}): ModelResult {
  return {
    id: crypto.randomUUID(),
    modelName: TEST_MODEL,
    sampleIndex: 0,
    status: "COMPLETED",
    evalStatus: "COMPLETED",
    responseText: "respuesta",
    turns: [],
    evaluation: makeEvaluation(),
    humanStatus: "UNREVIEWED",
    humanNotes: "",
    errorMessage: null,
    ttftMs: 100,
    inputTokens: 10,
    outputTokens: 20,
    tokPerSec: 5,
    totalDurationMs: 1000,
    ...overrides,
  };
}

function makeRun(overrides: Partial<TestRun> = {}): TestRun {
  return {
    id: crypto.randomUUID(),
    category: "GENERAL",
    attackType: null,
    status: "COMPLETED",
    paused: false,
    controlVersion: 1,
    scenarioId: null,
    samplesPerModel: 1,
    systemPrompt: "Eres un asistente.",
    userMessages: ["Hola"],
    models: [TEST_MODEL],
    parameters: { temperature: 0.2, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 4096 },
    evaluatorModel: null,
    results: [makeResult()],
    createdAt: "2026-08-07T00:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    errorMessage: null,
    ...overrides,
  };
}

async function persistRun(run: TestRun) {
  queuePersistedRun(run, "run.created", { ollamaUrl: "http://localhost:11434" });
  await waitForPersistedRun(run.id);
}

describe("Leaderboard Unit Tests (SLMArena v1.3)", () => {
  it("extracts model parameter sizes correctly from names", () => {
    expect(extractParamSize("Qwen-2.5-7B")).toEqual({ label: "7.6B", value: 7.6 });
    expect(extractParamSize("llama3.2:3b")).toEqual({ label: "3.2B", value: 3.2 });
    expect(extractParamSize("phi-3.5-mini")).toEqual({ label: "3.8B", value: 3.8 });
    expect(extractParamSize("gemma2:9b")).toEqual({ label: "9.0B", value: 9.0 });
    expect(extractParamSize("custom-model-14b")).toEqual({ label: "14B", value: 14 });
    expect(extractParamSize("unknown-slm-model")).toEqual({ label: "3.0B", value: 3.0 });
  });

  it("calculates aggregate leaderboard telemetry and Arena Index", async () => {
    const data = await aggregateLeaderboard({
      category: "ALL",
      weights: { quality: 40, security: 40, speed: 20 },
    });

    expect(data.weights).toEqual({ quality: 40, security: 40, speed: 20 });
    expect(data.kpis).toBeDefined();
    expect(Array.isArray(data.models)).toBe(true);
  });

  it("excludes failed evaluations from run counts and reports them separately", async () => {
    await persistRun(
      makeRun({
        results: [
          makeResult({ evalStatus: "FAILED", evaluation: null, errorMessage: "Judge returned invalid JSON" }),
        ],
      }),
    );
    await persistRun(makeRun({ results: [makeResult()] }));

    const data = await aggregateLeaderboard({ category: "ALL" });
    const row = data.models.find((m) => m.modelName === TEST_MODEL);

    expect(row).toBeDefined();
    expect(row!.totalRuns).toBe(1);
    expect(row!.failedEvals).toBe(1);
    expect(row!.avgQualityStars).toBe(5);
    expect(row!.avgTokPerSec).toBe(5);
  });
});
