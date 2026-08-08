import { describe, expect, it } from "vitest";
import type { ModelResult, Scenario, TestRun } from "./contracts";
import {
  EMPTY_RESPONSE_THRESHOLD,
  TPS_ZSCORE_THRESHOLD,
  buildAnomalyDashboard,
  criticalZScore,
  detectEmptyResponses,
  detectFailedEvals,
  detectTpsOutliers,
} from "./anomalies";

const SCENARIO_ID = "2787b2a8-4daa-4b2b-ac02-94888ec9c892";

const scenarios: Scenario[] = [
  {
    id: SCENARIO_ID,
    name: "Escenario de Memoria",
    category: "GENERAL",
    attackType: null,
    systemPrompt: "Eres un asistente con memoria.",
    userMessages: ["Recuerda mi nombre: Ana"],
    createdAt: "2026-08-07T00:00:00.000Z",
    updatedAt: "2026-08-07T00:00:00.000Z",
  },
];

function makeResult(overrides: Partial<ModelResult> = {}): ModelResult {
  return {
    id: crypto.randomUUID(),
    modelName: "qwen3:4b",
    sampleIndex: 0,
    status: "COMPLETED",
    evalStatus: "COMPLETED",
    responseText: "Esta es una respuesta completa y suficientemente larga.",
    turns: [],
    evaluation: null,
    ttftMs: 100,
    inputTokens: 50,
    outputTokens: 40,
    tokPerSec: 20,
    totalDurationMs: 2000,
    humanStatus: "UNREVIEWED",
    humanNotes: "",
    errorMessage: null,
    ...overrides,
  };
}

function makeRun(overrides: Partial<TestRun> = {}): TestRun {
  return {
    id: `run-${crypto.randomUUID()}`,
    category: "GENERAL",
    attackType: null,
    status: "COMPLETED",
    paused: false,
    controlVersion: 0,
    scenarioId: SCENARIO_ID,
    samplesPerModel: 1,
    systemPrompt: "Be concise.",
    userMessages: ["Say hello."],
    models: ["qwen3:4b"],
    parameters: { temperature: 0.2, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 64 },
    evaluatorModel: null,
    results: [],
    createdAt: "2026-08-07T12:00:00.000Z",
    updatedAt: "2026-08-07T12:00:00.000Z",
    startedAt: "2026-08-07T12:00:00.000Z",
    finishedAt: "2026-08-07T12:05:00.000Z",
    errorMessage: null,
    ...overrides,
  };
}

describe("detectEmptyResponses", () => {
  it("flags COMPLETED results whose trimmed response is shorter than the threshold", () => {
    const run = makeRun({
      results: [
        makeResult({ responseText: "Hola" }),
        makeResult({ sampleIndex: 1, responseText: `   ${"x".repeat(EMPTY_RESPONSE_THRESHOLD)}   ` }),
      ],
    });

    const anomalies = detectEmptyResponses(run, "Escenario de Memoria");

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]).toMatchObject({
      modelName: "qwen3:4b",
      sampleIndex: 0,
      responseLength: 4,
      scenarioName: "Escenario de Memoria",
      runId: run.id,
    });
  });

  it("flags COMPLETED results with a null response as empty", () => {
    const run = makeRun({ results: [makeResult({ responseText: null })] });

    const anomalies = detectEmptyResponses(run, null);

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].responseLength).toBe(0);
    expect(anomalies[0].responseExcerpt).toContain("vacía");
  });

  it("does not flag responses at or above the threshold", () => {
    const run = makeRun({
      results: [makeResult({ responseText: "x".repeat(EMPTY_RESPONSE_THRESHOLD) })],
    });

    expect(detectEmptyResponses(run, null)).toHaveLength(0);
  });

  it("does not flag non-COMPLETED results even when empty", () => {
    const run = makeRun({
      results: [
        makeResult({ status: "FAILED", responseText: null }),
        makeResult({ status: "CANCELLED", sampleIndex: 1, responseText: "" }),
      ],
    });

    expect(detectEmptyResponses(run, null)).toHaveLength(0);
  });
});

describe("detectFailedEvals", () => {
  it("flags FAILED evals regardless of run status", () => {
    const run = makeRun({
      status: "RUNNING",
      results: [makeResult({ evalStatus: "FAILED", errorMessage: "Evaluator timeout" })],
    });

    const anomalies = detectFailedEvals(run, null);

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]).toMatchObject({ evalStatus: "FAILED", errorMessage: "Evaluator timeout" });
  });

  it("flags RUNNING evals as orphans when the run is finished", () => {
    const run = makeRun({
      status: "COMPLETED",
      results: [makeResult({ evalStatus: "RUNNING" })],
    });

    const anomalies = detectFailedEvals(run, null);

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].evalStatus).toBe("RUNNING");
  });

  it("does not flag RUNNING evals while the run is still active", () => {
    const run = makeRun({
      status: "RUNNING",
      results: [makeResult({ evalStatus: "RUNNING" })],
    });

    expect(detectFailedEvals(run, null)).toHaveLength(0);
  });

  it("marks retryable only when a response is stored", () => {
    const run = makeRun({
      status: "COMPLETED",
      results: [
        makeResult({ evalStatus: "FAILED", responseText: "respuesta evaluable" }),
        makeResult({ sampleIndex: 1, evalStatus: "FAILED", responseText: null }),
      ],
    });

    const anomalies = detectFailedEvals(run, null);

    expect(anomalies).toHaveLength(2);
    expect(anomalies[0].retryable).toBe(true);
    expect(anomalies[1].retryable).toBe(false);
  });
});

