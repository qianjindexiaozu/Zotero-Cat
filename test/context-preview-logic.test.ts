import { assert } from "chai";
import {
  buildContextPreview,
  contextTestUtils,
} from "../src/modules/agent/context";

describe("context preview logic", function () {
  it("should estimate token pressure for long and CJK text", function () {
    const englishTokens = contextTestUtils.estimateTextTokens(
      "This is a compact English context preview.",
    );
    const cjkTokens =
      contextTestUtils.estimateTextTokens("这是一个中文上下文预算提示。");
    const longTokens = contextTestUtils.estimateTextTokens(
      "x".repeat(contextTestUtils.maxSystemContextChars + 400),
    );

    assert.isAtLeast(englishTokens, 1);
    assert.isAtLeast(cjkTokens, 1);
    assert.isAbove(longTokens, contextTestUtils.systemContextTokenBudget);
  });

  it("should keep the full abstract in metadata before global context truncation", function () {
    const longAbstract = [
      "Abstract opening.",
      "This sentence should remain part of the injected metadata.".repeat(20),
      "Abstract final sentence.",
    ].join(" ");
    const item = {
      parentItem: null,
      itemTypeID: Zotero.ItemTypes.getID("journalArticle"),
      getDisplayTitle: () => "Long abstract paper",
      getField: (field: string) => {
        if (field === "title") {
          return "Long abstract paper";
        }
        if (field === "abstractNote") {
          return longAbstract;
        }
        return "";
      },
      getCreators: () => [],
      getNotes: () => [],
      getAttachments: () => [],
      isPDFAttachment: () => false,
      isAnnotation: () => false,
    } as unknown as Zotero.Item;

    const preview = buildContextPreview({
      item,
      contextOptions: {
        includeMetadata: true,
        includeNotes: false,
        includeAnnotations: false,
        includeSelectedText: false,
      },
      templateID: "general",
    });

    assert.include(preview.contextText, longAbstract);
    assert.notInclude(preview.contextText, "…");
    assert.isFalse(preview.truncated);
  });

  it("should expand injected context budget when model context window is known", function () {
    const customContext = "x".repeat(
      contextTestUtils.maxSystemContextChars + 5000,
    );
    const preview = buildContextPreview({
      item: null,
      contextOptions: {
        includeMetadata: false,
        includeNotes: false,
        includeAnnotations: false,
        includeSelectedText: false,
      },
      templateID: "general",
      customContext,
      modelContextWindow: 1048576,
    });

    assert.isAbove(
      preview.tokenBudget,
      contextTestUtils.systemContextTokenBudget,
    );
    assert.include(preview.text, customContext);
    assert.isFalse(preview.truncated);
  });
});
