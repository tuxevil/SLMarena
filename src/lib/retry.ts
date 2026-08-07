import { OllamaRequestError } from "@/lib/ollama-client";
import { EvaluatorRequestError } from "@/lib/frontier-evaluator";

export async function retryTransient<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
  maxAttempts = 3,
  retryable: (error: unknown) => boolean = isTransient,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (signal.aborted || !retryable(error) || attempt === maxAttempts) throw error;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, 250 * 2 ** (attempt - 1));
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timeout);
            reject(signal.reason);
          },
          { once: true },
        );
      });
    }
  }
  throw lastError;
}

export function isTransient(error: unknown) {
  if (error instanceof OllamaRequestError || error instanceof EvaluatorRequestError) {
    return error.status >= 500 || error.status === 429;
  }
  return error instanceof TypeError || (error instanceof Error && error.name === "TimeoutError");
}
