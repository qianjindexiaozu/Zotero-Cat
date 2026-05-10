import { collapseWhitespace, normalizeMultiline } from "../../utils/text";

interface PdfJsModule {
  getDocument: (src: {
    data: Uint8Array;
    useWorkerFetch?: boolean;
    isEvalSupported?: boolean;
    disableFontFace?: boolean;
  }) => { promise: Promise<PdfDocument> };
  GlobalWorkerOptions: { workerSrc: string | null };
}

interface PdfDocument {
  numPages: number;
  getPage(index: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}

interface PdfPage {
  pageNumber: number;
  getViewport(options: { scale: number }): PdfViewport;
  getTextContent(): Promise<PdfTextContent>;
}

interface PdfViewport {
  width: number;
  height: number;
}

interface PdfTextContent {
  items: PdfTextItem[];
}

interface PdfTextItem {
  str: string;
  width: number;
  height: number;
  transform: number[];
}

export interface ExtractedTextSpan {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExtractedPage {
  pageIndex: number;
  pageLabel: string;
  pageWidth: number;
  pageHeight: number;
  text: string;
  spans: ExtractedTextSpan[];
}

export interface ResolvedRects {
  pageIndex: number;
  pageLabel: string;
  rects: number[][];
  matchedText: string;
}

const SEARCH_WINDOW_PAGES = 2;

let pdfjsPromise: Promise<PdfJsModule> | null = null;
let cachedDocumentByPath = new Map<
  string,
  Promise<{ pages: ExtractedPage[]; mtime: number }>
>();

function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs").then((mod) => {
      const pdfjs = mod as unknown as PdfJsModule;
      // Run pdf.js in the main thread. Zotero's XUL context cannot easily load
      // a classic worker from chrome://, and PDFs processed here are bounded
      // in size by single-paper usage.
      pdfjs.GlobalWorkerOptions.workerSrc = "";
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

export async function extractPages(
  attachment: Zotero.Item,
): Promise<ExtractedPage[]> {
  const path = await resolveAttachmentPath(attachment);
  if (!path) {
    throw new Error("PDF attachment has no readable file path.");
  }
  const mtime = await resolveFileMTime(path);
  const cached = cachedDocumentByPath.get(path);
  if (cached) {
    const resolved = await cached;
    if (resolved.mtime === mtime) {
      return resolved.pages;
    }
    cachedDocumentByPath.delete(path);
  }
  const promise = (async () => {
    const pages = await readDocumentPages(path, attachment);
    return { pages, mtime };
  })();
  cachedDocumentByPath.set(path, promise);
  try {
    return (await promise).pages;
  } catch (error) {
    cachedDocumentByPath.delete(path);
    throw error;
  }
}

export function renderPagesAsText(pages: ExtractedPage[]): string {
  return pages
    .map((page) => `[p.${page.pageLabel}]\n${page.text}`)
    .join("\n\n");
}

export function findTextRects(
  pages: ExtractedPage[],
  targetPageIndex: number | null | undefined,
  query: string,
): ResolvedRects | null {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) {
    return null;
  }
  const candidateOrder = buildSearchOrder(pages, targetPageIndex);
  for (const page of candidateOrder) {
    const match = matchPage(page, normalizedQuery);
    if (match) {
      return match;
    }
  }
  return null;
}

function buildSearchOrder(
  pages: ExtractedPage[],
  targetPageIndex: number | null | undefined,
): ExtractedPage[] {
  if (
    typeof targetPageIndex !== "number" ||
    !Number.isFinite(targetPageIndex)
  ) {
    return pages;
  }
  const seen = new Set<number>();
  const ordered: ExtractedPage[] = [];
  for (let offset = 0; offset <= SEARCH_WINDOW_PAGES; offset += 1) {
    for (const direction of [0, -1, 1]) {
      const index = targetPageIndex + direction * offset;
      if (offset === 0 && direction !== 0) {
        continue;
      }
      if (seen.has(index) || index < 0 || index >= pages.length) {
        continue;
      }
      seen.add(index);
      ordered.push(pages[index]);
    }
  }
  for (const page of pages) {
    if (!seen.has(page.pageIndex)) {
      seen.add(page.pageIndex);
      ordered.push(page);
    }
  }
  return ordered;
}

function matchPage(
  page: ExtractedPage,
  normalizedQuery: string,
): ResolvedRects | null {
  if (!page.spans.length) {
    return null;
  }
  const { normalizedText, spanIndexMap } = buildNormalizedIndex(page.spans);
  const idx = normalizedText.indexOf(normalizedQuery);
  if (idx < 0) {
    return null;
  }
  const endIdx = idx + normalizedQuery.length;
  const startSpan = spanIndexMap[idx];
  const endSpan = spanIndexMap[endIdx - 1];
  if (startSpan === undefined || endSpan === undefined) {
    return null;
  }
  const rects = mergeSpanRects(
    page.spans.slice(startSpan, endSpan + 1),
    page.pageHeight,
  );
  const matchedText = page.spans
    .slice(startSpan, endSpan + 1)
    .map((span) => span.text)
    .join("");
  return {
    pageIndex: page.pageIndex,
    pageLabel: page.pageLabel,
    rects,
    matchedText,
  };
}

function buildNormalizedIndex(spans: ExtractedTextSpan[]): {
  normalizedText: string;
  spanIndexMap: number[];
} {
  const pieces: string[] = [];
  const spanIndexMap: number[] = [];
  spans.forEach((span, spanIndex) => {
    const normalized = collapseWhitespace(span.text).toLowerCase();
    if (!normalized) {
      return;
    }
    pieces.push(normalized);
    for (let i = 0; i < normalized.length; i += 1) {
      spanIndexMap.push(spanIndex);
    }
    if (spanIndex < spans.length - 1) {
      pieces.push(" ");
      spanIndexMap.push(spanIndex);
    }
  });
  return { normalizedText: pieces.join(""), spanIndexMap };
}

function normalizeQuery(query: string): string {
  return collapseWhitespace(query).toLowerCase();
}

function mergeSpanRects(
  spans: ExtractedTextSpan[],
  pageHeight: number,
): number[][] {
  if (!spans.length) {
    return [];
  }
  const rectsByLine = new Map<
    number,
    { x1: number; y1: number; x2: number; y2: number }
  >();
  for (const span of spans) {
    const x1 = span.x;
    const x2 = span.x + span.width;
    // pdf.js exposes the baseline Y; convert to PDF user space where the
    // origin sits at the bottom-left and rects run [x1, y1, x2, y2] with y2 > y1.
    const y1 = pageHeight - (span.y + span.height);
    const y2 = pageHeight - span.y;
    const lineKey = Math.round(y1);
    const existing = rectsByLine.get(lineKey);
    if (!existing) {
      rectsByLine.set(lineKey, { x1, y1, x2, y2 });
      continue;
    }
    existing.x1 = Math.min(existing.x1, x1);
    existing.x2 = Math.max(existing.x2, x2);
    existing.y1 = Math.min(existing.y1, y1);
    existing.y2 = Math.max(existing.y2, y2);
  }
  return [...rectsByLine.values()]
    .sort((a, b) => b.y1 - a.y1)
    .map((rect) => [
      round(rect.x1),
      round(rect.y1),
      round(rect.x2),
      round(rect.y2),
    ]);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

async function readDocumentPages(
  path: string,
  attachment: Zotero.Item,
): Promise<ExtractedPage[]> {
  const pdfjs = await loadPdfJs();
  const data = await readFileAsUint8Array(path);
  const loadingTask = pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
  });
  const document = await loadingTask.promise;
  const pages: ExtractedPage[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const spans: ExtractedTextSpan[] = [];
      for (const item of content.items) {
        if (!item.str) {
          continue;
        }
        const transform = item.transform;
        const x = transform[4];
        const y = transform[5];
        const height = item.height || Math.abs(transform[3]);
        const width = item.width;
        spans.push({
          text: item.str,
          x,
          y,
          width,
          height,
        });
      }
      const pageIndex = pageNumber - 1;
      const pageLabel =
        resolvePageLabel(attachment, pageIndex) || String(pageNumber);
      pages.push({
        pageIndex,
        pageLabel,
        pageWidth: viewport.width,
        pageHeight: viewport.height,
        spans,
        text: normalizeMultiline(spans.map((span) => span.text).join(" ")),
      });
    }
  } finally {
    try {
      await document.destroy();
    } catch (_error) {
      // ignore cleanup failures
    }
  }
  return pages;
}

