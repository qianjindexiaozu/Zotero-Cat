import { asString, isRecord, truncate } from "../../utils/text";

export interface ToolAction {
  type: string;
  query: string;
  rawInput: Record<string, unknown>;
}

export interface ToolActionHandler {
  type: string;
  aliases: string[];
  extractQuery(
    actionInput: Record<string, unknown>,
    rawRecord: Record<string, unknown>,
  ): string;
  isAvailable(): boolean;
  execute(
    query: string,
    options: { requestToken: number; onStatus?: (status: unknown) => void },
  ): Promise<string>;
}

const MAX_TOOL_QUERY_CHARS = 240;
const handlers = new Map<string, ToolActionHandler>();

export function registerToolActionHandler(handler: ToolActionHandler) {
  handlers.set(handler.type, handler);
}

export function getRegisteredToolTypes(): string[] {
  return [...handlers.keys()];
}

export function parseAssistantToolAction(content: string): ToolAction | null {
  const candidates = collectJSONCandidates(content);
  for (const candidate of candidates) {
    const parsed = parseJSONRecord(candidate);
    if (!parsed) {
      continue;
    }
    const action = normalizeActionName(asString(parsed.action));
    if (!action) {
      continue;
    }
    const handler = findHandlerByAlias(action);
    if (!handler) {
      continue;
    }
    const actionInput = resolveActionInput(parsed);
    const query = handler.extractQuery(actionInput, parsed);
    if (!query) {
      continue;
    }
    return {
      type: handler.type,
      query: truncate(query, MAX_TOOL_QUERY_CHARS),
      rawInput: actionInput,
    };
  }
  return null;
}

export async function executeToolAction(
  action: ToolAction,
  options: { requestToken: number; onStatus?: (status: unknown) => void },
): Promise<string> {
  const handler = handlers.get(action.type);
  if (!handler || !handler.isAvailable()) {
    return "";
  }
  return handler.execute(action.query, options);
}

function findHandlerByAlias(alias: string): ToolActionHandler | null {
  for (const handler of handlers.values()) {
    if (handler.aliases.some((a) => a === alias)) {
      return handler;
    }
  }
  return null;
}

function resolveActionInput(
  record: Record<string, unknown>,
): Record<string, unknown> {
  if (isRecord(record.action_input)) {
    return record.action_input;
  }
  if (isRecord(record.input)) {
    return record.input;
  }
  return {};
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

function normalizeActionName(value: string) {
  return value.trim().toLowerCase();
}
