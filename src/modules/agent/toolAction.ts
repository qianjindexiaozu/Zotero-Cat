export interface AssistantWebSearchAction {
  type: "web-search";
  query: string;
}

type AssistantToolAction = AssistantWebSearchAction;

const MAX_TOOL_QUERY_CHARS = 240;

export function parseAssistantToolAction(
  content: string,
): AssistantToolAction | null {
  const candidates = collectJSONCandidates(content);
  for (const candidate of candidates) {
    const parsed = parseJSONRecord(candidate);
    if (!parsed) {
      continue;
    }
    const action = normalizeActionName(asString(parsed.action));
    if (!isWebSearchAction(action)) {
      continue;
    }
    const query = extractActionQuery(parsed);
    if (!query) {
      continue;
    }
    return {
      type: "web-search",
      query: truncate(query, MAX_TOOL_QUERY_CHARS),
    };
  }
  return null;
}

function collectJSONCandidates(content: string) {
  const candidates: string[] = [];
  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fencePattern.exec(content))) {
    if (match[1]?.trim()) {
      candidates.push(match[1].trim());
    }
  }
  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(content.slice(firstBrace, lastBrace + 1));
  }
  return candidates;
}

function parseJSONRecord(text: string) {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function extractActionQuery(record: Record<string, unknown>) {
  const actionInput = isRecord(record.action_input)
    ? record.action_input
    : isRecord(record.input)
      ? record.input
      : {};
  return compactWhitespace(
    asString(actionInput.query) ||
      asString(actionInput.q) ||
      asString(record.query),
  );
}

function isWebSearchAction(action: string) {
  return [
    "联网搜索",
    "搜索",
    "web_search",
    "web search",
    "search_web",
    "search web",
    "search",
  ].includes(action);
}

function normalizeActionName(value: string) {
  return value.trim().toLowerCase();
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function compactWhitespace(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function truncate(text: string, limit: number) {
  if (text.length <= limit) {
    return text;
  }
  return text.slice(0, limit).trimEnd();
}
