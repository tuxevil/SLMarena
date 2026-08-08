import { afterEach, describe, expect, it, vi } from "vitest";
import { getArenaLeaderboard } from "./leaderboard";

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

describe("getArenaLeaderboard", () => {
  afterEach(() => vi.unstubAllGlobals());

  const base = {
    kpis: { totalBenchmarkRuns: 2 },
    weights: { quality: 40, security: 40, speed: 20 },
    models: [
      {
        modelName: "fast",
        avgTokPerSec: 90,
        avgQualityStars: 3,
        securityResilienceScore: 10,
        arenaIndex: 60,
      },
      {
        modelName: "secure",
        avgTokPerSec: 20,
        avgQualityStars: 4,
        securityResilienceScore: 95,
        arenaIndex: 80,
      },
      {
        modelName: "quality",
        avgTokPerSec: 30,
        avgQualityStars: 5,
        securityResilienceScore: 50,
        arenaIndex: 70,
      },
    ],
  };

  it("sorts by ArenaIndex by default", async () => {
    stubFetch(base);
    const result = (await getArenaLeaderboard({})) as { models: Array<{ modelName: string }> };
    expect(result.models.map((m) => m.modelName)).toEqual(["secure", "quality", "fast"]);
  });

  it("sorts by Velocidad", async () => {
    stubFetch(base);
    const result = (await getArenaLeaderboard({ sort_by: "Velocidad" })) as { models: Array<{ modelName: string }> };
    expect(result.models.map((m) => m.modelName)).toEqual(["fast", "quality", "secure"]);
  });

  it("sorts by Calidad", async () => {
    stubFetch(base);
    const result = (await getArenaLeaderboard({ sort_by: "Calidad" })) as { models: Array<{ modelName: string }> };
    expect(result.models.map((m) => m.modelName)).toEqual(["quality", "secure", "fast"]);
  });

  it("sorts by Seguridad", async () => {
    stubFetch(base);
    const result = (await getArenaLeaderboard({ sort_by: "Seguridad" })) as { models: Array<{ modelName: string }> };
    expect(result.models.map((m) => m.modelName)).toEqual(["secure", "quality", "fast"]);
  });

  it("filters by min_tokens_sec", async () => {
    stubFetch(base);
    const result = (await getArenaLeaderboard({ min_tokens_sec: 40 })) as { models: Array<{ modelName: string }> };
    expect(result.models.map((m) => m.modelName)).toEqual(["fast"]);
  });

  it("sends the category query parameter", async () => {
    stubFetch(base);
    await getArenaLeaderboard({ category: "SECURITY" });
    const fetchMock = vi.mocked(fetch);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("category=SECURITY");
  });

  it("sends the difficulty query parameter", async () => {
    stubFetch(base);
    await getArenaLeaderboard({ difficulty: "hard" });
    const fetchMock = vi.mocked(fetch);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("difficulty=hard");
  });

  it("defaults difficulty to ALL", async () => {
    stubFetch(base);
    await getArenaLeaderboard({});
    const fetchMock = vi.mocked(fetch);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("difficulty=ALL");
  });

  it("surfaces API errors", async () => {
    stubFetch({ error: "Internal failure." }, 500);
    await expect(getArenaLeaderboard({})).rejects.toThrow("Internal failure.");
  });
});