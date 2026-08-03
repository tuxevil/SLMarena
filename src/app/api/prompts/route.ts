import { NextResponse } from "next/server";
import { benchmarkStore } from "@/lib/benchmark-store";
import { z } from "zod";

const promptSchema = z.object({
  title: z.string().trim().min(1).max(255),
  systemPrompt: z.string().trim().min(1).max(50_000),
  tags: z.array(z.string().trim().min(1).max(64)).max(30).default([]),
});

export async function GET() {
  await benchmarkStore.hydrate();
  return NextResponse.json({ prompts: benchmarkStore.listPrompts() });
}

export async function POST(request: Request) {
  await benchmarkStore.hydrate();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = promptSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid prompt template." }, { status: 400 });
  return NextResponse.json({ prompt: await benchmarkStore.createPrompt(parsed.data) }, { status: 201 });
}
