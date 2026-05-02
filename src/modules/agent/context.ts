import { AgentMessage } from "./provider";
import {
  DEFAULT_PROMPT_TEMPLATE_ID,
  getPromptTemplateByID,
} from "./promptTemplates";

const MAX_NOTE_ITEMS = 3;
const MAX_ANNOTATION_ITEMS = 8;
const MAX_SELECTED_TEXT_CHARS = 600;
const MAX_NOTE_CHARS = 900;
const MAX_ANNOTATION_TEXT_CHARS = 280;
const MAX_SYSTEM_CONTEXT_CHARS = 8_000;
const SELECTED_TEXT_CACHE_TTL_MS = 5 * 60 * 1000;

interface SelectedTextCacheEntry {
  text: string;
  expiresAt: number;
}

const selectedTextCacheByItemKey = new Map<string, SelectedTextCacheEntry>();

export interface AgentContextOptions {
  includeMetadata: boolean;
  includeNotes: boolean;
  includeAnnotations: boolean;
  includeSelectedText: boolean;
}

interface BuildRequestOptions {
  item: Zotero.Item | null;
  contextOptions: AgentContextOptions;
  templateID: string;
}

export function getDefaultContextOptions(): AgentContextOptions {
  return {
    includeMetadata: true,
    includeNotes: false,
    includeAnnotations: false,
    includeSelectedText: false,
  };
}

export function buildRequestMessagesWithContext(
  messages: AgentMessage[],
  options: BuildRequestOptions,
): AgentMessage[] {
  const template = getPromptTemplateByID(options.templateID);
  const contextText = buildItemContext(options.item, options.contextOptions);
  const systemChunks = [template.systemPrompt];
  if (contextText) {
    systemChunks.push(contextText);
  }
  const systemMessage = systemChunks.join("\n\n").trim();
  if (!systemMessage) {
    return messages;
  }
  return [
    {
      role: "system",
      content: systemMessage.slice(0, MAX_SYSTEM_CONTEXT_CHARS),
    },
    ...messages,
  ];
}

export function normalizeTemplateID(templateID: string) {
  return getPromptTemplateByID(templateID || DEFAULT_PROMPT_TEMPLATE_ID).id;
}

export function rememberReaderSelectedText(
  text: string,
  item: Zotero.Item | null,
) {
  const normalizedText = compactWhitespace(text);
  if (!normalizedText) {
    return;
  }
  const keys = collectRelatedItemKeys(item);
  if (!keys.length) {
    return;
  }
  const entry: SelectedTextCacheEntry = {
    text: truncate(normalizedText, MAX_SELECTED_TEXT_CHARS),
    expiresAt: Date.now() + SELECTED_TEXT_CACHE_TTL_MS,
  };
  for (const key of keys) {
    selectedTextCacheByItemKey.set(key, entry);
  }
}

function buildItemContext(
  item: Zotero.Item | null,
  options: AgentContextOptions,
) {
  if (!item) {
    return "";
  }
  const primaryItem = resolvePrimaryItem(item);
  const blocks: string[] = [];
  if (options.includeMetadata) {
    const metadataBlock = buildMetadataBlock(primaryItem);
    if (metadataBlock) {
      blocks.push(metadataBlock);
    }
  }
  if (options.includeNotes) {
    const notesBlock = buildNotesBlock(primaryItem);
    if (notesBlock) {
      blocks.push(notesBlock);
    }
  }
  if (options.includeAnnotations) {
    const annotationsBlock = buildAnnotationsBlock(primaryItem);
    if (annotationsBlock) {
      blocks.push(annotationsBlock);
    }
  }
  if (options.includeSelectedText) {
    const selectedTextBlock = buildSelectedTextBlock(item);
    if (selectedTextBlock) {
      blocks.push(selectedTextBlock);
    }
  }
  if (!blocks.length) {
    return "";
  }
  return ["Zotero Context:", ...blocks].join("\n\n");
}

