import { beforeEach, describe, expect, it, vi } from "vitest";
import { benchmarkStore } from "./benchmark-store";

vi.mock("@/lib/database", async () => {
  const evaluatorRows = new Map<
    string,
    { id: string; label: string; baseUrl: string; model: string; apiKeyConfigured: boolean }
  >();
  let seq = 0;

  return {
    loadPersistedState: vi.fn(async () => null),
    loadPersistedSettings: vi.fn(async () => null),
    persistScenario: vi.fn(),
    persistHumanReview: vi.fn(),
    queuePersistedRun: vi.fn(),
    waitForPersistedRun: vi.fn(async () => {}),
    persistSettings: vi.fn(async () => {}),
    setPersistedActiveEvaluator: vi.fn(async () => {}),
    loadPersistedEvaluatorKey: vi.fn(async (id: string) => (evaluatorRows.get(id)?.apiKeyConfigured ? `key-for-${id}` : null)),
    upsertPersistedEvaluator: vi.fn(async (input: {
      id?: string;
      label?: string;
      baseUrl: string;
      model: string;
      apiKey?: string;
      clearKey?: boolean;
    }) => {
      const id = input.id ?? `ev-${++seq}`;
      const existing = evaluatorRows.get(id);
      const apiKeyConfigured = input.apiKey ? true : input.clearKey ? false : Boolean(existing?.apiKeyConfigured);
      const entry = {
        id,
        label: input.label?.trim() || input.model,
        baseUrl: input.baseUrl,
        model: input.model,
        apiKeyConfigured,
      };
      evaluatorRows.set(id, entry);
      return entry;
    }),
    deletePersistedEvaluator: vi.fn(async (id: string) => evaluatorRows.delete(id)),
  };
});

describe("benchmarkStore evaluator catalog", () => {
  beforeEach(async () => {
    await benchmarkStore.hydrate();
    for (const evaluator of [...benchmarkStore.getSettings().evaluators]) {
      await benchmarkStore.deleteEvaluator(evaluator.id);
    }
  });

  it("adds an evaluator and marks it active when none exists", async () => {
    const entry = await benchmarkStore.addEvaluator({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      apiKey: "sk-123",
    });

    expect(entry.label).toBe("gpt-4o-mini");
    expect(benchmarkStore.getSettings().activeEvaluatorId).toBe(entry.id);
    expect(benchmarkStore.getSettings().evaluators).toHaveLength(1);
    expect(benchmarkStore.getSettings().evaluatorModel).toBe("gpt-4o-mini");
    expect(benchmarkStore.getSettings().evaluatorBaseUrl).toBe("https://api.openai.com/v1");
    expect(benchmarkStore.getEvaluatorConfig()).toEqual({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      apiKey: "sk-123",
    });
  });

  it("adds a second evaluator without stealing the active slot", async () => {
    const first = await benchmarkStore.addEvaluator({ baseUrl: "https://a.example/v1", model: "judge-a", apiKey: "k-a" });
    const second = await benchmarkStore.addEvaluator({ baseUrl: "https://b.example/v1", model: "judge-b", apiKey: "k-b" });

    expect(benchmarkStore.getSettings().evaluators).toHaveLength(2);
    expect(benchmarkStore.getSettings().activeEvaluatorId).toBe(first.id);
    expect(benchmarkStore.getEvaluatorConfig()?.model).toBe("judge-a");
    expect(second).toBeDefined();
  });

  it("makes an evaluator active on demand and loads its decrypted key", async () => {
    const first = await benchmarkStore.addEvaluator({ baseUrl: "https://a.example/v1", model: "judge-a", apiKey: "k-a" });
    const second = await benchmarkStore.addEvaluator({ baseUrl: "https://b.example/v1", model: "judge-b", apiKey: "k-b" });

    await benchmarkStore.setActiveEvaluator(second.id);

    expect(benchmarkStore.getSettings().activeEvaluatorId).toBe(second.id);
    expect(benchmarkStore.getEvaluatorConfig()?.model).toBe("judge-b");
    expect(benchmarkStore.getEvaluatorConfig()?.apiKey).toBe(`key-for-${second.id}`);
    expect(first.id).not.toBe(second.id);
  });

  it("updates an evaluator while preserving its stored key", async () => {
    const entry = await benchmarkStore.addEvaluator({ baseUrl: "https://a.example/v1", model: "judge-a", apiKey: "k-a" });

    const updated = await benchmarkStore.updateEvaluator(entry.id, { label: "Renamed", model: "judge-a-v2" });

    expect(updated?.label).toBe("Renamed");
    expect(updated?.model).toBe("judge-a-v2");
    expect(updated?.apiKeyConfigured).toBe(true);
    expect(benchmarkStore.getSettings().evaluators.find((e) => e.id === entry.id)?.model).toBe("judge-a-v2");
  });

  it("deleting the active evaluator clears the active slot", async () => {
    const entry = await benchmarkStore.addEvaluator({ baseUrl: "https://a.example/v1", model: "judge-a", apiKey: "k-a" });

    const deleted = await benchmarkStore.deleteEvaluator(entry.id);

    expect(deleted).toBe(true);
    expect(benchmarkStore.getSettings().evaluators).toHaveLength(0);
    expect(benchmarkStore.getSettings().activeEvaluatorId).toBeNull();
    expect(benchmarkStore.getEvaluatorConfig()).toBeUndefined();
  });

  it("legacy updateSettings fields patch the active evaluator", async () => {
    const entry = await benchmarkStore.addEvaluator({ baseUrl: "https://a.example/v1", model: "judge-a", apiKey: "k-a" });

    await benchmarkStore.updateSettings({
      clearEvaluatorApiKey: false,
      evaluatorModel: "judge-a-v2",
    });

    expect(benchmarkStore.getSettings().evaluatorModel).toBe("judge-a-v2");
    expect(benchmarkStore.getSettings().activeEvaluatorId).toBe(entry.id);
    expect(benchmarkStore.getEvaluatorConfig()?.model).toBe("judge-a-v2");
  });

  it("updateSettings can switch the active evaluator by id", async () => {
    const first = await benchmarkStore.addEvaluator({ baseUrl: "https://a.example/v1", model: "judge-a", apiKey: "k-a" });
    const second = await benchmarkStore.addEvaluator({ baseUrl: "https://b.example/v1", model: "judge-b", apiKey: "k-b" });

    await benchmarkStore.updateSettings({ clearEvaluatorApiKey: false, activeEvaluatorId: second.id });

    expect(benchmarkStore.getSettings().activeEvaluatorId).toBe(second.id);
    expect(benchmarkStore.getEvaluatorConfig()?.model).toBe("judge-b");
    expect(first.id).not.toBe(second.id);
  });
});
