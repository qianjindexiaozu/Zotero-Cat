export type WebSearchProviderID = "duckduckgo" | "searxng";

export interface WebSearchItemHint {
  title?: string;
  doi?: string;
  year?: string;
}

export interface WebSearchOptions {
  provider: string;
  endpoint: string;
  maxResults?: number;
}

export interface WebSearchResponse {
  provider: WebSearchProviderID;
  query: string;
  results: WebSearchResult[];
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: string;
  publishedAt?: string;
}

interface DuckDuckGoTopic {
  FirstURL?: unknown;
  Result?: unknown;
  Text?: unknown;
  Topics?: unknown;
  Name?: unknown;
}

interface DuckDuckGoResponse {
  AbstractSource?: unknown;
  AbstractText?: unknown;
  AbstractURL?: unknown;
  Heading?: unknown;
  RelatedTopics?: unknown;
  Results?: unknown;
}

interface SearXNGResponse {
  results?: unknown;
}

interface SearXNGResult {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  snippet?: unknown;
  engine?: unknown;
  publishedDate?: unknown;
  published_date?: unknown;
}

const DEFAULT_PROVIDER: WebSearchProviderID = "duckduckgo";
const DEFAULT_DUCKDUCKGO_ENDPOINT = "https://api.duckduckgo.com/";
const DEFAULT_DUCKDUCKGO_HTML_ENDPOINT = "https://html.duckduckgo.com/html/";
const DEFAULT_SEARXNG_ENDPOINT = "http://127.0.0.1:8888/search";
const DEFAULT_MAX_RESULTS = 5;
const SEARCH_TIMEOUT_MS = 15_000;
const MAX_QUERY_CHARS = 240;
const MAX_TITLE_CHARS = 120;
const MAX_SNIPPET_CHARS = 420;

export function normalizeWebSearchProvider(
  value: unknown,
): WebSearchProviderID {
  if (typeof value !== "string") {
    return DEFAULT_PROVIDER;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "searxng") {
    return "searxng";
  }
  return DEFAULT_PROVIDER;
}

export function getDefaultWebSearchEndpoint(provider: string) {
  return normalizeWebSearchProvider(provider) === "searxng"
    ? DEFAULT_SEARXNG_ENDPOINT
    : DEFAULT_DUCKDUCKGO_ENDPOINT;
}

export function getWebSearchProviderLabel(provider: string) {
  return normalizeWebSearchProvider(provider) === "searxng"
    ? "SearXNG"
    : "DuckDuckGo";
}

export function buildWebSearchQuery(
  prompt: string,
  itemHint?: WebSearchItemHint | null,
) {
  const normalizedPrompt = compactWhitespace(prompt);
  const hintParts = [
    compactWhitespace(itemHint?.title || ""),
    compactWhitespace(itemHint?.doi || ""),
    compactWhitespace(itemHint?.year || ""),
  ].filter(Boolean);
  const query = hintParts.length
    ? `${normalizedPrompt} ${hintParts.join(" ")}`
    : normalizedPrompt;
  return truncate(query, MAX_QUERY_CHARS);
}

export async function searchWeb(
  query: string,
  options: WebSearchOptions,
): Promise<WebSearchResponse> {
  const provider = normalizeWebSearchProvider(options.provider);
  const endpoint =
    normalizeString(options.endpoint) || getDefaultWebSearchEndpoint(provider);
  const maxResults = normalizeMaxResults(options.maxResults);
  const results =
    provider === "searxng"
      ? await searchSearXNG(query, endpoint, maxResults)
      : await searchDuckDuckGo(query, endpoint, maxResults);
  return { provider, query, results };
}

