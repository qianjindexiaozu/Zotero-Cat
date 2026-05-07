import { assert } from "chai";
import {
  parseAssistantToolAction,
  registerToolActionHandler,
} from "../src/modules/agent/toolAction";
import {
  buildWebSearchContext,
  buildWebSearchQuery,
  normalizeWebSearchProvider,
  webSearchTestUtils,
} from "../src/modules/tools/webSearch";

registerToolActionHandler({
  type: "web-search",
  aliases: [
    "联网搜索",
    "搜索",
    "web_search",
    "web search",
    "search_web",
    "search web",
    "search",
  ],
  extractQuery(actionInput, rawRecord) {
    const q =
      (typeof actionInput.query === "string" ? actionInput.query : "") ||
      (typeof actionInput.q === "string" ? actionInput.q : "") ||
      (typeof rawRecord.query === "string" ? rawRecord.query : "");
    return q.replace(/\s+/g, " ").trim();
  },
  isAvailable() {
    return true;
  },
  async execute() {
    return "";
  },
});

describe("web search logic", function () {
  it("should build a bounded query with item hints", function () {
    const query = buildWebSearchQuery("find recent discussion", {
      title: "A Very Specific Research Paper",
      doi: "10.1234/example",
      year: "2026",
    });

    assert.include(query, "find recent discussion");
    assert.include(query, "A Very Specific Research Paper");
    assert.include(query, "10.1234/example");
    assert.isAtMost(query.length, 240);
  });

  it("should parse DuckDuckGo abstract and nested topics", function () {
    const results = webSearchTestUtils.parseDuckDuckGoResults(
      JSON.stringify({
        Heading: "Zotero",
        AbstractText: "Reference manager.",
        AbstractURL: "https://www.zotero.org/",
        AbstractSource: "Wikipedia",
        RelatedTopics: [
          {
            Topics: [
              {
                FirstURL: "https://example.com/plugin",
                Text: "Plugin - A useful extension.",
              },
            ],
          },
        ],
      }),
      5,
    );

    assert.lengthOf(results, 2);
    assert.deepInclude(results[0], {
      title: "Zotero",
      url: "https://www.zotero.org/",
      snippet: "Reference manager.",
      source: "Wikipedia",
    });
    assert.deepInclude(results[1], {
      title: "Plugin",
      url: "https://example.com/plugin",
      snippet: "A useful extension.",
    });
  });

  it("should parse DuckDuckGo HTML search fallback results", function () {
    const results = webSearchTestUtils.parseDuckDuckGoHTMLResults(
      `
      <html><body>
        <div class="result results_links">
          <h2 class="result__title">
            <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpaper&amp;rut=abc">
              Example Paper
            </a>
          </h2>
          <a class="result__snippet">A <b>useful</b> search result.</a>
          <a class="result__url">example.com/paper</a>
        </div>
      </body></html>
      `,
      5,
    );

    assert.deepEqual(results, [
      {
        title: "Example Paper",
        url: "https://example.com/paper",
        snippet: "A useful search result.",
        source: "example.com/paper",
      },
    ]);
  });

  it("should parse SearXNG JSON results", function () {
    const results = webSearchTestUtils.parseSearXNGResults(
      JSON.stringify({
        results: [
          {
            title: "Result title",
            url: "https://example.com/result",
            content: "Result <b>snippet</b>.",
            engine: "example",
            publishedDate: "2026-05-05",
          },
        ],
      }),
      5,
    );

    assert.deepEqual(results, [
      {
        title: "Result title",
        url: "https://example.com/result",
        snippet: "Result snippet.",
        source: "example",
        publishedAt: "2026-05-05",
      },
    ]);
  });

  it("should format web search context with citation instructions", function () {
    const context = buildWebSearchContext({
      provider: "duckduckgo",
      query: "zotero cat",
      results: [
        {
          title: "Project",
          url: "https://example.com/project",
          snippet: "Project snippet.",
        },
      ],
    });

    assert.include(context, "Web search results");
    assert.include(context, "Cite URLs");
    assert.include(context, "https://example.com/project");
  });

  it("should normalize unsupported search providers to the default", function () {
    assert.equal(normalizeWebSearchProvider("searxng"), "searxng");
    assert.equal(normalizeWebSearchProvider("unknown"), "duckduckgo");
  });

  it("should return rawInput alongside parsed action", function () {
    const action = parseAssistantToolAction(
      '{"action":"search","action_input":{"query":"test query"}}',
    );
    assert.isNotNull(action);
    assert.equal(action!.type, "web-search");
    assert.equal(action!.query, "test query");
    assert.deepEqual(action!.rawInput, { query: "test query" });
  });

  it("should return null for unregistered tool action names", function () {
    const action = parseAssistantToolAction(
      '{"action":"unknown_tool","action_input":{"query":"test"}}',
    );
    assert.isNull(action);
  });

  it("should parse model-emitted web search action JSON", function () {
    const action = parseAssistantToolAction(`
我将搜索最新研究。

\`\`\`json
{
  "action": "联网搜索",
  "action_input": {
    "query": "soil moisture prediction transformer LSTM 2025 2026"
  }
}
\`\`\`
`);

    assert.deepEqual(action, {
      type: "web-search",
      query: "soil moisture prediction transformer LSTM 2025 2026",
      rawInput: {
        query: "soil moisture prediction transformer LSTM 2025 2026",
      },
    });
  });
});
