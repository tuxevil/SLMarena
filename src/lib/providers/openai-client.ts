import type { BenchmarkParameters } from "@/lib/contracts";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OpenAIUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

type LlamaCppTimings = {
  prompt_n?: number;
  prompt_ms?: number;
  prompt_per_second?: number;
  predicted_n?: number;
  predicted_ms?: number;
  predicted_per_second?: number;
};

type OpenAIChunk = {
  id?: string;
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
      thinking?: string | null;
    };
    finish_reason?: string | null;
  }>;
  usage?: OpenAIUsage;
  timings?: LlamaCppTimings;
};

export class OpenAICompatibleRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "OpenAICompatibleRequestError";
  }
}

export function normalizeChatEndpoint(endpoint: string): string {
  const clean = endpoint.trim().replace(/\/$/, "");
  if (clean.endsWith("/chat/completions")) {
    return clean;
  }
  if (clean.endsWith("/v1")) {
    return `${clean}/chat/completions`;
  }
  return `${clean}/v1/chat/completions`;
}

export type OpenAIChatResult = {
  responseText: string;
  thinking: string;
  reasoningFallback?: boolean;
  ttftMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  tokPerSec: number | null;
  totalDurationMs: number;
  evalDurationMs: number;
};

export async function streamOpenAICompatibleChat({
  endpoint,
  model,
  messages,
  parameters,
  apiKey,
  signal,
  onToken,
  providerName = "Local Provider",
}: {
  endpoint: string;
  model: string;
  messages: ChatMessage[];
  parameters: BenchmarkParameters;
  apiKey?: string | null;
  signal: AbortSignal;
  onToken?: (token: string) => void;
  providerName?: string;
}): Promise<OpenAIChatResult> {
  const startedAt = performance.now();
  const url = normalizeChatEndpoint(endpoint);
  const timeoutSignal = AbortSignal.timeout(120_000);
  const requestSignal = AbortSignal.any([signal, timeoutSignal]);

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (apiKey?.trim()) {
    headers["authorization"] = `Bearer ${apiKey.trim()}`;
  }

  // Transform messages: If provider is FreeToken or llama.cpp, some models ignore/fail on top-level "system" role when reasoning is off.
  // Merging system instructions into the first user message ensures 100% compliance across all local backends.
  const formattedMessages: ChatMessage[] = [];
  let pendingSystem = "";

  for (const msg of messages) {
    if (msg.role === "system") {
      if (msg.content.trim()) {
        pendingSystem = pendingSystem ? `${pendingSystem}\n\n${msg.content.trim()}` : msg.content.trim();
      }
    } else if (msg.role === "user") {
      if (pendingSystem) {
        formattedMessages.push({
          role: "user",
          content: `${pendingSystem}\n\n${msg.content}`,
        });
        pendingSystem = "";
      } else {
        formattedMessages.push(msg);
      }
    } else {
      formattedMessages.push(msg);
    }
  }

  if (pendingSystem) {
    formattedMessages.push({ role: "user", content: pendingSystem });
  }

  const body: Record<string, unknown> = {
    model,
    messages: formattedMessages,
    stream: true,
    stream_options: { include_usage: true },
    temperature: parameters.temperature,
    top_p: parameters.topP,
    max_tokens: parameters.numPredict,
  };

  const reasoningEffort = parameters.reasoningEffort ?? "off";
  if (reasoningEffort !== "default") {
    body.reasoning_effort = reasoningEffort;
  }

  if (parameters.repeatPenalty > 1) {
    body.presence_penalty = Math.min(2, parameters.repeatPenalty - 1);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      redirect: "error",
      body: JSON.stringify(body),
      signal: requestSignal,
    });
  } catch (err) {
    // If /v1/chat/completions failed with connection error, attempt fallback to /chat/completions directly if URL had /v1 added
    if (!endpoint.includes("/v1") && url.endsWith("/v1/chat/completions")) {
      const fallbackUrl = `${endpoint.trim().replace(/\/$/, "")}/chat/completions`;
      try {
        response = await fetch(fallbackUrl, {
          method: "POST",
          headers,
          redirect: "error",
          body: JSON.stringify(body),
          signal: requestSignal,
        });
      } catch {
        throw err;
      }
    } else {
      throw err;
    }
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new OpenAICompatibleRequestError(
      `${providerName} returned HTTP ${response.status}${errorText ? `: ${errorText.slice(0, 300)}` : ""}`,
      response.status,
    );
  }

  if (!response.body) {
    throw new Error(`${providerName} returned an empty response stream.`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let rawResponseText = "";
  let thinking = "";
  let firstTokenAt: number | null = null;
  let usage: OpenAIUsage | null = null;
  let timings: LlamaCppTimings | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(":") || !trimmed.startsWith("data:")) continue;

      const dataPayload = trimmed.replace(/^data:\s*/, "");
      if (dataPayload === "[DONE]") {
        break;
      }

      let chunk: OpenAIChunk;
      try {
        chunk = JSON.parse(dataPayload) as OpenAIChunk;
      } catch {
        continue;
      }

      if (chunk.usage) {
        usage = chunk.usage;
      }
      if (chunk.timings) {
        timings = chunk.timings;
      }

      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;

      const reasoningToken = delta.reasoning_content ?? delta.reasoning ?? delta.thinking ?? "";
      const textToken = delta.content ?? "";

      if (reasoningToken || textToken) {
        firstTokenAt ??= performance.now();
      }

      if (reasoningToken) {
        thinking += reasoningToken;
      }
      if (textToken) {
        rawResponseText += textToken;
        onToken?.(textToken);
      }
    }
  }

  // Check remaining buffer
  const finalTrimmed = buffer.trim();
  if (finalTrimmed && finalTrimmed.startsWith("data:") && !finalTrimmed.includes("[DONE]")) {
    try {
      const chunk = JSON.parse(finalTrimmed.replace(/^data:\s*/, "")) as OpenAIChunk;
      if (chunk.usage) usage = chunk.usage;
      if (chunk.timings) timings = chunk.timings;
    } catch {
      // Ignore
    }
  }

  // Handle embedded <think>...</think> tags if reasoning was not separated by provider
  let responseText = rawResponseText;
  if (!thinking && responseText.includes("<think>")) {
    const thinkMatch = responseText.match(/<think>([\s\S]*?)<\/think>/);
    if (thinkMatch) {
      thinking = thinkMatch[1].trim();
      responseText = responseText.replace(/<think>[\s\S]*?<\/think>/, "").trim();
    }
  }

  // Handle reasoning fallback if content was empty
  let reasoningFallback = false;
  if (!responseText.trim() && thinking.trim()) {
    responseText = thinking.trim();
    reasoningFallback = true;
    console.warn(`[slmarena] [${providerName}] Response content was empty; recovered from reasoning/thinking channel (reasoning_fallback).`);
  }

  const finishedAt = performance.now();
  const totalDurationMs = Math.round(finishedAt - startedAt);
  const evalDurationMs =
    timings?.predicted_ms != null
      ? Math.round(timings.predicted_ms)
      : firstTokenAt !== null
        ? Math.round(finishedAt - firstTokenAt)
        : totalDurationMs;

  const inputTokens = usage?.prompt_tokens ?? timings?.prompt_n ?? null;
  const outputTokens = usage?.completion_tokens ?? timings?.predicted_n ?? null;

  let tokPerSec: number | null = null;
  if (timings?.predicted_per_second != null && timings.predicted_per_second > 0) {
    tokPerSec = Number(timings.predicted_per_second.toFixed(2));
  } else if (outputTokens !== null && evalDurationMs > 0) {
    tokPerSec = Number((outputTokens / (evalDurationMs / 1_000)).toFixed(2));
  }

  return {
    responseText,
    thinking,
    reasoningFallback,
    ttftMs: firstTokenAt === null ? null : Math.round(firstTokenAt - startedAt),
    inputTokens,
    outputTokens,
    tokPerSec,
    totalDurationMs,
    evalDurationMs,
  };
}
