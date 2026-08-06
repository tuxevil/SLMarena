import { NextResponse } from "next/server";
import { benchmarkStore } from "@/lib/benchmark-store";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; resultId: string }> }) {
  await benchmarkStore.hydrate();
  const { id, resultId } = await params;
  const run = benchmarkStore.getStoredRun(id);
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });

  const result = run.results.find((item) => item.id === resultId);
  if (!result) return NextResponse.json({ error: "Result not found." }, { status: 404 });
  return NextResponse.json({ runId: run.id, result });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; resultId: string }> }) {
  await benchmarkStore.hydrate();
  const { id, resultId } = await params;
  const run = benchmarkStore.getStoredRun(id);
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });

  const removed = await benchmarkStore.deleteResult(id, resultId);
  if (!removed) return NextResponse.json({ error: "Result not found." }, { status: 404 });
  await benchmarkStore.flush(id);
  return new NextResponse(null, { status: 204 });
}
