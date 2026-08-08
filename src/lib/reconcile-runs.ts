import IORedis from "ioredis";
import { Queue } from "bullmq";
import { enqueueBenchmark } from "@/lib/benchmark-queue";
import { benchmarkStore } from "@/lib/benchmark-store";
import { loadPersistedState } from "@/lib/database";
import { redisConnection } from "@/lib/redis-connection";

const QUEUE_NAME = "slmarena-benchmarks";
const RECOVERY_KEY_PREFIX = "slmarena:recovery:";
const RECOVERY_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_RECOVERIES = 3;
const STALLED_ERROR_MESSAGE = "STALLED: worker interrupted after repeated recoveries";

export type ReconcileResult = {
  reenqueued: string[];
  failed: string[];
  skipped: string[];
};

export async function reconcileOrphanedRuns(options: { maxRecoveries?: number } = {}): Promise<ReconcileResult> {
  const maxRecoveries = options.maxRecoveries ?? MAX_RECOVERIES;
  const queue = new Queue(QUEUE_NAME, { connection: redisConnection() });
  const connection = redisConnection();
  const redis = new IORedis(connection.port, connection.host, connection);
  const result: ReconcileResult = { reenqueued: [], failed: [], skipped: [] };
  try {
    const persisted = await loadPersistedState();
    if (!persisted) return result;

    const candidates = persisted.runs.filter(({ run }) => run.status === "PENDING" || run.status === "RUNNING");
    for (const { run } of candidates) {
      if (run.paused) {
        result.skipped.push(run.id);
        continue;
      }
      const jobId = `benchmark-${run.id}`;
      const job = await queue.getJob(jobId);
      const jobState = job ? await job.getState() : null;
      if (jobState && jobState !== "failed") {
        result.skipped.push(run.id);
        continue;
      }

      const recoveryKey = `${RECOVERY_KEY_PREFIX}${run.id}`;
      const recoveries = Number((await redis.get(recoveryKey)) ?? 0);
      if (recoveries >= maxRecoveries) {
        await markStalled(run.id);
        result.failed.push(run.id);
        continue;
      }

      await enqueueBenchmark(run.id);
      await redis.incr(recoveryKey);
      if (recoveries === 0) await redis.expire(recoveryKey, RECOVERY_TTL_SECONDS);
      result.reenqueued.push(run.id);
    }
    return result;
  } finally {
    await queue.close();
    redis.disconnect();
  }
}

async function markStalled(runId: string) {
  let run = benchmarkStore.getStoredRun(runId);
  if (!run) {
    await benchmarkStore.refreshRun(runId);
    run = benchmarkStore.getStoredRun(runId);
  }
  if (!run || ["COMPLETED", "CANCELLED", "FAILED"].includes(run.status)) return;
  benchmarkStore.updateRun(runId, {
    status: "FAILED",
    finishedAt: new Date().toISOString(),
    errorMessage: STALLED_ERROR_MESSAGE,
  });
  await benchmarkStore.flush(runId);
}
