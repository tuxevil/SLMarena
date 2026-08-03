import { NextResponse } from "next/server";
import { benchmarkStore } from "@/lib/benchmark-store";
import { z } from "zod";

const promptSchema = z.object({
  title: z.string().trim().min(1).max(255),
  systemPrompt: z.string().trim().min(1).max(50_000),
  tags: z.array(z.string().trim().min(1).max(64)).max(30).default([]),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await benchmarkStore.hydrate();
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const parsed = promptSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid prompt template." }, { status: 400 });
  const prompt = await benchmarkStore.updatePrompt(id, parsed.data);
  return prompt ? NextResponse.json({ prompt }) : NextResponse.json({ error: "Prompt not found." }, { status: 404 });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await benchmarkStore.hydrate();
  const { id } = await params;
  return (await benchmarkStore.deletePrompt(id))
    ? new Response(null, { status: 204 })
    : NextResponse.json({ error: "Prompt not found." }, { status: 404 });
}
