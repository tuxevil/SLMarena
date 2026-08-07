import { NextResponse } from "next/server";
import { benchmarkStore } from "@/lib/benchmark-store";
import { evaluatorUpdateSchema } from "@/lib/contracts";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await benchmarkStore.hydrate();
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = evaluatorUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid evaluator.", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const evaluator = await benchmarkStore.updateEvaluator(id, parsed.data);
    if (!evaluator) {
      return NextResponse.json({ error: `Evaluator ${id} was not found.` }, { status: 404 });
    }
    return NextResponse.json({ settings: benchmarkStore.getSettings(), evaluator });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not persist evaluator." },
      { status: 503 },
    );
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await benchmarkStore.hydrate();
  const { id } = await params;
  const deleted = await benchmarkStore.deleteEvaluator(id);
  if (!deleted) {
    return NextResponse.json({ error: `Evaluator ${id} was not found.` }, { status: 404 });
  }
  return NextResponse.json({ settings: benchmarkStore.getSettings(), deleted: true });
}
