import { afterEach, describe, expect, it, vi } from "vitest";
import { benchmarkStore } from "./benchmark-store";
import { enqueueBenchmark } from "./benchmark-queue";

describe("enqueueBenchmark", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("runs a model through Ollama and completes without a frontier judge", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            JSON.stringify({ message: { content: "Local" } }),
            JSON.stringify({ message: { content: " model answering here" } }),
            JSON.stringify({ done: true, prompt_eval_count: 4, eval_count: 8, eval_duration: 1_000_000_000, total_duration: 1_200_000_000 }),
          ].join("\n"),
          { status: 200 },
        ),
      ),
    );

    const run = benchmarkStore.createRun({
      ollamaUrl: "http://localhost:11434",
      samplesPerModel: 1,
      systemPrompt: "Be concise.",
      userMessages: ["Say hello."],
      models: [`test-model-${crypto.randomUUID()}`],
      parameters: { temperature: 0.2, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 64 },
    });

    enqueueBenchmark(run.id);
    const completed = await waitForRun(run.id);
    const result = completed.results[0];

    expect(completed.status).toBe("COMPLETED");
    expect(result.status).toBe("COMPLETED");
    expect(result.responseText).toBe("Local model answering here");
    expect(result.outputTokens).toBe(8);
    expect(result.tokPerSec).toBe(8);
  });

  it("sends each turn as an isolated request without conversation history", async () => {
    const chatStream = () =>
      new Response(
        [
          JSON.stringify({ message: { content: "A full isolated answer" } }),
          JSON.stringify({ done: true, prompt_eval_count: 4, eval_count: 8, eval_duration: 1_000_000_000, total_duration: 1_200_000_000 }),
        ].join("\n"),
        { status: 200 },
      );
    const fetchMock = vi.fn().mockResolvedValueOnce(chatStream()).mockResolvedValueOnce(chatStream());
    vi.stubGlobal("fetch", fetchMock);

    const run = benchmarkStore.createRun({
      ollamaUrl: "http://localhost:11434",
      samplesPerModel: 1,
      systemPrompt: "Be concise.",
      userMessages: ["First question.", "Second question."],
      models: [`isolated-model-${crypto.randomUUID()}`],
      parameters: { temperature: 0.2, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 64 },
    });

    enqueueBenchmark(run.id);
    const completed = await waitForRun(run.id);

    expect(completed.status).toBe("COMPLETED");
    expect(completed.results[0].turns).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstMessages = JSON.parse(String(fetchMock.mock.calls[0][1].body)).messages;
    expect(firstMessages.map((message: { role: string }) => message.role)).toEqual(["system", "user"]);
    expect(firstMessages[1].content).toBe("First question.");

    const secondMessages = JSON.parse(String(fetchMock.mock.calls[1][1].body)).messages;
    expect(secondMessages.map((message: { role: string }) => message.role)).toEqual(["system", "user"]);
    expect(secondMessages[1].content).toBe("Second question.");
  });

  it("runs multiple samples per model without mixing their responses", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        calls += 1;
        return new Response(
          [
            JSON.stringify({ message: { content: `Full answer number ${calls}` } }),
            JSON.stringify({ done: true, prompt_eval_count: 4, eval_count: 8, eval_duration: 1_000_000_000, total_duration: 1_200_000_000 }),
          ].join("\n"),
          { status: 200 },
        );
      }),
    );

    const run = benchmarkStore.createRun({
      ollamaUrl: "http://localhost:11434",
      samplesPerModel: 2,
      systemPrompt: "Be concise.",
      userMessages: ["Say hello."],
      models: [`sampled-model-${crypto.randomUUID()}`],
      parameters: { temperature: 0.2, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 64 },
    });

    expect(run.results).toHaveLength(2);
    expect(run.results.map((result) => result.sampleIndex)).toEqual([0, 1]);

    enqueueBenchmark(run.id);
    const completed = await waitForRun(run.id);

    expect(completed.status).toBe("COMPLETED");
    expect(completed.results).toHaveLength(2);
    expect(completed.results.map((result) => result.responseText).sort()).toEqual(["Full answer number 1", "Full answer number 2"]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("marks a result as FAILED with EMPTY_RESPONSE when the model returns an empty response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            JSON.stringify({ done: true, prompt_eval_count: 4, eval_count: 0, eval_duration: 1_000_000_000, total_duration: 1_000_000_000 }),
          ].join("\n"),
          { status: 200 },
        ),
      ),
    );

    const run = benchmarkStore.createRun({
      ollamaUrl: "http://localhost:11434",
      samplesPerModel: 1,
      systemPrompt: "Be concise.",
      userMessages: ["Say hello."],
      models: [`empty-model-${crypto.randomUUID()}`],
      parameters: { temperature: 0.2, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 64 },
    });

    enqueueBenchmark(run.id);
    const failed = await waitForRun(run.id);
    const result = failed.results[0];

    expect(failed.status).toBe("FAILED");
    expect(result.status).toBe("FAILED");
    expect(result.evalStatus).toBe("FAILED");
    expect(result.errorMessage).toBe("EMPTY_RESPONSE");
  });

  it("marks a result as FAILED with EMPTY_RESPONSE when the response is shorter than 15 chars", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            JSON.stringify({ message: { content: "short" } }),
            JSON.stringify({ done: true, prompt_eval_count: 4, eval_count: 5, eval_duration: 1_000_000_000, total_duration: 1_000_000_000 }),
          ].join("\n"),
          { status: 200 },
        ),
      ),
    );

    const run = benchmarkStore.createRun({
      ollamaUrl: "http://localhost:11434",
      samplesPerModel: 1,
      systemPrompt: "Be concise.",
      userMessages: ["Say hello."],
      models: [`short-model-${crypto.randomUUID()}`],
      parameters: { temperature: 0.2, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 64 },
    });

    enqueueBenchmark(run.id);
    const failed = await waitForRun(run.id);

    expect(failed.status).toBe("FAILED");
    expect(failed.results[0].status).toBe("FAILED");
    expect(failed.results[0].errorMessage).toBe("EMPTY_RESPONSE");
  });

  it("completes a result whose response is exactly at the 15-char minimum", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            JSON.stringify({ message: { content: "0123456789abcde" } }),
            JSON.stringify({ done: true, prompt_eval_count: 4, eval_count: 15, eval_duration: 1_000_000_000, total_duration: 1_000_000_000 }),
          ].join("\n"),
          { status: 200 },
        ),
      ),
    );

    const run = benchmarkStore.createRun({
      ollamaUrl: "http://localhost:11434",
      samplesPerModel: 1,
      systemPrompt: "Be concise.",
      userMessages: ["Say hello."],
      models: [`boundary-model-${crypto.randomUUID()}`],
      parameters: { temperature: 0.2, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 64 },
    });

    enqueueBenchmark(run.id);
    const completed = await waitForRun(run.id);

    expect(completed.status).toBe("COMPLETED");
    expect(completed.results[0].status).toBe("COMPLETED");
    expect(completed.results[0].responseText).toBe("0123456789abcde");
  });

  it("waits while a run is paused and resumes without losing the run", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            JSON.stringify({ message: { content: "Resumed with a full answer" } }),
            JSON.stringify({ done: true, prompt_eval_count: 2, eval_count: 4, eval_duration: 1_000_000_000, total_duration: 1_100_000_000 }),
          ].join("\n"),
          { status: 200 },
        ),
      ),
    );

    const run = benchmarkStore.createRun({
      ollamaUrl: "http://localhost:11434",
      samplesPerModel: 1,
      systemPrompt: "Be concise.",
      userMessages: ["Continue."],
      models: [`paused-model-${crypto.randomUUID()}`],
      parameters: { temperature: 0.2, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 64 },
    });
    benchmarkStore.pauseRun(run.id);
    enqueueBenchmark(run.id);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(benchmarkStore.getRun(run.id)?.paused).toBe(true);
    expect(benchmarkStore.getRun(run.id)?.status).toBe("RUNNING");

    benchmarkStore.resumeRun(run.id);
    const completed = await waitForRun(run.id);
    expect(completed.status).toBe("COMPLETED");
    expect(completed.paused).toBe(false);
  });

  it("runs a benchmark model using FreeToken provider", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            'data: {"id":"chatcmpl-ft","choices":[{"delta":{"content":"FreeToken response"}}]}',
            'data: {"id":"chatcmpl-ft","choices":[{"delta":{"content":" completed."}}]}',
            'data: {"id":"chatcmpl-ft","choices":[],"usage":{"prompt_tokens":5,"completion_tokens":12,"total_tokens":17}}',
            "data: [DONE]",
          ].join("\n\n"),
          { status: 200 },
        ),
      ),
    );

    const run = benchmarkStore.createRun({
      provider: "freetoken",
      providerUrl: "http://localhost:8000/v1",
      samplesPerModel: 1,
      systemPrompt: "Be concise.",
      userMessages: ["Hello FreeToken."],
      models: [`freetoken-model-${crypto.randomUUID()}`],
      parameters: { temperature: 0.2, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 64 },
    });

    expect(run.provider).toBe("freetoken");
    expect(run.providerUrl).toBe("http://localhost:8000/v1");

    enqueueBenchmark(run.id);
    const completed = await waitForRun(run.id);
    const result = completed.results[0];

    expect(completed.status).toBe("COMPLETED");
    expect(result.status).toBe("COMPLETED");
    expect(result.responseText).toBe("FreeToken response completed.");
    expect(result.inputTokens).toBe(5);
    expect(result.outputTokens).toBe(12);
  });

  it("runs a benchmark model using llama.cpp provider with timings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            'data: {"choices":[{"delta":{"content":"llama.cpp response"}}]}',
            'data: {"choices":[{"delta":{"content":" answering."}}]}',
            'data: {"timings":{"prompt_n":8,"predicted_n":16,"predicted_ms":200,"predicted_per_second":80.0}}',
            "data: [DONE]",
          ].join("\n\n"),
          { status: 200 },
        ),
      ),
    );

    const run = benchmarkStore.createRun({
      provider: "llamacpp",
      providerUrl: "http://localhost:8080",
      samplesPerModel: 1,
      systemPrompt: "Be concise.",
      userMessages: ["Hello llama.cpp."],
      models: [`llamacpp-model-${crypto.randomUUID()}`],
      parameters: { temperature: 0.2, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 64 },
    });

    expect(run.provider).toBe("llamacpp");
    expect(run.providerUrl).toBe("http://localhost:8080");

    enqueueBenchmark(run.id);
    const completed = await waitForRun(run.id);
    const result = completed.results[0];

    expect(completed.status).toBe("COMPLETED");
    expect(result.status).toBe("COMPLETED");
    expect(result.responseText).toBe("llama.cpp response answering.");
    expect(result.inputTokens).toBe(8);
    expect(result.outputTokens).toBe(16);
    expect(result.tokPerSec).toBe(80);
  });
});

async function waitForRun(id: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const run = benchmarkStore.getRun(id);
    if (run && ["COMPLETED", "FAILED", "CANCELLED"].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for benchmark run.");
}
