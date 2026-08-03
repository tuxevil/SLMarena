import { describe, expect, it } from "vitest";
import { validateEvaluatorEndpoint, validateOllamaEndpoint } from "./endpoints";

describe("endpoint validation", () => {
  it("allows a private Ollama endpoint", () => {
    expect(validateOllamaEndpoint("http://192.168.1.25:11434")).toBeNull();
  });

  it("requires HTTPS for a public evaluator", () => {
    expect(validateEvaluatorEndpoint("http://judge.example/v1")).toContain("HTTPS");
    expect(validateEvaluatorEndpoint("https://judge.example/v1")).toBeNull();
  });
});
