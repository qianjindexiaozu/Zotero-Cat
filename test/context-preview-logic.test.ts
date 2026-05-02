import { assert } from "chai";
import { contextTestUtils } from "../src/modules/agent/context";

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
});
