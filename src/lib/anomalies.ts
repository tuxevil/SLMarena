import type { ModelResult, Scenario, TestRun } from "@/lib/contracts";

export const EMPTY_RESPONSE_THRESHOLD = 15;
export const TPS_ZSCORE_THRESHOLD = 3.5;
export const TPS_MIN_SAMPLE_SIZE = 5;
export const MAX_ANOMALIES_PER_SECTION = 200;

export function criticalZScore(sampleSize: number): number {
  if (sampleSize < 2) return Infinity;
  const samuelsonBound = (sampleSize - 1) / Math.sqrt(sampleSize);
  return Math.min(TPS_ZSCORE_THRESHOLD, samuelsonBound);
}

export type EmptyResponseAnomaly = {
  resultId: string;
  runId: string;
  runCreatedAt: string;
  scenarioId: string | null;
  scenarioName: string | null;
  modelName: string;
  sampleIndex: number;
  responseLength: number;
  responseExcerpt: string;
};

export type FailedEvalAnomaly = {
  resultId: string;
  runId: string;
  runCreatedAt: string;
  scenarioId: string | null;
  scenarioName: string | null;
  modelName: string;
  sampleIndex: number;
  evalStatus: "FAILED" | "RUNNING";
  errorMessage: string | null;
  retryable: boolean;
};

export type TpsOutlierAnomaly = {
  resultId: string;
  runId: string;
  runCreatedAt: string;
  scenarioId: string | null;
  scenarioName: string | null;
  modelName: string;
  sampleIndex: number;
  tokPerSec: number;
  modelMeanTokPerSec: number;
  modelStdDevTokPerSec: number;
  modelSampleSize: number;
  zScore: number;
  criticalZScore: number;
  inputTokens: number | null;
  outputTokens: number | null;
};

export type AnomalyDashboard = {
  generatedAt: string;
  emptyResponses: EmptyResponseAnomaly[];
  failedEvals: FailedEvalAnomaly[];
  tpsOutliers: TpsOutlierAnomaly[];
  counts: {
    emptyResponses: number;
    failedEvals: number;
    tpsOutliers: number;
  };
};

export function emptyAnomalyDashboard(): AnomalyDashboard {
  return {
    generatedAt: new Date().toISOString(),
    emptyResponses: [],
    failedEvals: [],
    tpsOutliers: [],
    counts: { emptyResponses: 0, failedEvals: 0, tpsOutliers: 0 },
  };
}

export function detectEmptyResponses(run: TestRun, scenarioName: string | null): EmptyResponseAnomaly[] {
  const anomalies: EmptyResponseAnomaly[] = [];
  for (const result of run.results) {
    if (result.status !== "COMPLETED") continue;
    const responseLength = (result.responseText ?? "").trim().length;
    if (responseLength >= EMPTY_RESPONSE_THRESHOLD) continue;
    anomalies.push({
      resultId: result.id,
      runId: run.id,
      runCreatedAt: run.createdAt,
      scenarioId: run.scenarioId,
      scenarioName,
      modelName: result.modelName,
      sampleIndex: result.sampleIndex,
      responseLength,
      responseExcerpt: (result.responseText ?? "").trim().slice(0, 120) || "(respuesta vacía)",
    });
  }
  return anomalies;
}

export function detectFailedEvals(run: TestRun, scenarioName: string | null): FailedEvalAnomaly[] {
  const runFinished = ["COMPLETED", "CANCELLED", "FAILED"].includes(run.status);
  const anomalies: FailedEvalAnomaly[] = [];
  for (const result of run.results) {
    const failed = result.evalStatus === "FAILED";
    const orphaned = runFinished && result.evalStatus === "RUNNING";
    if (!failed && !orphaned) continue;
    anomalies.push({
      resultId: result.id,
      runId: run.id,
      runCreatedAt: run.createdAt,
      scenarioId: run.scenarioId,
      scenarioName,
      modelName: result.modelName,
      sampleIndex: result.sampleIndex,
      evalStatus: orphaned ? "RUNNING" : "FAILED",
      errorMessage: result.errorMessage,
      retryable: Boolean(result.responseText?.trim()),
    });
  }
  return anomalies;
}

export function detectTpsOutliers(runs: TestRun[]): TpsOutlierAnomaly[] {
  const samples: { run: TestRun; result: ModelResult }[] = [];
  const valuesByModel = new Map<string, number[]>();
  for (const run of runs) {
    for (const result of run.results) {
      if (result.status !== "COMPLETED" || result.tokPerSec == null) continue;
      samples.push({ run, result });
      const values = valuesByModel.get(result.modelName) ?? [];
      values.push(result.tokPerSec);
      valuesByModel.set(result.modelName, values);
    }
  }

  const statsByModel = new Map<string, { mean: number; std: number; count: number; critical: number }>();
  for (const [modelName, values] of valuesByModel) {
    if (values.length < TPS_MIN_SAMPLE_SIZE) continue;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
    statsByModel.set(modelName, {
      mean,
      std: Math.sqrt(variance),
      count: values.length,
      critical: criticalZScore(values.length),
    });
  }

  const anomalies: TpsOutlierAnomaly[] = [];
  for (const { run, result } of samples) {
    const stats = statsByModel.get(result.modelName);
    if (!stats || stats.std === 0) continue;
    const zScore = (result.tokPerSec! - stats.mean) / stats.std;
    if (Math.abs(zScore) <= stats.critical) continue;
    anomalies.push({
      resultId: result.id,
      runId: run.id,
      runCreatedAt: run.createdAt,
      scenarioId: run.scenarioId,
      scenarioName: null,
      modelName: result.modelName,
      sampleIndex: result.sampleIndex,
      tokPerSec: result.tokPerSec!,
      modelMeanTokPerSec: stats.mean,
      modelStdDevTokPerSec: stats.std,
      modelSampleSize: stats.count,
      zScore,
      criticalZScore: stats.critical,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    });
  }
  return anomalies;
}

export function buildAnomalyDashboard(runs: TestRun[], scenarios: Scenario[]): AnomalyDashboard {
  const scenarioNames = new Map((scenarios ?? []).map((scenario) => [scenario.id, scenario.name]));
  const runsByCreatedAt = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const emptyResponses = runsByCreatedAt.flatMap((run) =>
    detectEmptyResponses(run, run.scenarioId ? scenarioNames.get(run.scenarioId) ?? null : null),
  );
  const failedEvals = runsByCreatedAt.flatMap((run) =>
    detectFailedEvals(run, run.scenarioId ? scenarioNames.get(run.scenarioId) ?? null : null),
  );
  const tpsOutliers = detectTpsOutliers(runsByCreatedAt).map((anomaly) => ({
    ...anomaly,
    scenarioName: anomaly.scenarioId ? scenarioNames.get(anomaly.scenarioId) ?? null : null,
  }));

  const trim = <T,>(items: T[]) => items.slice(0, MAX_ANOMALIES_PER_SECTION);

  return {
    generatedAt: new Date().toISOString(),
    emptyResponses: trim(emptyResponses),
    failedEvals: trim(failedEvals),
    tpsOutliers: trim(tpsOutliers),
    counts: {
      emptyResponses: emptyResponses.length,
      failedEvals: failedEvals.length,
      tpsOutliers: tpsOutliers.length,
    },
  };
}
