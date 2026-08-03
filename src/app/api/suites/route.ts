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

export async function GET() {
  await benchmarkStore.hydrate();
  return NextResponse.json({ suites: benchmarkStore.listSuites() });
}

export async function POST(request: Request) {
  await benchmarkStore.hydrate();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const parsed = suiteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid test suite." }, { status: 400 });
  return NextResponse.json({ suite: await benchmarkStore.createSuite(parsed.data) }, { status: 201 });
}