export function buildWebSearchContext(
  response: WebSearchResponse,
  locale: "en" | "zh" = "en",
) {
  const isZH = locale === "zh";
  const lines = [
    isZH
      ? `联网搜索结果（查询：${response.query}；来源：${getWebSearchProviderLabel(response.provider)}）`
      : `Web search results (query: ${response.query}; provider: ${getWebSearchProviderLabel(response.provider)})`,
    isZH
      ? "这些结果来自用户启用的联网搜索。使用其中信息时请引用 URL；如果结果不足或相互矛盾，请明确说明。"
      : "These results came from user-enabled web search. Cite URLs when using them, and state when results are limited or conflicting.",
  ];
  if (!response.results.length) {
    lines.push(
      isZH ? "未返回可用搜索结果。" : "No usable search results were returned.",
    );
    return lines.join("\n");
  }
  for (const [index, result] of response.results.entries()) {
    lines.push(
      [
        `${index + 1}. ${result.title}`,
        `URL: ${result.url}`,
        result.publishedAt ? `Published: ${result.publishedAt}` : "",
        result.source ? `Source: ${result.source}` : "",
        `Snippet: ${result.snippet}`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return lines.join("\n\n");
}

function buildDuckDuckGoSearchURL(endpoint: string, query: string) {
  const url = new URL(endpoint || DEFAULT_DUCKDUCKGO_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("no_html", "1");
  url.searchParams.set("no_redirect", "1");
  url.searchParams.set("skip_disambig", "1");
  return url.toString();
}

function buildDuckDuckGoHTMLSearchURL(query: string) {
  const url = new URL(DEFAULT_DUCKDUCKGO_HTML_ENDPOINT);
  url.searchParams.set("q", query);
  return url.toString();
}

function buildSearXNGSearchURL(endpoint: string, query: string) {
  const url = new URL(endpoint || DEFAULT_SEARXNG_ENDPOINT);
  if (url.pathname === "/" || !url.pathname) {
    url.pathname = "/search";
  }
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  return url.toString();
}

async function searchDuckDuckGo(
  query: string,
  endpoint: string,
  maxResults: number,
) {
  let lastError: unknown = null;
  try {
    const request = await Zotero.HTTP.request(
      "GET",
      buildDuckDuckGoSearchURL(endpoint, query),
      {
        headers: { Accept: "application/json" },
        timeout: SEARCH_TIMEOUT_MS,
      },
    );
    const results = parseDuckDuckGoResults(
      request.responseText || "",
      maxResults,
    );
    if (results.length) {
      return results;
    }
  } catch (error) {
    lastError = error;
  }
  try {
    const request = await Zotero.HTTP.request(
      "GET",
      buildDuckDuckGoHTMLSearchURL(query),
      {
        headers: { Accept: "text/html,application/xhtml+xml" },
        timeout: SEARCH_TIMEOUT_MS,
      },
    );
    return parseDuckDuckGoHTMLResults(request.responseText || "", maxResults);
  } catch (error) {
    if (lastError) {
      throw error;
    }
    throw error;
  }
}

async function searchSearXNG(
  query: string,
  endpoint: string,
  maxResults: number,
) {
  const request = await Zotero.HTTP.request(
    "GET",
    buildSearXNGSearchURL(endpoint, query),
    {
      headers: { Accept: "application/json" },
      timeout: SEARCH_TIMEOUT_MS,
    },
  );
  return parseSearXNGResults(request.responseText || "", maxResults);
}

function parseDuckDuckGoResults(responseText: string, maxResults: number) {
  const data = parseJSONRecord<DuckDuckGoResponse>(responseText);
  const results: WebSearchResult[] = [];
  const abstractText = compactWhitespace(asString(data.AbstractText));
  const abstractURL = compactWhitespace(asString(data.AbstractURL));
  if (abstractText && abstractURL) {
    results.push({
      title:
        truncate(compactWhitespace(asString(data.Heading)), MAX_TITLE_CHARS) ||
        abstractURL,
      url: abstractURL,
      snippet: truncate(abstractText, MAX_SNIPPET_CHARS),
      source: compactWhitespace(asString(data.AbstractSource)),
    });
  }
  for (const topic of collectDuckDuckGoTopics(data.Results)) {
    appendDuckDuckGoTopic(results, topic, maxResults);
  }
  for (const topic of collectDuckDuckGoTopics(data.RelatedTopics)) {
    appendDuckDuckGoTopic(results, topic, maxResults);
  }
  return dedupeResults(results).slice(0, maxResults);
}

function parseDuckDuckGoHTMLResults(responseText: string, maxResults: number) {
  const results = parseDuckDuckGoHTMLResultsWithDOM(responseText, maxResults);
  if (results.length) {
    return dedupeResults(results).slice(0, maxResults);
  }
  return dedupeResults(
    parseDuckDuckGoHTMLResultsWithRegex(responseText, maxResults),
  ).slice(0, maxResults);
}

function parseDuckDuckGoHTMLResultsWithDOM(
  responseText: string,
  maxResults: number,
) {
  const parser = getDOMParser();
  if (!parser) {
    return [];
  }
  const doc = parser.parseFromString(responseText, "text/html");
  const links = Array.from(
    doc.querySelectorAll("a.result__a"),
  ) as HTMLAnchorElement[];
  const results: WebSearchResult[] = [];
  for (const link of links) {
    const title = compactWhitespace(link.textContent || "");
    const url = normalizeDuckDuckGoResultURL(link.getAttribute("href") || "");
    const resultBlock = link.closest(".result");
    const snippetElement = resultBlock?.querySelector(".result__snippet") as
      | Element
      | null
      | undefined;
    const sourceElement = resultBlock?.querySelector(".result__url") as
      | Element
      | null
      | undefined;
    const snippet = compactWhitespace(snippetElement?.textContent || "");
    const source = compactWhitespace(sourceElement?.textContent || "");
    appendHTMLResult(results, { title, url, snippet, source }, maxResults);
  }
  return results;
}

function parseDuckDuckGoHTMLResultsWithRegex(
  responseText: string,
  maxResults: number,
) {
  const results: WebSearchResult[] = [];
  const blocks = responseText.match(
    /<div[^>]*class=["'][^"']*\bresult\b[^"']*["'][^>]*>[\s\S]*?<\/div>\s*<\/div>/gi,
  );
  for (const block of blocks || []) {
    const linkMatch = block.match(
      /<a[^>]*class=["'][^"']*\bresult__a\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!linkMatch) {
      continue;
    }
    const snippetMatch = block.match(
      /<a[^>]*class=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/a>|<div[^>]*class=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    );
    const sourceMatch = block.match(
      /<a[^>]*class=["'][^"']*\bresult__url\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i,
    );
    appendHTMLResult(
      results,
      {
        title: compactWhitespace(stripHTML(linkMatch[2] || "")),
        url: normalizeDuckDuckGoResultURL(linkMatch[1] || ""),
        snippet: compactWhitespace(
          stripHTML(snippetMatch?.[1] || snippetMatch?.[2] || ""),
        ),
        source: compactWhitespace(stripHTML(sourceMatch?.[1] || "")),
      },
      maxResults,
    );
  }
  return results;
}

function appendHTMLResult(
  results: WebSearchResult[],
  candidate: WebSearchResult,
  maxResults: number,
) {
  if (results.length >= maxResults) {
    return;
  }
  if (!candidate.title || !candidate.url || !candidate.snippet) {
    return;
  }
  results.push({
    title: truncate(candidate.title, MAX_TITLE_CHARS),
    url: candidate.url,
    snippet: truncate(candidate.snippet, MAX_SNIPPET_CHARS),
    source: candidate.source,
  });
}

function appendDuckDuckGoTopic(
  results: WebSearchResult[],
  topic: DuckDuckGoTopic,
  maxResults: number,
) {
  if (results.length >= maxResults) {
    return;
  }
  const url = compactWhitespace(asString(topic.FirstURL));
  const rawText = compactWhitespace(
    stripHTML(asString(topic.Text) || asString(topic.Result)),
  );
  if (!url || !rawText) {
    return;
  }
  const [titleCandidate, ...snippetParts] = rawText.split(" - ");
  results.push({
    title: truncate(titleCandidate || url, MAX_TITLE_CHARS),
    url,
    snippet: truncate(snippetParts.join(" - ") || rawText, MAX_SNIPPET_CHARS),
    source: compactWhitespace(asString(topic.Name)),
  });
}

function collectDuckDuckGoTopics(value: unknown): DuckDuckGoTopic[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const topics: DuckDuckGoTopic[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const topic = entry as DuckDuckGoTopic;
    if (Array.isArray(topic.Topics)) {
      topics.push(...collectDuckDuckGoTopics(topic.Topics));
    } else {
      topics.push(topic);
    }
  }
  return topics;
}

function getDOMParser() {
  try {
    if (typeof DOMParser === "undefined") {
      return null;
    }
    return new DOMParser();
  } catch (_error) {
    return null;
  }
}

function normalizeDuckDuckGoResultURL(value: string) {
  const rawValue = decodeBasicEntities(value).trim();
  if (!rawValue) {
    return "";
  }
  try {
    const url = new URL(rawValue, "https://duckduckgo.com");
    const redirectedURL = url.searchParams.get("uddg");
    if (redirectedURL) {
      return normalizeHTTPURL(redirectedURL);
    }
    return normalizeHTTPURL(url.toString());
  } catch (_error) {
    return normalizeHTTPURL(rawValue);
  }
}

function normalizeHTTPURL(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : "";
  } catch (_error) {
    return "";
  }
}

function parseSearXNGResults(responseText: string, maxResults: number) {
  const data = parseJSONRecord<SearXNGResponse>(responseText);
  if (!Array.isArray(data.results)) {
    return [];
  }
  const results: WebSearchResult[] = [];
  for (const entry of data.results) {
    if (!isRecord(entry)) {
      continue;
    }
    const raw = entry as SearXNGResult;
    const url = compactWhitespace(asString(raw.url));
    const title = compactWhitespace(asString(raw.title));
    const snippet = compactWhitespace(
      stripHTML(asString(raw.content) || asString(raw.snippet)),
    );
    if (!url || !title || !snippet) {
      continue;
    }
    results.push({
      title: truncate(title, MAX_TITLE_CHARS),
      url,
      snippet: truncate(snippet, MAX_SNIPPET_CHARS),
      source: compactWhitespace(asString(raw.engine)),
      publishedAt: compactWhitespace(
        asString(raw.publishedDate) || asString(raw.published_date),
      ),
    });
    if (results.length >= maxResults) {
      break;
    }
  }
  return dedupeResults(results);
}

function dedupeResults(results: WebSearchResult[]) {
  const seen = new Set<string>();
  const output: WebSearchResult[] = [];
  for (const result of results) {
    const key = result.url.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(result);
  }
  return output;
}

function parseJSONRecord<T extends object>(text: string): T {
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed)) {
    return {} as T;
  }
  return parsed as T;
}

function normalizeMaxResults(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MAX_RESULTS;
  }
  return Math.max(1, Math.min(10, Math.floor(value)));
}

function normalizeString(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function compactWhitespace(text: string) {
  return decodeBasicEntities(text)
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

function stripHTML(text: string) {
  return text.replace(/<[^>]+>/g, " ");
}

function decodeBasicEntities(text: string) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function truncate(text: string, limit: number) {
  const normalized = text.trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

export const webSearchTestUtils = {
  buildDuckDuckGoHTMLSearchURL,
  buildDuckDuckGoSearchURL,
  buildSearXNGSearchURL,
  parseDuckDuckGoHTMLResults,
  parseDuckDuckGoResults,
  parseSearXNGResults,
};
