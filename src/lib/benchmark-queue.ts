import { evaluateModelResponse, EvaluatorRequestError } from "@/lib/frontier-evaluator";
import { benchmarkStore } from "@/lib/benchmark-store";
import { OllamaRequestError, streamOllamaChat } from "@/lib/ollama-client";
import type { Queue as BullQueue } from "bullmq";
import { redisConnection } from "@/lib/redis-connection";

type QueueJob = { runId: string; execute: () => Promise<void> };

const pendingJobs: QueueJob[] = [];
let activeJobs = 0;
let redisQueue: BullQueue<{ runId: string }> | null = null;

export async function enqueueBenchmark(runId: string) {
  if (process.env.REDIS_URL) {
    if (!process.env.DATABASE_URL) {
      throw new Error("REDIS_URL requires DATABASE_URL so workers can recover run state.");
    }
    const { Queue } = await import("bullmq");
    if (!redisQueue) {
      redisQueue = new Queue("slmarena-benchmarks", { connection: redisConnection() });
      redisQueue.on("error", (error) => console.error("[slmarena] benchmark queue error", error));
    }
    await redisQueue.add("benchmark", { runId }, {
      attempts: 3,
      backoff: { type: "exponential", delay: 1_000 },
      jobId: `benchmark-${runId}`,
      removeOnComplete: { age: 86_400 },
      removeOnFail: { age: 604_800 },
    });
    return;
  }

  pendingJobs.push({ runId, execute: () => executeBenchmark(runId) });
  drainQueue();
}

async function drainQueue() {
  const concurrency = Math.max(1, Number(process.env.BENCHMARK_CONCURRENCY ?? 1));
  while (activeJobs < concurrency && pendingJobs.length > 0) {
    const job = pendingJobs.shift();
    if (!job) return;
    activeJobs += 1;
    void job.execute()
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Benchmark worker failed.";
        const run = benchmarkStore.getStoredRun(job.runId);
        if (run && !["COMPLETED", "FAILED", "CANCELLED"].includes(run.status)) {
          benchmarkStore.updateRun(job.runId, {
            status: "FAILED",
            finishedAt: new Date().toISOString(),
            errorMessage: message,
          });
        }
      })
      .finally(() => {
        activeJobs -= 1;
        void drainQueue();
      });
  }
}

async function executeBenchmark(runId: string) {
  await benchmarkStore.hydrate();
  const run = benchmarkStore.getStoredRun(runId);
  if (!run || ["CANCELLED", "COMPLETED", "FAILED"].includes(run.status)) return;

  benchmarkStore.updateRun(runId, { status: "RUNNING", startedAt: new Date().toISOString() });

  const modelConcurrency = Math.max(1, Number(process.env.BENCHMARK_MODEL_CONCURRENCY ?? 1));
  await runWithConcurrency(run.results, modelConcurrency, async (result) => {
    if (await waitUntilRunnable(runId)) await executeModel(runId, result.id);
  });

  await benchmarkStore.flush(runId);
  await benchmarkStore.refreshRun(runId);
  const finishedRun = benchmarkStore.getStoredRun(runId);
  if (!finishedRun || finishedRun.status === "CANCELLED") return;
  if (!(await waitUntilRunnable(runId))) return;

  const hasFailures = finishedRun.results.some((result) => result.status === "FAILED");
  benchmarkStore.updateRun(runId, {
    status: hasFailures ? "FAILED" : "COMPLETED",
    finishedAt: new Date().toISOString(),
  });
}

