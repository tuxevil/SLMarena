import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeChatEndpoint, streamOpenAICompatibleChat } from "./openai-client";

describe("normalizeChatEndpoint", () => {
  it("normalizes base URLs correctly", () => {
    expect(normalizeChatEndpoint("http://localhost:8000")).toBe("http://localhost:8000/v1/chat/completions");
    expect(normalizeChatEndpoint("http://localhost:8000/")).toBe("http://localhost:8000/v1/chat/completions");
    expect(normalizeChatEndpoint("http://localhost:8000/v1")).toBe("http://localhost:8000/v1/chat/completions");
    expect(normalizeChatEndpoint("http://localhost:8000/v1/")).toBe("http://localhost:8000/v1/chat/completions");
    expect(normalizeChatEndpoint("http://localhost:8000/v1/chat/completions")).toBe("http://localhost:8000/v1/chat/completions");
  });
});

describe("streamOpenAICompatibleChat", () => {
  afterEach(() => vi.restoreAllMocks());

  it("parses streamed SSE chunks and calculates telemetry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hello"}}]}',
            'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":" world"}}]}',
            'data: {"id":"chatcmpl-1","choices":[],"usage":{"prompt_tokens":15,"completion_tokens":25,"total_tokens":40}}',
            "data: [DONE]",
          ].join("\n\n"),
          { status: 200 },
        ),
      ),
    );

    const result = await streamOpenAICompatibleChat({
      endpoint: "http://localhost:8000/v1",
      model: "gpt-model",
      messages: [{ role: "user", content: "Hello" }],
      parameters: {
        temperature: 0.2,
        numCtx: 8192,
        topP: 0.9,
        repeatPenalty: 1.1,
        numPredict: 512,
      },
      signal: new AbortController().signal,
      providerName: "FreeToken",
    });

    expect(result.responseText).toBe("Hello world");
    expect(result.inputTokens).toBe(15);
    expect(result.outputTokens).toBe(25);
    expect(typeof result.ttftMs).toBe("number");
    expect(typeof result.totalDurationMs).toBe("number");
  });

  it("separates reasoning_content into thinking for reasoning models", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            'data: {"id":"chatcmpl-1","choices":[{"delta":{"reasoning_content":"Step 1: think"}}]}',
            'data: {"id":"chatcmpl-1","choices":[{"delta":{"reasoning_content":" Step 2: verify"}}]}',
            'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Result is 42."}}]}',
            "data: [DONE]",
          ].join("\n\n"),
          { status: 200 },
        ),
      ),
    );

    const result = await streamOpenAICompatibleChat({
      endpoint: "http://localhost:8080",
      model: "deepseek-r1",
      messages: [{ role: "user", content: "Solve math" }],
      parameters: {
        temperature: 0.2,
        numCtx: 8192,
        topP: 0.9,
        repeatPenalty: 1.1,
        numPredict: 512,
      },
      signal: new AbortController().signal,
      providerName: "llama.cpp",
    });

    expect(result.responseText).toBe("Result is 42.");
    expect(result.thinking).toBe("Step 1: think Step 2: verify");
  });

  it("extracts <think>...</think> tags if reasoning is in content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"<think>Reasoning here</think>Final output"}}]}',
            "data: [DONE]",
          ].join("\n\n"),
          { status: 200 },
        ),
      ),
    );

    const result = await streamOpenAICompatibleChat({
      endpoint: "http://localhost:8000/v1",
      model: "qwen-qwq",
      messages: [{ role: "user", content: "Query" }],
      parameters: {
        temperature: 0.2,
        numCtx: 8192,
        topP: 0.9,
        repeatPenalty: 1.1,
        numPredict: 512,
      },
      signal: new AbortController().signal,
      providerName: "FreeToken",
    });

    expect(result.responseText).toBe("Final output");
    expect(result.thinking).toBe("Reasoning here");
  });

  it("extracts llama.cpp timings when available", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            'data: {"choices":[{"delta":{"content":"llama output"}}]}',
            'data: {"timings":{"prompt_n":10,"predicted_n":30,"predicted_ms":500,"predicted_per_second":60.0}}',
            "data: [DONE]",
          ].join("\n\n"),
          { status: 200 },
        ),
      ),
    );

    const result = await streamOpenAICompatibleChat({
      endpoint: "http://localhost:8080",
      model: "llama-3.2",
      messages: [{ role: "user", content: "Hello" }],
      parameters: {
        temperature: 0.2,
        numCtx: 8192,
        topP: 0.9,
        repeatPenalty: 1.1,
        numPredict: 512,
      },
      signal: new AbortController().signal,
      providerName: "llama.cpp",
    });

    expect(result.responseText).toBe("llama output");
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(30);
    expect(result.tokPerSec).toBe(60);
    expect(result.evalDurationMs).toBe(500);
  });
});
