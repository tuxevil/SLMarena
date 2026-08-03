import { NextResponse } from "next/server";
import { benchmarkStore } from "@/lib/benchmark-store";
import { z } from "zod";

const scenarioSchema = z.object({
  name: z.string().trim().min(1).max(255),
  systemPrompt: z.string().trim().min(1).max(50_000),
  userMessages: z.array(z.string().trim().min(1).max(50_000)).min(1).max(100),
});

export async function GET() {
  await benchmarkStore.hydrate();
  return NextResponse.json({ scenarios: benchmarkStore.listScenarios() });
}

export async function POST(request: Request) {
  await benchmarkStore.hydrate();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = scenarioSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid scenario." }, { status: 400 });
  return NextResponse.json({ scenario: await benchmarkStore.createScenario(parsed.data) }, { status: 201 });
}