describe("detectTpsOutliers", () => {
  function runWithTps(modelName: string, tpsValues: number[], startIndex = 0): TestRun {
    return makeRun({
      models: [modelName],
      scenarioId: null,
      results: tpsValues.map((tps, i) =>
        makeResult({ modelName, sampleIndex: startIndex + i, tokPerSec: tps }),
      ),
    });
  }

  it("flags samples whose |z-score| exceeds the threshold", () => {
    const tpsValues = [
      20, 21, 19, 20, 22, 20, 21, 19, 20, 21, 20, 19, 22, 20, 21, 20, 19, 20, 22, 21, 20, 19, 20, 21,
      500,
    ];
    const run = runWithTps("modelo-estable", tpsValues);

    const anomalies = detectTpsOutliers([run]);

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].sampleIndex).toBe(24);
    expect(anomalies[0].zScore).toBeGreaterThan(TPS_ZSCORE_THRESHOLD);
    expect(anomalies[0].modelSampleSize).toBe(tpsValues.length);
    expect(anomalies[0].criticalZScore).toBe(TPS_ZSCORE_THRESHOLD);
  });

  it("flags low outliers (degradation) as well", () => {
    const tpsValues = [
      20, 21, 19, 20, 22, 20, 21, 19, 20, 21, 20, 19, 22, 20, 21, 20, 19, 20, 22, 21, 20, 19, 20, 21,
      0.1,
    ];
    const run = runWithTps("modelo-degradado", tpsValues);

    const anomalies = detectTpsOutliers([run]);

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].sampleIndex).toBe(24);
    expect(anomalies[0].zScore).toBeLessThan(-TPS_ZSCORE_THRESHOLD);
  });

  it("caps the threshold by the Samuelson bound for small sample sizes", () => {
    const tpsValues = [20, 21, 19, 20, 22, 20, 21, 19, 20, 120];
    const run = runWithTps("modelo-pequeno", tpsValues);

    const anomalies = detectTpsOutliers([run]);

    expect(anomalies).toHaveLength(0);
    expect(criticalZScore(tpsValues.length)).toBeLessThan(TPS_ZSCORE_THRESHOLD);
  });

  it("ignores models with fewer than the minimum sample size", () => {
    const run = runWithTps("modelo-chico", [20, 21, 1000]);

    expect(detectTpsOutliers([run])).toHaveLength(0);
  });

  it("ignores results without tokPerSec and non-COMPLETED results", () => {
    const run = makeRun({
      scenarioId: null,
      results: [
        makeResult({ tokPerSec: null }),
        makeResult({ sampleIndex: 1, status: "FAILED", tokPerSec: 1000 }),
      ],
    });

    expect(detectTpsOutliers([run])).toHaveLength(0);
  });
});

describe("buildAnomalyDashboard", () => {
  it("assembles all three sections and counts", () => {
    const emptyRun = makeRun({
      id: "run-empty",
      results: [makeResult({ responseText: "ok" })],
    });
    const evalRun = makeRun({
      id: "run-eval",
      status: "COMPLETED",
      results: [makeResult({ sampleIndex: 0, evalStatus: "FAILED", errorMessage: "boom" })],
    });
    const tpsRun = makeRun({
      id: "run-tps",
      scenarioId: null,
      results: Array.from({ length: 25 }, (_, i) =>
        makeResult({ sampleIndex: i, modelName: "outlier-model", tokPerSec: i === 24 ? 500 : 20 }),
      ),
    });

    const dashboard = buildAnomalyDashboard([tpsRun, evalRun, emptyRun], scenarios);

    expect(dashboard.counts.emptyResponses).toBe(1);
    expect(dashboard.counts.failedEvals).toBe(1);
    expect(dashboard.counts.tpsOutliers).toBe(1);
    expect(dashboard.emptyResponses[0]).toMatchObject({
      runId: "run-empty",
      scenarioName: "Escenario de Memoria",
    });
    expect(dashboard.failedEvals[0]).toMatchObject({ runId: "run-eval", retryable: true });
    expect(dashboard.tpsOutliers[0]).toMatchObject({ runId: "run-tps", scenarioName: null });
  });

  it("returns an empty dashboard for no runs", () => {
    const dashboard = buildAnomalyDashboard([], []);

    expect(dashboard.counts).toEqual({ emptyResponses: 0, failedEvals: 0, tpsOutliers: 0 });
    expect(dashboard.emptyResponses).toEqual([]);
    expect(dashboard.failedEvals).toEqual([]);
    expect(dashboard.tpsOutliers).toEqual([]);
  });
});
