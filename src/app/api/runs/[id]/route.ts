import { NextResponse } from "next/server";
import { benchmarkStore } from "@/lib/benchmark-store";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await benchmarkStore.hydrate();
  const { id } = await params;
  const run = process.env.REDIS_URL ? await benchmarkStore.refreshRun(id) : benchmarkStore.getRun(id);
  return run ? NextResponse.json({ run }) : NextResponse.json({ error: "Run not found." }, { status: 404 });
}
