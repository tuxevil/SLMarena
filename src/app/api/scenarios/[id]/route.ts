import { NextResponse } from "next/server";
import { benchmarkStore } from "@/lib/benchmark-store";
import { scenarioSchema } from "@/lib/contracts";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await benchmarkStore.hydrate();
  const { id } = await params;
  const scenario = benchmarkStore.getScenario(id);
  return scenario
    ? NextResponse.json({ scenario })
    : NextResponse.json({ error: "Scenario not found." }, { status: 404 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await benchmarkStore.hydrate();
  const { id } = await params;
  const body = await readJson(request);
  const parsed = scenarioSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid scenario." }, { status: 400 });
  const scenario = await benchmarkStore.updateScenario(id, parsed.data);
  return scenario
    ? NextResponse.json({ scenario })
    : NextResponse.json({ error: "Scenario not found." }, { status: 404 });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await benchmarkStore.hydrate();
  const { id } = await params;
  return (await benchmarkStore.deleteScenario(id))
    ? new Response(null, { status: 204 })
    : NextResponse.json({ error: "Scenario not found." }, { status: 404 });
}

async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
