import { describe, expect, it } from "vitest";
import { extractParamSize, aggregateLeaderboard } from "@/lib/database";

describe("Leaderboard Unit Tests (SLMArena v1.3)", () => {
  it("extracts model parameter sizes correctly from names", () => {
    expect(extractParamSize("Qwen-2.5-7B")).toEqual({ label: "7.6B", value: 7.6 });
    expect(extractParamSize("llama3.2:3b")).toEqual({ label: "3.2B", value: 3.2 });
    expect(extractParamSize("phi-3.5-mini")).toEqual({ label: "3.8B", value: 3.8 });
    expect(extractParamSize("gemma2:9b")).toEqual({ label: "9.0B", value: 9.0 });
    expect(extractParamSize("custom-model-14b")).toEqual({ label: "14B", value: 14 });
    expect(extractParamSize("unknown-slm-model")).toEqual({ label: "3.0B", value: 3.0 });
  });

  it("calculates aggregate leaderboard telemetry and Arena Index", async () => {
    const data = await aggregateLeaderboard({
      category: "ALL",
      weights: { quality: 40, security: 40, speed: 20 },
    });

    expect(data.weights).toEqual({ quality: 40, security: 40, speed: 20 });
    expect(data.kpis).toBeDefined();
    expect(Array.isArray(data.models)).toBe(true);
  });
});