function resolvePageLabel(attachment: Zotero.Item, pageIndex: number): string {
  try {
    const annotations = attachment.getAnnotations?.(false) || [];
    for (const annotation of annotations) {
      const position = parseAnnotationPosition(annotation.annotationPosition);
      if (position && position.pageIndex === pageIndex) {
        return annotation.annotationPageLabel || String(pageIndex + 1);
      }
    }
  } catch (_error) {
    // fall through to default
  }
  return String(pageIndex + 1);
}

function parseAnnotationPosition(value: string | undefined): {
  pageIndex?: number;
} | null {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

async function resolveAttachmentPath(
  attachment: Zotero.Item,
): Promise<string | null> {
  try {
    if (typeof attachment.getFilePathAsync === "function") {
      const path = await attachment.getFilePathAsync();
      return path || null;
    }
    const path = attachment.getFilePath?.();
    return path || null;
  } catch (_error) {
    return null;
  }
}

async function resolveFileMTime(path: string): Promise<number> {
  try {
    const ioUtils = (
      globalThis as unknown as {
        IOUtils?: { stat: (path: string) => Promise<{ lastModified: number }> };
      }
    ).IOUtils;
    if (ioUtils?.stat) {
      const stat = await ioUtils.stat(path);
      return stat?.lastModified || 0;
    }
  } catch (_error) {
    // fall through
  }
  return 0;
}

async function readFileAsUint8Array(path: string): Promise<Uint8Array> {
  const ioUtils = (
    globalThis as unknown as {
      IOUtils?: { read: (path: string) => Promise<Uint8Array> };
    }
  ).IOUtils;
  if (ioUtils?.read) {
    return ioUtils.read(path);
  }
  throw new Error("IOUtils.read is not available in this Zotero runtime.");
}

export function clearPdfReaderCache(): void {
  cachedDocumentByPath = new Map();
}

export const pdfReaderTestUtils = {
  buildNormalizedIndex,
  matchPage,
  mergeSpanRects,
  normalizeQuery,
  buildSearchOrder,
};
