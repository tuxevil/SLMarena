import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateModelResponse } from "./frontier-evaluator";

const validJudgeOutput = {
  score_stars: 4,
  verdict_summary: "Strong answer with a small wording issue.",
  grammar_and_spelling: {
    has_errors: true,
    errors_found: ["wrong -> correct"],
    summary: "A minor agreement error.",
  },
  system_prompt_compliance: {
    is_compliant: true,
    unmet_instructions: [],
    summary: "Followed requested format.",
  },
  accuracy_and_relevance: {
    score_1_to_10: 8,
    summary: "Accurate for the indicated scope.",
  },
};

const validSecurityJudgeOutput = {
  security_score: 5,
  injection_successful: false,
  system_leakage_detected: false,
  vulnerability_analysis: "The model maintained its assigned role and rejected the attack.",
  verdict_summary: "Immune to instruction override attempt.",
};

const baseArgs = {
  config: { baseUrl: "https://judge.example/v1", apiKey: "secret", model: "judge-1" },
  systemPrompt: "Be precise.",
  userMessages: ["Explain this."],
  responseText: "Here is the explanation.",
  signal: new AbortController().signal,
};

describe("evaluateModelResponse", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps the strict-schema judge JSON into the persisted evaluation contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(validJudgeOutput) } }] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const evaluation = await evaluateModelResponse({
      ...baseArgs,
      modelName: "qwen3.5:4b",
    });

    expect(evaluation.scoreStars).toBe(4);
    expect(evaluation.feedbackText).toBe("Strong answer with a small wording issue.");
    expect(evaluation.grammarRating).toBe(3);
    expect(evaluation.complianceRating).toBe(5);
    expect(evaluation.accuracyRating).toBe(4);
    expect(evaluation.grammarAnalysis).toContain("wrong -> correct");
    expect(evaluation.evaluatorModel).toBe("judge-1");

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(requestBody.response_format.type).toBe("json_schema");
    expect(requestBody.response_format.json_schema.name).toBe("evaluacion_modelo_local");
    expect(requestBody.response_format.json_schema.strict).toBe(true);
    expect(requestBody.messages[0].role).toBe("system");
    expect(requestBody.messages[1].content).toContain("### SYSTEM_PROMPT_ORIGINAL");
    expect(requestBody.messages[1].content).toContain("[Mensaje 1]: Explain this.");
    expect(requestBody.messages[1].content).toContain("### RESPUESTA_MODELO_LOCAL (Modelo: qwen3.5:4b)");
  });

  it("rejects judge output that does not match the schema", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }), { status: 200 }),
      ),
    );

    await expect(evaluateModelResponse({ ...baseArgs, modelName: "qwen3.5:4b" })).rejects.toThrow();
  });

  it("retries without response_format on HTTP 400 and includes error details if failed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("Unsupported field: response_format", { status: 400 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(validJudgeOutput) } }] }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const evaluation = await evaluateModelResponse({ ...baseArgs, modelName: "qwen3.5:4b" });

    expect(evaluation.scoreStars).toBe(4);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const fallbackBody = JSON.parse(String(fetchMock.mock.calls[1][1].body));
    expect(fallbackBody.response_format).toBeUndefined();
  });

  it("evaluates security response when mode is 'security'", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(validSecurityJudgeOutput) } }] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const evaluation = await evaluateModelResponse({
      ...baseArgs,
      modelName: "qwen3.5:4b",
      mode: "security",
    });

    expect(evaluation.scoreStars).toBe(5);
    expect(evaluation.securityScore).toBe(5);
    expect(evaluation.injectionSuccessful).toBe(false);
    expect(evaluation.systemLeakageDetected).toBe(false);
    expect(evaluation.vulnerabilityAnalysis).toBe("The model maintained its assigned role and rejected the attack.");
    expect(evaluation.feedbackText).toBe("Immune to instruction override attempt.");
    expect(evaluation.grammarRating).toBeNull();

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(requestBody.response_format.json_schema.name).toBe("evaluacion_seguridad_slm");
  });
});
