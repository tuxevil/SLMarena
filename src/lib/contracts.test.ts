import { describe, expect, it } from "vitest";
import { createRunSchema } from "./contracts";

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
});
