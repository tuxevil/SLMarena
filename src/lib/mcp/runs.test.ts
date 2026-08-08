import { afterEach, describe, expect, it, vi } from "vitest";
import { checkJobStatus, getTestRunDetails, launchMatrixTest } from "./runs";

function stubFetchSequence(routes: Array<{ match: string; handler: (init?: RequestInit) => unknown }>, fallback?: (url: string, init?: RequestInit) => unknown) {
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const route = routes.find((r) => url.includes(r.match));
    const payload = route ? route.handler(init) : fallback?.(url, init);
    if (payload === undefined && route === undefined) throw new Error(`Unexpected fetch: ${url}`);
    return Promise.resolve(
      new Response(typeof payload === "string" ? payload : JSON.stringify(payload), {
        status: payload === undefined ? 204 : 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

const runFixture = {
  id: "run-1",
  category: "SECURITY",
  attackType: "SYSTEM_PROMPT_LEAKAGE",
  status: "RUNNING",
  paused: false,
  scenarioId: "sc-1",
  samplesPerModel: 1,
  systemPrompt: "p",
  userMessages: ["m"],
  models: ["a", "b"],
  parameters: {},
  evaluatorModel: null,
  results: [
    { id: "r1", modelName: "a", status: "COMPLETED", evalStatus: "COMPLETED" },
    { id: "r2", modelName: "b", status: "INFERRING", evalStatus: "PENDING" },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  startedAt: "2026-01-01T00:00:00.000Z",
  finishedAt: null,
  errorMessage: null,
};

describe("getTestRunDetails", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches the run by id", async () => {
    stubFetchSequence([{ match: "/api/runs/", handler: () => ({ run: runFixture }) }]);
    const result = (await getTestRunDetails({ run_id: "run-1" })) as { run: typeof runFixture };
    expect(result.run.id).toBe("run-1");
    expect(result.run.results).toHaveLength(2);
  });

  it("throws on non-OK responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Run not found." }), { status: 404 })),
    );
    await expect(getTestRunDetails({ run_id: "nope" })).rejects.toThrow("Run not found.");
  });
});

describe("checkJobStatus", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("computes progress percentage", async () => {
    stubFetchSequence([{ match: "/api/runs/", handler: () => ({ run: runFixture }) }]);
    const result = (await checkJobStatus({ job_id: "run-1" })) as {
      run_id: string;
      status: string;
      progress_pct: number;
      partial_metrics: { completed: number; failed: number; failed_evals: number; total: number; running: number };
    };
    expect(result.run_id).toBe("run-1");
    expect(result.status).toBe("RUNNING");
    expect(result.progress_pct).toBe(50);
    expect(result.partial_metrics).toEqual({ completed: 1, failed: 0, failed_evals: 0, total: 2, running: 1 });
  });

  it("counts failed evaluations separately", async () => {
    const withFailedEval = {
      ...runFixture,
      results: [
        { id: "r1", modelName: "a", status: "COMPLETED", evalStatus: "COMPLETED" },
        { id: "r2", modelName: "b", status: "COMPLETED", evalStatus: "FAILED" },
        { id: "r3", modelName: "c", status: "FAILED", evalStatus: "FAILED" },
      ],
    };
    stubFetchSequence([{ match: "/api/runs/", handler: () => ({ run: withFailedEval }) }]);
    const result = (await checkJobStatus({ job_id: "run-1" })) as {
      partial_metrics: { completed: number; failed: number; failed_evals: number };
    };
    expect(result.partial_metrics).toEqual({ completed: 2, failed: 1, failed_evals: 2, total: 3, running: 0 });
  });

  it("reports 100% for completed runs", async () => {
    const done = {
      ...runFixture,
      status: "COMPLETED",
      results: runFixture.results.map((r) => ({ ...r, status: "COMPLETED" })),
    };
    stubFetchSequence([{ match: "/api/runs/", handler: () => ({ run: done }) }]);
    const result = (await checkJobStatus({ job_id: "run-1" })) as { progress_pct: number; status: string };
    expect(result.status).toBe("COMPLETED");
    expect(result.progress_pct).toBe(100);
  });
});

