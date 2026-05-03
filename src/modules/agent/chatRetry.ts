function formatError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function shouldRetryChatError(
  error: unknown,
  attempt: number,
  maxAttempts: number,
  streamStarted: boolean,
  cancelRequested: boolean,
) {
  if (attempt >= maxAttempts || streamStarted || cancelRequested) {
    return false;
  }
  const text = formatError(error).toLowerCase();
  if (
    text.includes("invalid_api_key") ||
    text.includes("api key") ||
    text.includes("401") ||
    text.includes("403") ||
    text.includes("not json") ||
    text.includes("不是 json")
  ) {
    return false;
  }
  return (
    text.includes("timeout") ||
    text.includes("timed out") ||
    text.includes("network") ||
    text.includes("connection") ||
    text.includes("econnreset") ||
    text.includes("temporarily") ||
    text.includes("rate limit") ||
    text.includes("429") ||
    text.includes("500") ||
    text.includes("502") ||
    text.includes("503") ||
    text.includes("504") ||
    text.includes("overloaded") ||
    text.includes("empty response") ||
    text.includes("空内容")
  );
}

export function isAbortError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  return /cancel|abort/i.test(text);
}
