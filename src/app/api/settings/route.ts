import { NextResponse } from "next/server";
import { benchmarkStore } from "@/lib/benchmark-store";
import { settingsUpdateSchema } from "@/lib/contracts";
import { validateOllamaEndpoint } from "@/lib/endpoints";

export async function GET() {
  await benchmarkStore.hydrate();
  return NextResponse.json({ settings: benchmarkStore.getSettings() });
}

export async function PATCH(request: Request) {
  await benchmarkStore.hydrate();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = settingsUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid settings.", details: parsed.error.flatten() }, { status: 400 });
  }
  if (parsed.data.ollamaUrl) {
    const endpointError = validateOllamaEndpoint(parsed.data.ollamaUrl);
    if (endpointError) return NextResponse.json({ error: endpointError }, { status: 400 });
  }

  try {
    return NextResponse.json({ settings: await benchmarkStore.updateSettings(parsed.data) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not persist settings." }, { status: 503 });
  }
}
