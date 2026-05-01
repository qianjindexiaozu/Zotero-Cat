import { assert } from "chai";
import {
  buildChatEndpoint,
  isApiKeyRequiredForProvider,
} from "../src/modules/agent/provider";

describe("provider logic", function () {
  it("should normalize endpoint to /chat/completions", function () {
    assert.equal(
      buildChatEndpoint("https://api.openai.com/v1"),
      "https://api.openai.com/v1/chat/completions",
    );
    assert.equal(
      buildChatEndpoint("https://api.openai.com/v1/"),
      "https://api.openai.com/v1/chat/completions",
    );
  });

  it("should allow providers without API key", function () {
    assert.isFalse(isApiKeyRequiredForProvider("ollama"));
    assert.isFalse(isApiKeyRequiredForProvider("OLLAMA"));
    assert.isTrue(isApiKeyRequiredForProvider("openai"));
  });
});
