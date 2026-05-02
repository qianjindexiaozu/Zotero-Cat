import { assert } from "chai";
import { sectionTestUtils } from "../src/modules/agent/section";
import { preferenceScriptTestUtils } from "../src/modules/preferenceScript";

describe("model probe logic", function () {
  it("should build endpoint candidates from base url", function () {
    const sectionCandidates = sectionTestUtils.buildModelEndpointCandidates(
      "https://example.com/v1",
    );
    assert.include(sectionCandidates, "https://example.com/v1");
    assert.include(sectionCandidates, "https://example.com/v1/models");
    assert.include(sectionCandidates, "https://example.com/models");

    const prefCandidates =
      preferenceScriptTestUtils.buildModelsEndpointCandidates(
        "https://example.com/v1",
      );
    assert.include(prefCandidates, "https://example.com/v1");
    assert.include(prefCandidates, "https://example.com/v1/models");
    assert.include(prefCandidates, "https://example.com/models");
  });

  it("should retry endpoint probing for parser errors regardless locale message", function () {
    let sectionError: Error | null = null;
    try {
      sectionTestUtils.parseModelIDs("<!doctype html>");
    } catch (error) {
      sectionError = error as Error;
    }
    assert.instanceOf(sectionError, Error);
    assert.isTrue(
      sectionTestUtils.canRetryModelEndpointError(0, 2, sectionError!),
    );

    let prefError: Error | null = null;
    try {
      preferenceScriptTestUtils.countModels("<!doctype html>");
    } catch (error) {
      prefError = error as Error;
    }
    assert.instanceOf(prefError, Error);
    assert.isTrue(
      preferenceScriptTestUtils.canRetryTestEndpointError(0, 2, prefError!),
    );
  });

  it("should fail test-connection parse when model list is missing or empty", function () {
    assert.throws(
      () => preferenceScriptTestUtils.countModels('{"ok":true}'),
      /model|模型/i,
    );
    assert.throws(
      () => preferenceScriptTestUtils.countModels('{"data":[]}'),
      /empty|空/i,
    );
  });

  it("should parse valid model list count", function () {
    const count = preferenceScriptTestUtils.countModels(
      '{"data":[{"id":"gpt-4o"},{"id":"gpt-4.1"}]}',
    );
    assert.equal(count, 2);
  });
});