function resolvePrimaryItem(item: Zotero.Item) {
  let current: Zotero.Item = item;
  let guard = 0;
  while (current.parentItem && guard < 6) {
    current = current.parentItem;
    guard += 1;
  }
  return current;
}

function buildMetadataBlock(item: Zotero.Item) {
  const rows: string[] = [];
  const title = item.getDisplayTitle() || item.getField("title");
  if (title) {
    rows.push(`- title: ${title}`);
  }
  const itemType = Zotero.ItemTypes.getName(item.itemTypeID);
  if (itemType) {
    rows.push(`- itemType: ${itemType}`);
  }
  const creators = formatCreators(item.getCreators());
  if (creators) {
    rows.push(`- authors: ${creators}`);
  }
  const year = extractYear(item.getField("date"));
  if (year) {
    rows.push(`- year: ${year}`);
  }
  const doi = item.getField("DOI");
  if (doi) {
    rows.push(`- doi: ${doi}`);
  }
  const publication = item.getField("publicationTitle");
  if (publication) {
    rows.push(`- publication: ${publication}`);
  }
  const abstractNote = compactWhitespace(
    stripHTML(item.getField("abstractNote")),
  );
  if (abstractNote) {
    rows.push(`- abstract: ${truncate(abstractNote, 700)}`);
  }
  if (!rows.length) {
    return "";
  }
  return ["Item Metadata:", ...rows].join("\n");
}

function buildNotesBlock(item: Zotero.Item) {
  const noteIDs = item.getNotes(false).slice(0, MAX_NOTE_ITEMS);
  if (!noteIDs.length) {
    return "";
  }
  const notes = Zotero.Items.get(noteIDs).filter((note) => note?.isNote());
  const lines: string[] = [];
  for (const [index, note] of notes.entries()) {
    const noteText = compactWhitespace(stripHTML(note.getNote()));
    if (!noteText) {
      continue;
    }
    lines.push(`${index + 1}. ${truncate(noteText, MAX_NOTE_CHARS)}`);
  }
  if (!lines.length) {
    return "";
  }
  return ["Notes:", ...lines].join("\n");
}

function buildAnnotationsBlock(item: Zotero.Item) {
  const attachments = gatherAttachmentItems(item);
  if (!attachments.length) {
    return "";
  }
  const lines: string[] = [];
  for (const attachment of attachments) {
    const annotations = attachment.getAnnotations(false);
    for (const annotation of annotations) {
      const text = compactWhitespace(annotation.annotationText || "");
      const comment = compactWhitespace(annotation.annotationComment || "");
      const textPart = text ? truncate(text, MAX_ANNOTATION_TEXT_CHARS) : "";
      const commentPart = comment
        ? truncate(comment, MAX_ANNOTATION_TEXT_CHARS)
        : "";
      if (!textPart && !commentPart) {
        continue;
      }
      const page = annotation.annotationPageLabel || "?";
      const segments = [
        `p.${page}`,
        annotation.annotationType,
        textPart ? `text: ${textPart}` : "",
        commentPart ? `comment: ${commentPart}` : "",
      ].filter(Boolean);
      lines.push(`- ${segments.join(" | ")}`);
      if (lines.length >= MAX_ANNOTATION_ITEMS) {
        break;
      }
    }
    if (lines.length >= MAX_ANNOTATION_ITEMS) {
      break;
    }
  }
  if (!lines.length) {
    return "";
  }
  return ["Annotations:", ...lines].join("\n");
}

