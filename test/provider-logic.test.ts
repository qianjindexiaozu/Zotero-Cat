import { assert } from "chai";
import {
  isApiKeyRequiredForProvider,
  providerTestUtils,
} from "../src/modules/agent/provider";

describe("provider logic", function () {
  it("should allow providers without API key", function () {
    assert.isFalse(isApiKeyRequiredForProvider("ollama"));
    assert.isFalse(isApiKeyRequiredForProvider("OLLAMA"));
    assert.isTrue(isApiKeyRequiredForProvider("openai"));
  });

  it("should keep both streaming and non-streaming attempts", function () {
    const attempts = providerTestUtils.buildEndpointAttempts(
      "https://api.example.com/v1",
      null,
    );
    const baseAttempts = attempts.filter(
      (attempt) =>
        attempt.endpoint === "https://api.example.com/v1" &&
        attempt.wireAPI === "chat-completions",
    );
    assert.lengthOf(baseAttempts, 2);
    assert.deepEqual(baseAttempts.map((attempt) => attempt.stream).sort(), [
      false,
      true,
    ]);
  });

  it("should fallback when stream mode is unsupported", function () {
    const fallback = providerTestUtils.canFallbackWithMessage(
      true,
      0,
      2,
      "400 Bad Request: stream is not supported by this endpoint",
    );
    assert.isTrue(fallback);
  });

  it("should not fallback for invalid api key", function () {
    const fallback = providerTestUtils.canFallbackWithMessage(
      true,
      0,
      2,
      "401 INVALID_API_KEY: invalid api key",
    );
    assert.isFalse(fallback);
  });

  it("should fallback for non-json response when next attempt exists", function () {
    assert.isTrue(providerTestUtils.canFallbackForNonJSON(true, 0, 2));
    assert.isFalse(providerTestUtils.canFallbackForNonJSON(true, 1, 2));
  });

  it("should parse stream deltas from common payload shapes", function () {
    assert.equal(providerTestUtils.extractStreamDelta({ delta: "A" }), "A");
    assert.equal(
      providerTestUtils.extractStreamDelta({
        choices: [{ delta: { content: "B" } }],
      }),
      "B",
    );
    assert.equal(
      providerTestUtils.extractStreamDelta({
        choices: [{ delta: { content: [{ text: "C1" }, { text: "C2" }] } }],
      }),
      "C1C2",
    );
    assert.equal(
      providerTestUtils.extractStreamDelta({
        item: { type: "response.output_text.delta", delta: "D" },
      }),
      "D",
    );
  });

  it("should attach reasoning effort payload and keep compatibility fallback", function () {
    const responsesPayloads = providerTestUtils.buildPayloadVariants(
      "responses",
      "high",
      false,
    );
    assert.lengthOf(responsesPayloads, 2);
    assert.deepEqual((responsesPayloads[0] as any).reasoning, {
      effort: "high",
    });
    assert.isUndefined((responsesPayloads[1] as any).reasoning);

    const chatPayloads = providerTestUtils.buildPayloadVariants(
      "chat-completions",
      "minimal",
      false,
    );
    assert.lengthOf(chatPayloads, 2);
    assert.equal((chatPayloads[0] as any).reasoning_effort, "minimal");
    assert.isUndefined((chatPayloads[1] as any).reasoning_effort);
  });
});
