import { getPref } from "../../utils/prefs";
import {
  asString,
  isRecord,
  normalizeMultiline,
  truncate,
  truncateAtSentence,
} from "../../utils/text";
import {
  registerToolActionHandler,
  type ToolAction,
  type ToolActionHandler,
} from "./toolAction";
import type { AnnotationProposal } from "./annotationProposals";
import {
  extractPages,
  findTextRects,
  renderPagesAsText,
} from "../tools/pdfReader";

const MAX_READ_PDF_CHARS = 8_000;
const MAX_LIST_ANNOTATION_ENTRIES = 80;

async function readAttachmentText(attachment: Zotero.Item): Promise<string> {
  try {
    const pages = await extractPages(attachment);
    const text = renderPagesAsText(pages).trim();
    if (text) {
      return text;
    }
  } catch (error) {
    try {
      (Zotero as unknown as { logError?: (e: unknown) => void }).logError?.(
        error,
      );
    } catch (_e) {
      // ignore logging failures
    }
    const fallback = await readZoteroIndexedText(attachment);
    if (fallback) {
      return fallback;
    }
    throw error;
  }
  const fallback = await readZoteroIndexedText(attachment);
  return fallback;
}

async function readZoteroIndexedText(attachment: Zotero.Item): Promise<string> {
  try {
    const indexed = (attachment as unknown as { attachmentText?: string })
      .attachmentText;
    if (typeof indexed === "string" && indexed.trim()) {
      return indexed.trim();
    }
  } catch (_error) {
    // fall through
  }
  try {
    const fulltext = (
      Zotero as unknown as {
        Fulltext?: {
          getItemContent?: (id: number) => Promise<string> | string;
          indexItems?: (ids: number[]) => Promise<void>;
        };
      }
    ).Fulltext;
    if (fulltext?.indexItems) {
      try {
        await fulltext.indexItems([attachment.id]);
      } catch (_error) {
        // ignore - attempt to read whatever is indexed
      }
    }
    if (fulltext?.getItemContent) {
      const content = await Promise.resolve(
        fulltext.getItemContent(attachment.id),
      );
      if (typeof content === "string" && content.trim()) {
        return content.trim();
      }
    }
  } catch (_error) {
    // fall through
  }
  return "";
}

export type ResolvedProposalInput = Omit<
  AnnotationProposal,
  "id" | "status" | "createdAt"
>;

export interface ResolveWriteContext {
  item: Zotero.Item | null;
  locale: "en" | "zh";
}

export function isPdfToolsEnabledPref(): boolean {
  return getPref("pdfToolsEnabled") === true;
}

export function isPdfToolsAutoApplyPref(): boolean {
  return getPref("pdfToolsAutoApply") === true;
}

export function registerAnnotationReadTools(): void {
  const readPdfHandler: ToolActionHandler = {
    type: "read-pdf",
    readOnly: true,
    aliases: [
      "read_pdf",
      "read pdf",
      "read-pdf",
      "查看pdf",
      "读取pdf",
      "read-paper",
      "read_paper",
    ],
    extractQuery(actionInput, rawRecord) {
      const query =
        asStringField(actionInput.query) ||
        asStringField(actionInput.topic) ||
        asStringField(rawRecord.query);
      return query.trim() || "__full__";
    },
    isAvailable() {
      return isPdfToolsEnabledPref();
    },
    async execute(query, options) {
      const item = extractItemFromOptions(options);
      if (!item) {
        return formatToolError("No active Zotero item for read_pdf.");
      }
      const attachment = findPrimaryPdfAttachment(item);
      if (!attachment) {
        return formatToolError("No PDF attachment found for the current item.");
      }
      try {
        const text = await readAttachmentText(attachment);
        if (!text) {
          return formatToolError(
            "The PDF produced no extractable text. Try opening it in Zotero first so its full text is indexed.",
          );
        }
        return truncateAtSentence(text, MAX_READ_PDF_CHARS);
      } catch (error) {
        return formatToolError(formatErrorMessage(error));
      }
    },
  };
  registerToolActionHandler(readPdfHandler);

  const listAnnotationsHandler: ToolActionHandler = {
    type: "list-annotations",
    readOnly: true,
    aliases: [
      "list_annotations",
      "list annotations",
      "list-annotations",
      "get_annotations",
      "查看标注",
      "列出标注",
    ],
    extractQuery(_actionInput) {
      return "__all__";
    },
    isAvailable() {
      return isPdfToolsEnabledPref();
    },
    async execute(_query, options) {
      const item = extractItemFromOptions(options);
      if (!item) {
        return formatToolError("No active Zotero item for list_annotations.");
      }
      const attachments = collectPdfAttachments(item);
      if (!attachments.length) {
        return formatToolError(
          "No PDF attachments found for the current item.",
        );
      }
      const entries: string[] = [];
      for (const attachment of attachments) {
        const annotations = attachment.getAnnotations?.(false) || [];
        for (const annotation of annotations) {
          if (entries.length >= MAX_LIST_ANNOTATION_ENTRIES) {
            break;
          }
          entries.push(summarizeExistingAnnotation(annotation));
        }
        if (entries.length >= MAX_LIST_ANNOTATION_ENTRIES) {
          break;
        }
      }
      if (!entries.length) {
        return "No annotations on this item yet.";
      }
      return entries.join("\n");
    },
  };
  registerToolActionHandler(listAnnotationsHandler);
}

