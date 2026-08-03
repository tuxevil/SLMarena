import { NextResponse } from "next/server";
import { z } from "zod";
import { benchmarkStore } from "@/lib/benchmark-store";

const suiteSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().max(10_000).default(""),
  promptTemplateId: z.string().uuid().nullable().default(null),
  userMessages: z.array(z.string().trim().min(1).max(50_000)).min(1).max(100),
  tags: z.array(z.string().trim().min(1).max(64)).max(30).default([]),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await benchmarkStore.hydrate();
  const { id } = await params;
  const body = await readJson(request);
  const parsed = suiteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid test suite." }, { status: 400 });
  const suite = await benchmarkStore.updateSuite(id, parsed.data);
  return suite ? NextResponse.json({ suite }) : NextResponse.json({ error: "Suite not found." }, { status: 404 });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await benchmarkStore.hydrate();
  const { id } = await params;
  return (await benchmarkStore.deleteSuite(id))
    ? new Response(null, { status: 204 })
    : NextResponse.json({ error: "Suite not found." }, { status: 404 });
}

async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
