import { slmarenaFetch } from "./http-client";

export async function readLeaderboardResource(): Promise<{ uri: string; mimeType: string; text: string }> {
  const data = await slmarenaFetch<unknown>("/api/leaderboard?category=ALL");
  return {
    uri: "slmarena://leaderboard",
    mimeType: "application/json",
    text: JSON.stringify(data, null, 2),
  };
}

export async function readScenariosResource(): Promise<{ uri: string; mimeType: string; text: string }> {
  const data = await slmarenaFetch<unknown>("/api/scenarios");
  return {
    uri: "slmarena://scenarios",
    mimeType: "application/json",
    text: JSON.stringify(data, null, 2),
  };
}