export function isAnnotationWriteAction(action: ToolAction): boolean {
  if (action.readOnly) {
    return false;
  }
  return (
    action.type === "propose-annotation" ||
    action.type === "modify-annotation" ||
    action.type === "delete-annotation"
  );
}

export function registerAnnotationWriteStubs(): void {
  // Write actions bypass executeToolAction but still need handler entries so
  // parseAssistantToolActions recognizes their names and returns them with
  // readOnly = false. The execute bodies are never invoked; section.ts
  // intercepts these actions and routes them through resolveWriteAction.
  for (const type of [
    "propose-annotation",
    "modify-annotation",
    "delete-annotation",
  ] as const) {
    registerToolActionHandler({
      type,
      readOnly: false,
      aliases: buildWriteAliases(type),
      extractQuery(actionInput) {
        const candidate =
          asStringField(actionInput.text) ||
          asStringField(actionInput.key) ||
          asStringField(actionInput.query) ||
          type;
        return candidate.trim() || type;
      },
      isAvailable() {
        return isPdfToolsEnabledPref();
      },
      async execute() {
        return "";
      },
    });
  }
}

function buildWriteAliases(type: string): string[] {
  if (type === "propose-annotation") {
    return [
      "propose_annotation",
      "propose annotation",
      "propose-annotation",
      "add_annotation",
      "add annotation",
      "add-annotation",
      "create_annotation",
      "highlight",
      "add_highlight",
      "add_note",
      "创建标注",
      "添加标注",
      "添加高亮",
      "添加批注",
    ];
  }
  if (type === "modify-annotation") {
    return [
      "modify_annotation",
      "modify annotation",
      "modify-annotation",
      "update_annotation",
      "edit_annotation",
      "修改标注",
      "编辑标注",
    ];
  }
  return [
    "delete_annotation",
    "delete annotation",
    "delete-annotation",
    "remove_annotation",
    "删除标注",
  ];
}

export async function resolveWriteAction(
  action: ToolAction,
  context: ResolveWriteContext,
): Promise<ResolvedProposalInput[]> {
  if (!context.item) {
    return [];
  }
  const attachments = collectPdfAttachments(context.item);
  if (!attachments.length) {
    return [];
  }
  const attachment = attachments[0];
  const input = action.rawInput;
  if (action.type === "propose-annotation") {
    return resolveProposeAnnotation(attachment, input);
  }
  if (action.type === "modify-annotation") {
    return resolveModifyAnnotation(attachment, input);
  }
  if (action.type === "delete-annotation") {
    return resolveDeleteAnnotation(attachment, input);
  }
  return [];
}

async function resolveProposeAnnotation(
  attachment: Zotero.Item,
  input: Record<string, unknown>,
): Promise<ResolvedProposalInput[]> {
  const type =
    normalizeAnnotationType(asStringField(input.type)) || "highlight";
  const text = asStringField(input.text).trim();
  const comment = asStringField(input.comment).trim();
  const color = asStringField(input.color).trim();
  const pageLabelHint = asStringField(input.pageLabel).trim();
  const pageHint = resolvePageHint(input, pageLabelHint);
  const needsRects = type === "highlight" || type === "underline";
  if (needsRects) {
    if (!text) {
      return [
        failedProposal(
          "create",
          attachment,
          {
            type,
            pageIndex: pageHint ?? 0,
            pageLabel: pageLabelHint || String((pageHint ?? 0) + 1),
            rects: [],
            text,
            comment,
            color,
          },
          "Missing `text` field for highlight/underline.",
        ),
      ];
    }
    try {
      const pages = await extractPages(attachment);
      const match = findTextRects(pages, pageHint ?? null, text);
      if (!match) {
        return [
          failedProposal(
            "create",
            attachment,
            {
              type,
              pageIndex: pageHint ?? 0,
              pageLabel: pageLabelHint || String((pageHint ?? 0) + 1),
              rects: [],
              text,
              comment,
              color,
            },
            "Could not locate the quoted text in the PDF.",
          ),
        ];
      }
      const matchedPage = pages.find((p) => p.pageIndex === match.pageIndex);
      return [
        {
          op: "create",
          attachmentKey: attachment.key,
          attachmentID: attachment.id,
          resolved: {
            type,
            pageIndex: match.pageIndex,
            pageLabel: match.pageLabel,
            rects: match.rects,
            pageHeight: matchedPage?.pageHeight,
            text: match.matchedText,
            comment,
            color,
          },
          sourceSnippet: truncate(text, 160),
        },
      ];
    } catch (error) {
      return [
        failedProposal(
          "create",
          attachment,
          {
            type,
            pageIndex: pageHint ?? 0,
            pageLabel: pageLabelHint || String((pageHint ?? 0) + 1),
            rects: [],
            text,
            comment,
            color,
          },
          formatErrorMessage(error),
        ),
      ];
    }
  }
  const pageIndex = pageHint ?? 0;
  return [
    {
      op: "create",
      attachmentKey: attachment.key,
      attachmentID: attachment.id,
      resolved: {
        type,
        pageIndex,
        pageLabel: pageLabelHint || String(pageIndex + 1),
        rects: [],
        text,
        comment,
        color,
      },
      sourceSnippet: truncate(comment || text || "note", 160),
    },
  ];
}