function buildSelectedTextBlock(item: Zotero.Item) {
  const candidates: string[] = [];
  const activeReaderSelection = readSelectedTextFromActiveReader(item);
  if (activeReaderSelection) {
    candidates.push(activeReaderSelection);
  }
  const cachedSelection = readCachedSelectedText(item);
  if (cachedSelection) {
    candidates.push(cachedSelection);
  }
  if (item.isAnnotation()) {
    if (item.annotationText) {
      candidates.push(item.annotationText);
    }
    if (item.annotationComment) {
      candidates.push(item.annotationComment);
    }
  }
  const merged = compactWhitespace(candidates.join("\n"));
  if (!merged) {
    return "";
  }
  return `Selected Text:\n${truncate(merged, MAX_SELECTED_TEXT_CHARS)}`;
}

function gatherAttachmentItems(item: Zotero.Item) {
  const output: Zotero.Item[] = [];
  if (item.isPDFAttachment()) {
    output.push(item);
  }
  const attachmentIDs = item.getAttachments(false);
  if (attachmentIDs.length) {
    const children = Zotero.Items.get(attachmentIDs);
    for (const child of children) {
      if (child?.isPDFAttachment()) {
        output.push(child);
      }
    }
  }
  return output;
}

function readCachedSelectedText(item: Zotero.Item) {
  cleanupExpiredSelectionCache();
  const keys = collectRelatedItemKeys(item);
  for (const key of keys) {
    const entry = selectedTextCacheByItemKey.get(key);
    if (entry?.text) {
      return entry.text;
    }
  }
  return "";
}

function collectRelatedItemKeys(item: Zotero.Item | null) {
  if (!item) {
    return [];
  }
  const keys: string[] = [];
  let current: Zotero.Item | undefined = item;
  let guard = 0;
  while (current && guard < 6) {
    if (current.key && !keys.includes(current.key)) {
      keys.push(current.key);
    }
    current = current.parentItem;
    guard += 1;
  }
  return keys;
}

function cleanupExpiredSelectionCache() {
  const now = Date.now();
  for (const [key, entry] of selectedTextCacheByItemKey.entries()) {
    if (entry.expiresAt <= now) {
      selectedTextCacheByItemKey.delete(key);
    }
  }
}

function readSelectedTextFromActiveReader(item: Zotero.Item) {
  const readerManager = Zotero.Reader as unknown as {
    _readers?: Array<{
      _item?: Zotero.Item;
      _internalReader?: {
        _primaryView?: {
          getSelectedAnnotations?: () => Array<{
            text?: string;
            comment?: string;
          }>;
        };
      };
    }>;
  };
  const readers = readerManager._readers;
  if (!Array.isArray(readers) || !readers.length) {
    return "";
  }
  const validKeys = new Set(collectRelatedItemKeys(item));
  for (const reader of readers) {
    const readerItem = reader?._item;
    if (!readerItem) {
      continue;
    }
    const readerKeys = collectRelatedItemKeys(readerItem);
    const isSameContext = readerKeys.some((key) => validKeys.has(key));
    if (!isSameContext) {
      continue;
    }
    const selected =
      reader?._internalReader?._primaryView?.getSelectedAnnotations?.();
    if (!Array.isArray(selected) || !selected.length) {
      continue;
    }
    const selectedText = compactWhitespace(
      selected
        .map((entry) => [entry.text || "", entry.comment || ""].join("\n"))
        .join("\n"),
    );
    if (selectedText) {
      return truncate(selectedText, MAX_SELECTED_TEXT_CHARS);
    }
  }
  return "";
}

function formatCreators(creators: _ZoteroTypes.Item.Creator[]) {
  const names = creators
    .slice(0, 6)
    .map((creator) => {
      if (creator.fieldMode === 1) {
        return creator.lastName?.trim();
      }
      return [creator.firstName?.trim(), creator.lastName?.trim()]
        .filter(Boolean)
        .join(" ");
    })
    .filter(Boolean);
  return names.join(", ");
}

function extractYear(dateField: string) {
  const match = dateField.match(/\b(\d{4})\b/);
  return match?.[1] || "";
}

function stripHTML(text: string) {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function compactWhitespace(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncate(text: string, limit: number) {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}
