import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestRun } from "./contracts";

vi.mock("./database", () => ({
  loadPersistedState: vi.fn(),
}));
vi.mock("./benchmark-queue", () => ({
  enqueueBenchmark: vi.fn(),
}));
vi.mock("bullmq", () => ({
  Queue: vi.fn(),
}));
vi.mock("ioredis", () => ({
  default: vi.fn(),
}));
vi.mock("./benchmark-store", () => ({
  benchmarkStore: {
    getStoredRun: vi.fn(),
    refreshRun: vi.fn(),
    updateRun: vi.fn(),
    flush: vi.fn(),
  },
}));

import { loadPersistedState } from "./database";
import { enqueueBenchmark } from "./benchmark-queue";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { benchmarkStore } from "./benchmark-store";
import { reconcileOrphanedRuns } from "./reconcile-runs";

const mockedLoad = vi.mocked(loadPersistedState);
const mockedEnqueue = vi.mocked(enqueueBenchmark);
const mockedStore = vi.mocked(benchmarkStore);

type JobMock = { getState: () => Promise<string | null> };

function makeRun(overrides: Partial<TestRun> = {}): TestRun {
  return {
    id: `run-${crypto.randomUUID()}`,
    category: "GENERAL",
    attackType: null,
    status: "PENDING",
    paused: false,
    controlVersion: 0,
    scenarioId: null,
    samplesPerModel: 1,
    systemPrompt: "Be concise.",
    userMessages: ["Say hello."],
    models: ["test-model"],
    parameters: { temperature: 0.2, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 64 },
    evaluatorModel: null,
    results: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    errorMessage: null,
    ...overrides,
  };
}

describe("reconcileOrphanedRuns", () => {
  const stateByJobId = new Map<string, JobMock | null>();
  const recoveryCounts = new Map<string, number>();

  beforeEach(() => {
    vi.clearAllMocks();
    stateByJobId.clear();
    recoveryCounts.clear();
    const QueueMock = vi.mocked(Queue);
    QueueMock.mockImplementation(
      () =>
        ({
          getJob: vi.fn(async (jobId: string) => stateByJobId.get(jobId)),
          close: vi.fn(async () => undefined),
        }) as unknown as ReturnType<typeof QueueMock>,
    );
    const IORedisMock = vi.mocked(IORedis);
    IORedisMock.mockImplementation(
      () =>
        ({
          get: vi.fn(async (key: string) => String(recoveryCounts.get(key) ?? 0)),
          incr: vi.fn(async (key: string) => {
            const next = (recoveryCounts.get(key) ?? 0) + 1;
            recoveryCounts.set(key, next);
            return next;
          }),
          expire: vi.fn(async () => 1),
          disconnect: vi.fn(() => undefined),
        }) as unknown as InstanceType<typeof IORedisMock>,
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("re-enqueues PENDING runs without a live job", async () => {
    const run = makeRun();
    mockedLoad.mockResolvedValue({ runs: [{ run, config: { ollamaUrl: "http://localhost:11434" } }], scenarios: [] });
    stateByJobId.set(`benchmark-${run.id}`, null);

    const outcome = await reconcileOrphanedRuns();

    expect(mockedEnqueue).toHaveBeenCalledWith(run.id);
    expect(outcome.reenqueued).toEqual([run.id]);
    expect(outcome.failed).toEqual([]);
  });

  it("skips runs with a live waiting or active job", async () => {
    const waitingRun = makeRun({ status: "PENDING" });
    const activeRun = makeRun({ status: "RUNNING" });
    mockedLoad.mockResolvedValue({
      runs: [
        { run: waitingRun, config: { ollamaUrl: "http://localhost:11434" } },
        { run: activeRun, config: { ollamaUrl: "http://localhost:11434" } },
      ],
      scenarios: [],
    });
    stateByJobId.set(`benchmark-${waitingRun.id}`, { getState: async () => "waiting" });
    stateByJobId.set(`benchmark-${activeRun.id}`, { getState: async () => "active" });

    const outcome = await reconcileOrphanedRuns();

    expect(mockedEnqueue).not.toHaveBeenCalled();
    expect(outcome.skipped.sort()).toEqual([activeRun.id, waitingRun.id].sort());
  });

  it("marks FAILED a RUNNING run whose job failed and recoveries are exhausted", async () => {
    const run = makeRun({ status: "RUNNING" });
    mockedLoad.mockResolvedValue({ runs: [{ run, config: { ollamaUrl: "http://localhost:11434" } }], scenarios: [] });
    stateByJobId.set(`benchmark-${run.id}`, { getState: async () => "failed" });
    recoveryCounts.set(`slmarena:recovery:${run.id}`, 3);
    mockedStore.getStoredRun.mockReturnValue({ ...run, evaluator: undefined, ollamaUrl: "http://localhost:11434", cancelController: new AbortController(), eventSequence: 0, listeners: new Set() });
    mockedStore.updateRun.mockReturnValue(run);

    const outcome = await reconcileOrphanedRuns();

    expect(mockedEnqueue).not.toHaveBeenCalled();
    expect(outcome.failed).toEqual([run.id]);
    expect(mockedStore.updateRun).toHaveBeenCalledWith(
      run.id,
      expect.objectContaining({ status: "FAILED", errorMessage: expect.stringContaining("STALLED") }),
    );
    expect(mockedStore.flush).toHaveBeenCalledWith(run.id);
  });

  it("does not mark FAILED a completed run", async () => {
    const run = makeRun({ status: "COMPLETED", startedAt: new Date().toISOString() });
    mockedLoad.mockResolvedValue({ runs: [{ run, config: { ollamaUrl: "http://localhost:11434" } }], scenarios: [] });
    stateByJobId.set(`benchmark-${run.id}`, null);

    const outcome = await reconcileOrphanedRuns();

    expect(mockedEnqueue).not.toHaveBeenCalled();
    expect(outcome).toEqual({ reenqueued: [], failed: [], skipped: [] });
  });
});
