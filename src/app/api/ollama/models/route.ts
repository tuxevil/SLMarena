import { NextRequest, NextResponse } from "next/server";
import { httpUrlSchema } from "@/lib/contracts";
import { validateOllamaEndpoint } from "@/lib/endpoints";
import { formatBytes } from "@/lib/format-bytes";

type OllamaTagsResponse = {
  models?: Array<{ name: string; size?: number }>;
};

export async function GET(request: NextRequest) {
  const endpoint = request.nextUrl.searchParams.get("url")?.trim() || process.env.OLLAMA_URL;

  const parsedEndpoint = httpUrlSchema.safeParse(endpoint);
  if (!parsedEndpoint.success) {
    return NextResponse.json({ error: "An Ollama endpoint is required." }, { status: 400 });
  }
  const endpointError = validateOllamaEndpoint(parsedEndpoint.data);
  if (endpointError) return NextResponse.json({ error: endpointError }, { status: 400 });

  try {
    const response = await fetch(`${parsedEndpoint.data.replace(/\/$/, "")}/api/tags`, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      return NextResponse.json({ error: `Ollama returned HTTP ${response.status}.` }, { status: 502 });
    }

    const payload = (await response.json()) as OllamaTagsResponse;
    const models = (payload.models ?? []).map((model) => ({
      name: model.name,
      size: model.size ? formatBytes(model.size) : "local",
    }));

    return NextResponse.json({ models });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown connection error.";
    return NextResponse.json({ error: `Could not reach Ollama: ${message}` }, { status: 502 });
  }
}