async function resolveModifyAnnotation(
  attachment: Zotero.Item,
  input: Record<string, unknown>,
): Promise<ResolvedProposalInput[]> {
  const key = asStringField(input.key).trim();
  if (!key) {
    return [];
  }
  const existing = Zotero.Items.getByLibraryAndKey(
    attachment.libraryID,
    key,
  ) as Zotero.Item | false;
  if (!existing || !existing.isAnnotation?.()) {
    return [
      failedProposal(
        "update",
        attachment,
        {
          type: "note",
          pageIndex: 0,
          pageLabel: "?",
          rects: [],
          key,
        },
        "Target annotation does not exist.",
      ),
    ];
  }
  const pageIndex = parseAnnotationPageIndex(existing.annotationPosition);
  return [
    {
      op: "update",
      attachmentKey: attachment.key,
      attachmentID: attachment.id,
      annotationKey: key,
      resolved: {
        type: (existing.annotationType as AnnotationResolvedJSONType) || "note",
        pageIndex,
        pageLabel:
          asStringField(input.pageLabel).trim() ||
          existing.annotationPageLabel ||
          String(pageIndex + 1),
        rects: mergeRectsFromExisting(existing),
        text: asStringField(input.text).trim() || existing.annotationText || "",
        comment:
          asStringField(input.comment).trim() ||
          existing.annotationComment ||
          "",
        color:
          asStringField(input.color).trim() || existing.annotationColor || "",
        key,
      },
      sourceSnippet: truncate(
        asStringField(input.comment).trim() ||
          asStringField(input.text).trim() ||
          existing.annotationText ||
          key,
        160,
      ),
    },
  ];
}

async function resolveDeleteAnnotation(
  attachment: Zotero.Item,
  input: Record<string, unknown>,
): Promise<ResolvedProposalInput[]> {
  const key = asStringField(input.key).trim();
  if (!key) {
    return [];
  }
  const existing = Zotero.Items.getByLibraryAndKey(
    attachment.libraryID,
    key,
  ) as Zotero.Item | false;
  if (!existing || !existing.isAnnotation?.()) {
    return [
      failedProposal(
        "delete",
        attachment,
        {
          type: "note",
          pageIndex: 0,
          pageLabel: "?",
          rects: [],
          key,
        },
        "Target annotation does not exist.",
      ),
    ];
  }
  const pageIndex = parseAnnotationPageIndex(existing.annotationPosition);
  return [
    {
      op: "delete",
      attachmentKey: attachment.key,
      attachmentID: attachment.id,
      annotationKey: key,
      resolved: {
        type: (existing.annotationType as AnnotationResolvedJSONType) || "note",
        pageIndex,
        pageLabel: existing.annotationPageLabel || String(pageIndex + 1),
        rects: [],
        key,
      },
      sourceSnippet: truncate(
        existing.annotationText || existing.annotationComment || key,
        160,
      ),
    },
  ];
}

type AnnotationResolvedJSONType = "highlight" | "underline" | "note" | "text";

function normalizeAnnotationType(
  raw: string,
): AnnotationResolvedJSONType | null {
  const value = raw.trim().toLowerCase();
  if (
    value === "highlight" ||
    value === "underline" ||
    value === "note" ||
    value === "text"
  ) {
    return value;
  }
  return null;
}