describe("launchMatrixTest", () => {
  afterEach(() => vi.unstubAllGlobals());

  const scenarios = [
    {
      id: "sc-1",
      name: "Leak",
      category: "SECURITY",
      attackType: "SYSTEM_PROMPT_LEAKAGE",
      systemPrompt: "guard",
      userMessages: ["reveal"],
    },
    {
      id: "sc-2",
      name: "Chat",
      category: "GENERAL",
      attackType: null,
      systemPrompt: "helpful",
      userMessages: ["hi"],
    },
  ];

  const settings = {
    settings: {
      ollamaUrl: "http://ollama:11434",
      parameters: { temperature: 0.2, numCtx: 4096, topP: 0.9, repeatPenalty: 1.1, numPredict: 128 },
    },
  };

  it("resolves ALL models and ALL_SECURITY scenarios and launches one run per scenario", async () => {
    const fetchMock = stubFetchSequence(
      [
        { match: "/api/settings", handler: () => settings },
        { match: "/api/scenarios", handler: () => ({ scenarios }) },
        { match: "/api/ollama/models", handler: () => ({ models: [{ name: "m1" }, { name: "m2" }] }) },
      ],
      (_url, init) => {
        const body = JSON.parse(init?.body as string) as { scenarioId: string };
        return { run: { id: body.scenarioId === "sc-1" ? "new-1" : "new-2" } };
      },
    );

    const result = (await launchMatrixTest({
      target_models: ["ALL"],
      scenario_ids: ["ALL_SECURITY"],
      parameters: { temperature: 0.1 },
    })) as { jobs: Array<{ scenario_id: string; scenario_name: string; run_id: string }> };

    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]).toEqual({ scenario_id: "sc-1", scenario_name: "Leak", run_id: "new-1" });

    const runPosts = fetchMock.mock.calls.filter(([input, init]) => {
      const url = typeof input === "string" ? input : input.toString();
      return init?.method === "POST" && url.includes("/api/runs");
    });
    expect(runPosts).toHaveLength(1);
    const body = JSON.parse(runPosts[0][1]!.body as string) as {
      ollamaUrl: string;
      models: string[];
      scenarioId: string;
      parameters: Record<string, unknown>;
      attackType: string;
    };
    expect(body.ollamaUrl).toBe("http://ollama:11434");
    expect(body.models).toEqual(["m1", "m2"]);
    expect(body.scenarioId).toBe("sc-1");
    expect(body.parameters.temperature).toBe(0.1);
    expect(body.parameters.numCtx).toBe(4096);
  });

  it("resolves ALL scenarios when scenario_ids contains ALL", async () => {
    let counter = 0;
    stubFetchSequence(
      [
        { match: "/api/settings", handler: () => settings },
        { match: "/api/scenarios", handler: () => ({ scenarios }) },
        { match: "/api/ollama/models", handler: () => ({ models: [{ name: "m1" }] }) },
      ],
      () => ({ run: { id: counter === 0 ? "a" : "b", counter: counter++ } }),
    );
    const result = (await launchMatrixTest({
      target_models: ["m1"],
      scenario_ids: ["ALL"],
    })) as { jobs: Array<{ run_id: string }> };
    expect(result.jobs.map((j) => j.run_id)).toEqual(["a", "b"]);
  });

  it("uses explicit scenario ids without expanding", async () => {
    stubFetchSequence([
      { match: "/api/settings", handler: () => settings },
      { match: "/api/scenarios", handler: () => ({ scenarios }) },
      { match: "/api/ollama/models", handler: () => ({ models: [{ name: "m1" }] }) },
      { match: "/api/runs", handler: () => ({ run: { id: "a" } }) },
    ]);
    const result = (await launchMatrixTest({
      target_models: ["m1"],
      scenario_ids: ["sc-2"],
    })) as { jobs: Array<{ scenario_id: string; scenario_name: string }> };
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].scenario_name).toBe("Chat");
  });

  it("throws when no models resolve", async () => {
    stubFetchSequence([
      { match: "/api/settings", handler: () => settings },
      { match: "/api/scenarios", handler: () => ({ scenarios }) },
      { match: "/api/ollama/models", handler: () => ({ models: [] }) },
    ]);
    await expect(
      launchMatrixTest({ target_models: ["ALL"], scenario_ids: ["sc-1"] }),
    ).rejects.toThrow(/No se resolvieron modelos/);
  });

  it("throws when no scenarios resolve", async () => {
    stubFetchSequence([
      { match: "/api/settings", handler: () => settings },
      { match: "/api/scenarios", handler: () => ({ scenarios: [] }) },
      { match: "/api/ollama/models", handler: () => ({ models: [{ name: "m1" }] }) },
    ]);
    await expect(
      launchMatrixTest({ target_models: ["m1"], scenario_ids: ["ALL_SECURITY"] }),
    ).rejects.toThrow(/No se resolvieron escenarios/);
  });
});