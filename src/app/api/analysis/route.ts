import { NextResponse } from "next/server";
import { aggregateScenarioAnalysis } from "@/lib/database";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const scenarioId = url.searchParams.get("scenarioId")?.trim() || null;
  const systemPrompt = url.searchParams.get("systemPrompt") ?? "";
  let userMessages: string[] = [];
  const raw = url.searchParams.get("userMessages");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) userMessages = parsed.map(String);
    } catch {
      return NextResponse.json({ error: "Invalid userMessages parameter." }, { status: 400 });
    }
  }
  if (!scenarioId && !systemPrompt.trim()) {
    return NextResponse.json({ error: "Provide scenarioId or systemPrompt to identify the scenario." }, { status: 400 });
  }
  return NextResponse.json(await aggregateScenarioAnalysis({ scenarioId, systemPrompt, userMessages }));
}