function failedProposal(
  op: "create" | "update" | "delete",
  attachment: Zotero.Item,
  resolved: {
    type: AnnotationResolvedJSONType;
    pageIndex: number;
    pageLabel: string;
    rects: number[][];
    text?: string;
    comment?: string;
    color?: string;
    key?: string;
  },
  errorMessage: string,
): ResolvedProposalInput {
  return {
    op,
    attachmentKey: attachment.key,
    attachmentID: attachment.id,
    annotationKey: resolved.key,
    resolved,
    sourceSnippet: truncate(
      resolved.text || resolved.comment || errorMessage,
      160,
    ),
    errorMessage,
  };
}

function resolvePageHint(
  input: Record<string, unknown>,
  pageLabelHint: string,
): number | null {
  if (typeof input.pageIndex === "number" && Number.isFinite(input.pageIndex)) {
    return Math.max(0, Math.floor(input.pageIndex));
  }
  if (typeof input.page === "number" && Number.isFinite(input.page)) {
    return Math.max(0, Math.floor(input.page) - 1);
  }
  const numericLabel = Number.parseInt(pageLabelHint, 10);
  if (Number.isFinite(numericLabel) && numericLabel > 0) {
    return numericLabel - 1;
  }
  return null;
}

function parseAnnotationPageIndex(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  try {
    const parsed = JSON.parse(value);
    if (
      isRecord(parsed) &&
      typeof parsed.pageIndex === "number" &&
      Number.isFinite(parsed.pageIndex)
    ) {
      return Math.max(0, Math.floor(parsed.pageIndex));
    }
  } catch (_error) {
    // ignore
  }
  return 0;
}

function mergeRectsFromExisting(item: Zotero.Item): number[][] {
  try {
    const parsed = JSON.parse(item.annotationPosition || "{}");
    if (Array.isArray(parsed?.rects)) {
      return parsed.rects as number[][];
    }
  } catch (_error) {
    // ignore
  }
  return [];
}

function collectPdfAttachments(item: Zotero.Item): Zotero.Item[] {
  const output: Zotero.Item[] = [];
  if (item.isPDFAttachment?.()) {
    output.push(item);
  }
  const attachmentIDs = item.getAttachments?.(false) || [];
  if (attachmentIDs.length) {
    const children = Zotero.Items.get(attachmentIDs);
    for (const child of children) {
      if (child?.isPDFAttachment?.()) {
        output.push(child);
      }
    }
  }
  return output;
}

function findPrimaryPdfAttachment(item: Zotero.Item): Zotero.Item | null {
  const attachments = collectPdfAttachments(item);
  return attachments[0] || null;
}

function summarizeExistingAnnotation(annotation: Zotero.Item): string {
  const pageLabel = annotation.annotationPageLabel || "?";
  const type = annotation.annotationType || "note";
  const text = normalizeMultiline(annotation.annotationText || "");
  const comment = normalizeMultiline(annotation.annotationComment || "");
  const snippetText = text ? truncate(text, 140) : "";
  const snippetComment = comment ? truncate(comment, 140) : "";
  const parts = [`key=${annotation.key}`, `page=${pageLabel}`, `type=${type}`];
  if (snippetText) {
    parts.push(`text="${snippetText}"`);
  }
  if (snippetComment) {
    parts.push(`comment="${snippetComment}"`);
  }
  return `- ${parts.join(" | ")}`;
}

function formatToolError(message: string): string {
  return `ERROR: ${message}`;
}

function formatErrorMessage(error: unknown): string {
  // XPCOM exceptions thrown by Zotero APIs are not `Error` instances and their
  // fields are non-enumerable getters; `JSON.stringify` collapses them to "{}".
  // Read the known fields explicitly so the model sees the real reason.
  if (typeof error === "string") {
    return error || "Unknown error";
  }
  if (error == null) {
    return "Unknown error";
  }
  if (error instanceof Error) {
    return error.message || error.name || String(error) || "Unknown error";
  }
  if (typeof error === "object") {
    const record = error as Record<string, unknown>;
    const parts: string[] = [];
    const message = readField(record, "message");
    if (message) parts.push(message);
    const name = readField(record, "name");
    if (name && name !== message) parts.push(`(${name})`);
    const result = readField(record, "result");
    if (result) parts.push(`[result=${result}]`);
    if (parts.length) {
      return parts.join(" ");
    }
    const coerced = String(error);
    if (coerced && coerced !== "[object Object]") {
      return coerced;
    }
  }
  const coerced = String(error);
  return coerced && coerced !== "[object Object]" ? coerced : "Unknown error";
}

function readField(record: Record<string, unknown>, field: string): string {
  try {
    const value = record[field];
    if (value == null) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "bigint") {
      return String(value);
    }
    return "";
  } catch (_error) {
    return "";
  }
}

function asStringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function extractItemFromOptions(options: {
  item?: Zotero.Item | null;
}): Zotero.Item | null {
  return options.item || null;
}
