import { loadEnvConfig } from "@next/env";
import { Worker } from "bullmq";
import { executeBenchmark } from "./lib/benchmark-queue";
import { redisConnection } from "./lib/redis-connection";

loadEnvConfig(process.cwd());

if (!process.env.REDIS_URL || !process.env.DATABASE_URL || !process.env.APP_ENCRYPTION_KEY) {
  throw new Error("REDIS_URL, DATABASE_URL, and APP_ENCRYPTION_KEY are required to start the durable worker.");
}

const worker = new Worker<{ runId: string }>(
  "compare-benchmarks",
  async (job) => executeBenchmark(job.data.runId),
  {
    connection: redisConnection(),
    concurrency: Math.max(1, Number(process.env.BENCHMARK_CONCURRENCY ?? 1)),
  },
);

worker.on("completed", (job) => console.log(`[compare] completed ${job.data.runId}`));
worker.on("failed", (job, error) => console.error(`[compare] failed ${job?.data.runId ?? "unknown"}`, error));
worker.on("error", (error) => console.error("[compare] worker error", error));

const shutdown = async () => {
  await worker.close();
  process.exit(0);
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await worker.waitUntilReady();
console.log("[compare] benchmark worker ready");
