import { describe, expect, it } from "vitest";
import { createRunSchema, settingsUpdateSchema } from "./contracts";

describe("settingsUpdateSchema", () => {
  it("accepts a partial patch without clobbering fields that were not sent", () => {
    const parsed = settingsUpdateSchema.safeParse({
      ollamaUrl: "http://localhost:11434",
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.ollamaUrl).toBe("http://localhost:11434");
    expect(parsed.data?.parameters).toBeUndefined();
    expect(parsed.data?.evaluatorBaseUrl).toBeUndefined();
  });

  it("accepts the full settings payload", () => {
    const parsed = settingsUpdateSchema.safeParse({
      ollamaUrl: "http://localhost:11434",
      evaluatorBaseUrl: "https://judge.example/v1",
      evaluatorModel: "judge",
      clearEvaluatorApiKey: false,
      parameters: { temperature: 0.2, numCtx: 16384, topP: 0.9, repeatPenalty: 1.1, numPredict: 16384 },
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.parameters?.numCtx).toBe(16384);
  });
});


describe("createRunSchema", () => {
  it("accepts a benchmark with HTTP endpoints and bounded parameters", () => {
    const result = createRunSchema.safeParse({
      ollamaUrl: "http://localhost:11434",
      systemPrompt: "Be concise.",
      userMessages: ["Explain queues."],
      models: ["llama3.2"],
      parameters: {
        temperature: 0.2,
        numCtx: 8192,
        topP: 0.9,
        repeatPenalty: 1.1,
        numPredict: 512,
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects non-HTTP endpoints", () => {
    const result = createRunSchema.safeParse({
      ollamaUrl: "file:///etc/passwd",
      systemPrompt: "Be concise.",
      userMessages: ["Explain queues."],
      models: ["llama3.2"],
      parameters: {
        temperature: 0.2,
        numCtx: 8192,
        topP: 0.9,
        repeatPenalty: 1.1,
        numPredict: 512,
      },
    });

    expect(result.success).toBe(false);
  });

  it("accepts a scenario id and bounds samples per model", () => {
    const parsed = createRunSchema.safeParse({
      ollamaUrl: "http://localhost:11434",
      scenarioId: "6f6fd3a8-9b7b-4d5e-b2b3-4f3d6c1e2a1b",
      samplesPerModel: 5,
      systemPrompt: "Be concise.",
      userMessages: ["Explain queues."],
      models: ["llama3.2"],
      parameters: {
        temperature: 0.2,
        numCtx: 8192,
        topP: 0.9,
        repeatPenalty: 1.1,
        numPredict: 512,
      },
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.scenarioId).toBe("6f6fd3a8-9b7b-4d5e-b2b3-4f3d6c1e2a1b");
    expect(parsed.data?.samplesPerModel).toBe(5);
  });

  it("defaults samples per model to one and rejects out-of-range values", () => {
    expect(createRunSchema.parse({
      ollamaUrl: "http://localhost:11434",
      systemPrompt: "Be concise.",
      userMessages: ["Explain queues."],
      models: ["llama3.2"],
      parameters: { temperature: 0.2, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 512 },
    }).samplesPerModel).toBe(1);

    expect(createRunSchema.safeParse({
      ollamaUrl: "http://localhost:11434",
      samplesPerModel: 25,
      systemPrompt: "Be concise.",
      userMessages: ["Explain queues."],
      models: ["llama3.2"],
      parameters: { temperature: 0.2, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 512 },
    }).success).toBe(false);
  });
});
