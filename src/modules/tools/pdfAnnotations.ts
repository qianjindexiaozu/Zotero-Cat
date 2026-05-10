import type { AnnotationResolvedJSON } from "../agent/annotationProposals";

export interface SaveAnnotationResult {
  success: boolean;
  annotationKey?: string;
  error?: string;
}

const DEFAULT_COLOR = "#ffd400";

export async function createAnnotation(
  attachment: Zotero.Item,
  resolved: AnnotationResolvedJSON,
): Promise<SaveAnnotationResult> {
  try {
    if (!attachment || typeof attachment.isPDFAttachment !== "function") {
      return {
        success: false,
        error: "Missing PDF attachment reference.",
      };
    }
    if (!attachment.isPDFAttachment()) {
      return {
        success: false,
        error: "Target item is not a PDF attachment.",
      };
    }
    const json = buildAnnotationJSON(resolved, attachment);
    const variants = splitIfNeeded(json);
    let firstKey: string | undefined;
    for (const variant of variants) {
      const saved = await Zotero.Annotations.saveFromJSON(attachment, variant);
      if (!firstKey && saved?.key) {
        firstKey = saved.key;
      }
    }
    return { success: true, annotationKey: firstKey };
  } catch (error) {
    return { success: false, error: formatError(error) };
  }
}

export async function updateAnnotation(
  attachment: Zotero.Item,
  resolved: AnnotationResolvedJSON & { key: string },
): Promise<SaveAnnotationResult> {
  try {
    if (!attachment || typeof attachment.isPDFAttachment !== "function") {
      return { success: false, error: "Missing PDF attachment reference." };
    }
    if (!attachment.isPDFAttachment()) {
      return { success: false, error: "Target item is not a PDF attachment." };
    }
    if (!resolved.key) {
      return { success: false, error: "Missing annotation key for update." };
    }
    const existing = Zotero.Items.getByLibraryAndKey(
      attachment.libraryID,
      resolved.key,
    ) as Zotero.Item | false;
    if (!existing || !existing.isAnnotation?.()) {
      return { success: false, error: "Target annotation does not exist." };
    }
    const json = buildAnnotationJSON(resolved, attachment);
    json.key = resolved.key;
    await Zotero.Annotations.saveFromJSON(attachment, json);
    return { success: true, annotationKey: resolved.key };
  } catch (error) {
    return { success: false, error: formatError(error) };
  }
}

export async function deleteAnnotation(
  attachment: Zotero.Item,
  annotationKey: string,
): Promise<SaveAnnotationResult> {
  try {
    if (!annotationKey) {
      return { success: false, error: "Missing annotation key for delete." };
    }
    const existing = Zotero.Items.getByLibraryAndKey(
      attachment.libraryID,
      annotationKey,
    ) as Zotero.Item | false;
    if (!existing || !existing.isAnnotation?.()) {
      return { success: false, error: "Target annotation does not exist." };
    }
    await existing.eraseTx();
    return { success: true, annotationKey };
  } catch (error) {
    return { success: false, error: formatError(error) };
  }
}

export function buildAnnotationJSON(
  resolved: AnnotationResolvedJSON,
  attachment: Zotero.Item,
): _ZoteroTypes.Annotations.AnnotationJson {
  const pageIndex = Math.max(0, Math.floor(resolved.pageIndex || 0));
  const rects = Array.isArray(resolved.rects) ? resolved.rects : [];
  const type = resolved.type;
  const position =
    type === "note" || type === "text"
      ? {
          pageIndex,
          rects:
            rects.length && rects[0].length === 4
              ? rects.slice(0, 1)
              : [[50, 750, 60, 760]],
        }
      : { pageIndex, rects };
  return {
    id: resolved.key || "",
    libraryID: attachment.libraryID,
    key: resolved.key || "",
    type,
    text: resolved.text || "",
    comment: resolved.comment || "",
    color: normalizeColor(resolved.color),
    pageLabel: resolved.pageLabel || String(pageIndex + 1),
    sortIndex: buildSortIndex(pageIndex, position.rects),
    position,
    tags: resolved.tags
      ? (resolved.tags as unknown as {
          name: string;
          color: string;
        })
      : undefined,
    dateModified: new Date().toISOString().replace("T", " ").slice(0, 19),
    readOnly: false,
  } as _ZoteroTypes.Annotations.AnnotationJson;
}

function splitIfNeeded(
  json: _ZoteroTypes.Annotations.AnnotationJson,
): _ZoteroTypes.Annotations.AnnotationJson[] {
  try {
    const variants = Zotero.Annotations.splitAnnotationJSON(json);
    if (Array.isArray(variants) && variants.length) {
      return variants;
    }
  } catch (_error) {
    // Fall back to the original JSON if splitting is unavailable or throws.
  }
  return [json];
}

function buildSortIndex(pageIndex: number, rects: number[][]): string {
  const topMost = rects.length
    ? Math.max(...rects.map((r) => Number(r[3]) || 0))
    : 0;
  const leftMost = rects.length
    ? Math.min(...rects.map((r) => Number(r[0]) || 0))
    : 0;
  // Matches Zotero's "PPPPP|LLLLL|TTTTT" convention used for annotation order.
  return [
    padNumber(pageIndex, 5),
    padNumber(Math.floor(leftMost), 5),
    padNumber(Math.floor(10000 - topMost), 5),
  ].join("|");
}

function padNumber(value: number, width: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return String(safe).padStart(width, "0");
}

function normalizeColor(value: string | undefined): string {
  if (!value) {
    return DEFAULT_COLOR;
  }
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) {
    return `#${trimmed}`;
  }
  return DEFAULT_COLOR;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || String(error);
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch (_error) {
    return String(error);
  }
}

export const pdfAnnotationsTestUtils = {
  buildAnnotationJSON,
  buildSortIndex,
  normalizeColor,
};
