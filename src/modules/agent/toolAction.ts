import { asString, isRecord, truncate } from "../../utils/text";

export interface ToolAction {
  type: string;
  query: string;
  rawInput: Record<string, unknown>;
  readOnly: boolean;
}

export interface ToolActionHandler {
  type: string;
  aliases: string[];
  readOnly: boolean;
  extractQuery(
    actionInput: Record<string, unknown>,
    rawRecord: Record<string, unknown>,
  ): string;
  isAvailable(): boolean;
  execute(
    query: string,
    options: {
      requestToken: number;
      onStatus?: (status: unknown) => void;
      rawInput?: Record<string, unknown>;
      item?: Zotero.Item | null;
    },
  ): Promise<string>;
}

const MAX_TOOL_QUERY_CHARS = 240;
const MAX_ACTIONS_PER_TURN = 10;
const handlers = new Map<string, ToolActionHandler>();

export function registerToolActionHandler(handler: ToolActionHandler) {
  handlers.set(handler.type, handler);
}

export function getRegisteredToolTypes(): string[] {
  return [...handlers.keys()];
}

export function getToolActionHandler(type: string): ToolActionHandler | null {
  return handlers.get(type) || null;
}

export function parseAssistantToolActions(content: string): ToolAction[] {
  const candidates = collectJSONCandidates(content);
  const seen = new Set<string>();
  const actions: ToolAction[] = [];
  for (const candidate of candidates) {
    const parsedRecords = parseJSONRecords(candidate);
    for (const parsed of parsedRecords) {
      const action = toToolAction(parsed);
      if (!action) {
        continue;
      }
      const fingerprint = `${action.type}::${action.query}`;
      if (seen.has(fingerprint)) {
        continue;
      }
      seen.add(fingerprint);
      actions.push(action);
      if (actions.length >= MAX_ACTIONS_PER_TURN) {
        return actions;
      }
    }
  }
  return actions;
}

export function parseFirstAssistantToolAction(
  content: string,
): ToolAction | null {
  return parseAssistantToolActions(content)[0] || null;
}

/**
 * @deprecated Use `parseFirstAssistantToolAction` or
 * `parseAssistantToolActions` instead. Kept for compatibility with the
 * existing single-tool follow-up path.
 */
export function parseAssistantToolAction(content: string): ToolAction | null {
  return parseFirstAssistantToolAction(content);
}

export async function executeToolAction(
  action: ToolAction,
  options: {
    requestToken: number;
    onStatus?: (status: unknown) => void;
    item?: Zotero.Item | null;
  },
): Promise<string> {
  const handler = handlers.get(action.type);
  if (!handler || !handler.isAvailable()) {
    return "";
  }
  return handler.execute(action.query, {
    requestToken: options.requestToken,
    onStatus: options.onStatus,
    rawInput: action.rawInput,
    item: options.item || null,
  });
}

function toToolAction(record: Record<string, unknown>): ToolAction | null {
  const action = normalizeActionName(asString(record.action));
  if (!action) {
    return null;
  }
  const handler = findHandlerByAlias(action);
  if (!handler) {
    return null;
  }
  const actionInput = resolveActionInput(record);
  const query = handler.extractQuery(actionInput, record);
  if (!query) {
    return null;
  }
  return {
    type: handler.type,
    query: truncate(query, MAX_TOOL_QUERY_CHARS),
    rawInput: actionInput,
    readOnly: handler.readOnly,
  };
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
  const lastBracket = content.lastIndexOf("]");
  const lastBrace = content.lastIndexOf("}");
  const tail = Math.max(lastBrace, lastBracket);
  if (firstBrace >= 0 && tail > firstBrace) {
    candidates.push(content.slice(firstBrace, tail + 1));
  }
  const firstBracket = content.indexOf("[");
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    candidates.push(content.slice(firstBracket, lastBracket + 1));
  }
  return candidates;
}

function parseJSONRecords(text: string): Record<string, unknown>[] {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (isRecord(parsed)) {
      return [parsed];
    }
    if (Array.isArray(parsed)) {
      return parsed.filter(isRecord) as Record<string, unknown>[];
    }
    return [];
  } catch (_error) {
    return [];
  }
}

function normalizeActionName(value: string) {
  return value.trim().toLowerCase();
}