async function executeModel(runId: string, resultId: string) {
  const run = benchmarkStore.getStoredRun(runId);
  if (!run) return;
  const result = run.results.find((item) => item.id === resultId);
  if (!result) return;

  benchmarkStore.updateResult(runId, resultId, {
    status: "INFERRING",
    evalStatus: "PENDING",
    responseText: null,
    turns: [],
    evaluation: null,
    inputTokens: null,
    outputTokens: null,
    ttftMs: null,
    tokPerSec: null,
    totalDurationMs: null,
    errorMessage: null,
  });

  const turnTelemetry = [] as Array<{
    ttftMs: number | null;
    outputTokens: number | null;
    inputTokens: number | null;
    totalDurationMs: number | null;
    evalDurationMs: number | null;
  }>;

  try {
    for (const [index, userMessage] of run.userMessages.entries()) {
      if (run.cancelController.signal.aborted) return;
      if (!(await waitUntilRunnable(runId))) return;
      const activeRun = benchmarkStore.getStoredRun(runId);
      if (!activeRun) return;
      let partialResponse = "";
      let lastStreamUpdate = 0;
      const response = await retryTransient(
        () =>
          streamOllamaChat({
            endpoint: activeRun.ollamaUrl,
            model: result.modelName,
            messages: [
              { role: "system", content: activeRun.systemPrompt },
              { role: "user", content: userMessage },
            ],
            parameters: activeRun.parameters,
            signal: activeRun.cancelController.signal,
            onToken: (token) => {
              partialResponse += token;
              const now = performance.now();
              if (now - lastStreamUpdate >= 50) {
                lastStreamUpdate = now;
                benchmarkStore.updateStreamingResponse(runId, resultId, partialResponse);
              }
            },
          }),
        activeRun.cancelController.signal,
      );

      turnTelemetry.push({
        ttftMs: response.ttftMs,
        outputTokens: response.outputTokens,
        inputTokens: response.inputTokens,
        totalDurationMs: response.totalDurationMs,
        evalDurationMs: response.evalDurationMs,
      });
      benchmarkStore.addTurn(runId, resultId, {
        id: crypto.randomUUID(),
        stepOrder: index + 1,
        userMessage,
        responseText: response.responseText,
        thinking: response.thinking || null,
        ttftMs: response.ttftMs,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        tokPerSec: response.tokPerSec,
        totalDurationMs: response.totalDurationMs,
      });
    }

    const totals = aggregateTelemetry(turnTelemetry);
    benchmarkStore.updateResult(runId, resultId, totals);

    await benchmarkStore.flush(runId);
    await benchmarkStore.refreshRun(runId);
    const latestRun = benchmarkStore.getStoredRun(runId) ?? run;
    if (latestRun.cancelController.signal.aborted || latestRun.status === "CANCELLED") return;
    benchmarkStore.updateResult(runId, resultId, { status: "EVALUATING", evalStatus: latestRun.evaluator ? "RUNNING" : "SKIPPED" });

    if (latestRun.evaluator) {
      try {
        const current = benchmarkStore.getStoredRun(runId);
        const currentResult = current?.results.find((item) => item.id === resultId);
        const evaluation = await retryTransient(
          () => evaluateModelResponse({
            config: latestRun.evaluator!,
            systemPrompt: latestRun.systemPrompt,
            userMessages: latestRun.userMessages,
            responseText: currentResult?.responseText ?? "",
            modelName: result.modelName,
            signal: latestRun.cancelController.signal,
            mode: latestRun.category === "SECURITY" ? "security" : "quality",
          }),
          latestRun.cancelController.signal,
          3,
          isTransient,
        );
        benchmarkStore.setEvaluation(runId, resultId, evaluation);
        benchmarkStore.updateResult(runId, resultId, { evalStatus: "COMPLETED", status: "COMPLETED" });
      } catch (error) {
        if (latestRun.cancelController.signal.aborted) return;
        console.error("[slmarena] [Evaluation Failed]", {
          runId,
          resultId,
          model: latestRun.evaluator?.model,
          error: error instanceof Error ? error.message : String(error),
        });
        benchmarkStore.updateResult(runId, resultId, {
          evalStatus: "FAILED",
          status: "COMPLETED",
          errorMessage: `Evaluation failed: ${error instanceof Error ? error.message : "Unknown error."}`,
        });
      }
    } else {
      benchmarkStore.updateResult(runId, resultId, { status: "COMPLETED", evalStatus: "SKIPPED" });
    }
  } catch (error) {
    const currentRun = benchmarkStore.getStoredRun(runId) ?? run;
    if (currentRun.cancelController.signal.aborted || currentRun.status === "CANCELLED") {
      benchmarkStore.updateResult(runId, resultId, { status: "CANCELLED" });
      return;
    }

    console.error("[slmarena] [Inference Failed]", {
      runId,
      resultId,
      error: error instanceof Error ? error.message : String(error),
    });

    benchmarkStore.updateResult(runId, resultId, {
      status: "FAILED",
      evalStatus: "FAILED",
      errorMessage: error instanceof Error ? error.message : "Unknown inference error.",
    });
  }
}

function aggregateTelemetry(turns: Array<{
  ttftMs: number | null;
  outputTokens: number | null;
  inputTokens: number | null;
  totalDurationMs: number | null;
  evalDurationMs: number | null;
}>) {
  const outputTokens = sumNullable(turns.map((turn) => turn.outputTokens));
  const inputTokens = sumNullable(turns.map((turn) => turn.inputTokens));
  const totalDurationMs = sumNullable(turns.map((turn) => turn.totalDurationMs));
  const evalDurationMs = sumNullable(turns.map((turn) => turn.evalDurationMs));
  const firstTurn = turns[0];

  return {
    inputTokens,
    outputTokens,
    ttftMs: firstTurn?.ttftMs ?? null,
    totalDurationMs,
    tokPerSec:
      outputTokens !== null && evalDurationMs !== null && evalDurationMs > 0
        ? Number((outputTokens / (evalDurationMs / 1_000)).toFixed(2))
        : null,
  };
}

function sumNullable(values: Array<number | null>) {
  if (values.every((value) => value === null)) return null;
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

async function retryTransient<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
  maxAttempts = 3,
  retryable: (error: unknown) => boolean = isTransient,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (signal.aborted || !retryable(error) || attempt === maxAttempts) throw error;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, 250 * 2 ** (attempt - 1));
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timeout);
            reject(signal.reason);
          },
          { once: true },
        );
      });
    }
  }
  throw lastError;
}

function isTransient(error: unknown) {
  if (error instanceof OllamaRequestError || error instanceof EvaluatorRequestError) {
    return error.status >= 500 || error.status === 429;
  }
  return error instanceof TypeError || (error instanceof Error && error.name === "TimeoutError");
}

export { executeBenchmark };

async function runWithConcurrency<T>(items: T[], concurrency: number, operation: (item: T) => Promise<void>) {
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex];
        nextIndex += 1;
        await operation(item);
      }
    }),
  );
}

async function waitUntilRunnable(runId: string) {
  while (true) {
    await benchmarkStore.flush(runId);
    await benchmarkStore.refreshRun(runId);
    const run = benchmarkStore.getStoredRun(runId);
    if (!run || run.status === "CANCELLED" || run.status === "FAILED") return false;
    if (!run.paused) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
