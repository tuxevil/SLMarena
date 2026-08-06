import { z } from "zod";
import { slmarenaFetch } from "./http-client";

export const leaderboardInputSchema = {
  sort_by: z
    .enum(["ArenaIndex", "Calidad", "Velocidad", "Seguridad"])
    .optional()
    .describe("Criterio de ordenamiento del ranking. Default: ArenaIndex."),
  min_tokens_sec: z
    .number()
    .min(0)
    .optional()
    .describe("Filtra modelos cuya velocidad promedio sea inferior a este umbral (tokens/seg)."),
  category: z
    .enum(["GENERAL", "SECURITY", "ALL"])
    .optional()
    .describe("Filtrar el ranking por categoría de rendimiento."),
};

export type LeaderboardInput = {
  sort_by?: "ArenaIndex" | "Calidad" | "Velocidad" | "Seguridad";
  min_tokens_sec?: number;
  category?: "GENERAL" | "SECURITY" | "ALL";
};

export type LeaderboardRow = {
  modelName: string;
  paramSizeLabel: string;
  paramSizeValue: number;
  totalRuns: number;
  avgTokPerSec: number | null;
  avgTtftMs: number | null;
  avgQualityStars: number | null;
  avgGrammar: number | null;
  avgCompliance: number | null;
  avgAccuracy: number | null;
  avgOutputTokens: number | null;
  avgDurationMs: number | null;
  attackSuccessRatePct: number | null;
  securityResilienceScore: number | null;
  radar: Record<string, number>;
  arenaIndex: number;
};

type LeaderboardPayload = {
  kpis: unknown;
  weights: unknown;
  models: LeaderboardRow[];
};

function sortRanking(rows: LeaderboardRow[], sortBy: NonNullable<LeaderboardInput["sort_by"]>) {
  const sorted = [...rows];
  switch (sortBy) {
    case "Calidad":
      return sorted.sort((a, b) => (b.avgQualityStars ?? 0) - (a.avgQualityStars ?? 0));
    case "Velocidad":
      return sorted.sort((a, b) => (b.avgTokPerSec ?? 0) - (a.avgTokPerSec ?? 0));
    case "Seguridad":
      return sorted.sort(
        (a, b) =>
          (b.securityResilienceScore ?? 0) - (a.securityResilienceScore ?? 0) ||
          (a.attackSuccessRatePct ?? 0) - (b.attackSuccessRatePct ?? 0),
      );
    default:
      return sorted.sort((a, b) => (b.arenaIndex ?? 0) - (a.arenaIndex ?? 0));
  }
}

export async function getArenaLeaderboard(args: LeaderboardInput): Promise<unknown> {
  const query = new URLSearchParams({ category: args.category ?? "ALL" });
  const data = await slmarenaFetch<LeaderboardPayload>(`/api/leaderboard?${query.toString()}`);

  let rows = data.models ?? [];
  if (args.min_tokens_sec != null) {
    rows = rows.filter((row) => (row.avgTokPerSec ?? 0) >= args.min_tokens_sec!);
  }
  const models = sortRanking(rows, args.sort_by ?? "ArenaIndex");

  return { kpis: data.kpis, weights: data.weights, models };
}