import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestScenario, listTestScenarios } from "./scenarios";
import { getModelProfile } from "./profile";

function stubFetch(payload: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

const scenarios = [
  { id: "s1", name: "Leak", category: "SECURITY", attackType: "SYSTEM_PROMPT_LEAKAGE", systemPrompt: "p", userMessages: ["m"], createdAt: "t", updatedAt: "t" },
  { id: "s2", name: "Chat", category: "GENERAL", attackType: null, systemPrompt: "p", userMessages: ["m"], createdAt: "t", updatedAt: "t" },
];

describe("listTestScenarios", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns all scenarios without a category filter", async () => {
    stubFetch({ scenarios });
    const result = (await listTestScenarios({})) as { scenarios: Array<{ id: string }> };
    expect(result.scenarios).toHaveLength(2);
  });

  it("filters by category", async () => {
    stubFetch({ scenarios });
    const result = (await listTestScenarios({ category: "SECURITY" })) as { scenarios: Array<{ id: string }> };
    expect(result.scenarios.map((s) => s.id)).toEqual(["s1"]);
  });
});

describe("createTestScenario", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts the scenario and returns it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ scenario: { ...scenarios[0], id: "new" } }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = (await createTestScenario({
      name: "Base64 v2",
      category: "SECURITY",
      attack_vector: "ENCODING_OBFUSCATION",
      system_prompt: "guard",
      user_messages: ["decode"],
    })) as { scenario: { id: string } };

    expect(result.scenario.id).toBe("new");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/scenarios");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.attackType).toBe("ENCODING_OBFUSCATION");
    expect(body.systemPrompt).toBe("guard");
    expect(body.userMessages).toEqual(["decode"]);
  });
});

describe("getModelProfile", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns found=false when the model is absent", async () => {
    stubFetch({ models: [{ modelName: "other" }] });
    const result = (await getModelProfile({ model_name: "ghost" })) as { found: boolean; profile: unknown };
    expect(result.found).toBe(false);
    expect(result.profile).toBeNull();
  });

  it("returns leaderboard row and scenario stats when scenario_id is given", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ models: [{ modelName: "qwen2.5:7b", arenaIndex: 88 }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            models: [{ modelName: "qwen2.5:7b", samples: 2, averageStars: 4.5, asrPercent: 0 }],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", mock);

    const result = (await getModelProfile({
      model_name: "qwen2.5:7b",
      scenario_id: "11111111-1111-4111-8111-111111111111",
    })) as { found: boolean; profile: { arenaIndex: number }; scenarioStats: { samples: number } };

    expect(result.found).toBe(true);
    expect(result.profile.arenaIndex).toBe(88);
    expect(result.scenarioStats.samples).toBe(2);
    expect(mock.mock.calls[1][0]).toContain("/api/analysis?scenarioId=");
  });
});