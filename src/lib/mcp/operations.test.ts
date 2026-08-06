import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelRun, getRunResultDetails, listRuns, pauseRun, resumeRun } from "./runs";
import { getSettings, updateSettings } from "./settings";
import { getScenarioAnalysis, reviewResult } from "./analysis";

function mockFetchSequence(...responses: unknown[]) {
  const mock = vi.fn();
  for (const payload of responses) {
    mock.mockResolvedValueOnce(
      new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }),
    );
  }
  vi.stubGlobal("fetch", mock);
  return mock;
}

const runStub = { run: { id: "r1", status: "RUNNING" } };

describe("listRuns", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("builds the expected query string and returns runs", async () => {
    const mock = mockFetchSequence({ runs: [runStub.run], total: 1, page: 1, pageSize: 10 });
    const result = (await listRuns({ model: "qwen3:4b", min_score: 4, page_size: 10 })) as {
      runs: unknown[];
      total: number;
    };
    expect(result.runs).toHaveLength(1);
    expect(result.total).toBe(1);
    const [url] = mock.mock.calls[0] as [string];
    expect(url).toContain("/api/runs?");
    expect(url).toContain("model=qwen3%3A4b");
    expect(url).toContain("score=4");
    expect(url).toContain("pageSize=10");
  });

  it("omits optional filters when not provided", async () => {
    const mock = mockFetchSequence({ runs: [], total: 0, page: 1, pageSize: 50 });
    await listRuns({});
    const [url] = mock.mock.calls[0] as [string];
    expect(url).toBe("http://localhost:3000/api/runs?");
  });
});

describe("run control tools", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("pause_run POSTs to the pause endpoint", async () => {
    const mock = mockFetchSequence(runStub);
    const result = (await pauseRun({ run_id: "r1" })) as { run: { status: string } };
    expect(result.run.status).toBe("RUNNING");
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/runs/r1/pause");
    expect(init.method).toBe("POST");
  });

  it("resume_run POSTs to the resume endpoint", async () => {
    const mock = mockFetchSequence(runStub);
    await resumeRun({ run_id: "r1" });
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/runs/r1/resume");
    expect(init.method).toBe("POST");
  });

  it("cancel_run POSTs to the cancel endpoint", async () => {
    const mock = mockFetchSequence(runStub);
    await cancelRun({ run_id: "r1" });
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/runs/r1/cancel");
    expect(init.method).toBe("POST");
  });
});

describe("getRunResultDetails", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches a single result from the run", async () => {
    const mock = mockFetchSequence({ runId: "r1", result: { id: "res1", modelName: "qwen3:4b" } });
    const result = (await getRunResultDetails({ run_id: "r1", result_id: "res1" })) as {
      run_id: string;
      result: { id: string };
    };
    expect(result.run_id).toBe("r1");
    expect(result.result.id).toBe("res1");
    const [url] = mock.mock.calls[0] as [string];
    expect(url).toBe("http://localhost:3000/api/runs/r1/results/res1");
  });
});

describe("getSettings", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the settings payload", async () => {
    mockFetchSequence({
      settings: {
        ollamaUrl: "http://10.128.128.254:11434",
        evaluatorBaseUrl: "https://api.openai.com/v1",
        evaluatorModel: "gpt-5.6-luna",
        evaluatorApiKeyConfigured: true,
        parameters: { temperature: 0.7, numCtx: 4096, topP: 0.9, repeatPenalty: 1.1, numPredict: 1024 },
      },
    });
    const result = (await getSettings()) as { settings: { ollamaUrl: string } };
    expect(result.settings.ollamaUrl).toBe("http://10.128.128.254:11434");
  });
});

describe("updateSettings", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps snake_case arguments to the API body and PATCHes", async () => {
    const mock = mockFetchSequence({
      settings: {
        ollamaUrl: "http://10.128.128.254:11434",
        evaluatorBaseUrl: "",
        evaluatorModel: "",
        evaluatorApiKeyConfigured: false,
        parameters: { temperature: 0.5, numCtx: 2048, topP: 0.9, repeatPenalty: 1.1, numPredict: 512 },
      },
    });
    const result = (await updateSettings({
      ollama_url: "http://10.128.128.254:11434",
      parameters: { temperature: 0.5, num_ctx: 2048 },
    })) as { settings: { ollamaUrl: string } };
    expect(result.settings.ollamaUrl).toBe("http://10.128.128.254:11434");

    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/settings");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.ollamaUrl).toBe("http://10.128.128.254:11434");
    expect(body.parameters).toEqual({ temperature: 0.5, numCtx: 2048 });
  });
});

describe("getScenarioAnalysis", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requires scenario_id or system_prompt", async () => {
    await expect(getScenarioAnalysis({})).rejects.toThrow(/scenario_id or system_prompt/);
  });

  it("queries by scenario_id and returns the aggregate", async () => {
    const mock = mockFetchSequence({ models: [{ modelName: "a", samples: 2 }] });
    const result = (await getScenarioAnalysis({ scenario_id: "s1" })) as { models: Array<{ modelName: string }> };
    expect(result.models[0].modelName).toBe("a");
    const [url] = mock.mock.calls[0] as [string];
    expect(url).toContain("/api/analysis?scenarioId=s1");
  });

  it("serializes user_messages when provided", async () => {
    const mock = mockFetchSequence({ models: [] });
    await getScenarioAnalysis({ system_prompt: "guard", user_messages: ["hi", "attack"] });
    const [url] = mock.mock.calls[0] as [string];
    expect(url).toContain("systemPrompt=guard");
    expect(url).toContain(encodeURIComponent(JSON.stringify(["hi", "attack"])));
  });
});

describe("reviewResult", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("PATCHes the human review and returns the run", async () => {
    const mock = mockFetchSequence({ run: { id: "r1", status: "COMPLETED" } });
    const result = (await reviewResult({ result_id: "res1", status: "REJECTED", notes: "Wrong verdict" })) as {
      run: { id: string };
    };
    expect(result.run.id).toBe("r1");

    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/results/res1/review");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.status).toBe("REJECTED");
    expect(body.notes).toBe("Wrong verdict");
  });
});