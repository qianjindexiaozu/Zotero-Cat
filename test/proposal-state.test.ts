import { assert } from "chai";
import {
  acceptAllPending,
  addProposals,
  annotationProposalsTestUtils,
  clearBatch,
  createBatch,
  getBatchForConversation,
  hasPendingBatch,
  rejectAllPending,
  setProposalStatus,
  summarizeBatch,
} from "../src/modules/agent/annotationProposals";

const SAMPLE = {
  op: "create" as const,
  attachmentKey: "ATTACH1",
  attachmentID: 42,
  resolved: {
    type: "highlight" as const,
    pageIndex: 2,
    pageLabel: "3",
    rects: [[10, 20, 30, 40]],
    text: "hello",
  },
  sourceSnippet: "hello",
};

describe("annotation proposals state machine", function () {
  beforeEach(function () {
    annotationProposalsTestUtils.reset();
  });

  it("creates a batch with pending proposals", function () {
    const batch = createBatch("conv1", 3, [SAMPLE, SAMPLE]);
    assert.equal(batch.proposals.length, 2);
    assert.equal(batch.proposals[0].status, "pending");
    assert.isTrue(hasPendingBatch("conv1"));
  });

  it("caps proposals at the batch limit", function () {
    const over = Array.from(
      { length: annotationProposalsTestUtils.maxPerBatch + 5 },
      () => SAMPLE,
    );
    const batch = createBatch("conv1", 3, over);
    assert.equal(
      batch.proposals.length,
      annotationProposalsTestUtils.maxPerBatch,
    );
  });

  it("appends to an existing batch for the same assistant message", function () {
    createBatch("conv1", 3, [SAMPLE]);
    addProposals("conv1", 3, [SAMPLE, SAMPLE]);
    const batch = getBatchForConversation("conv1");
    assert.equal(batch?.proposals.length, 3);
  });

  it("replaces the batch when the assistant message index changes", function () {
    createBatch("conv1", 3, [SAMPLE]);
    addProposals("conv1", 4, [SAMPLE, SAMPLE]);
    const batch = getBatchForConversation("conv1");
    assert.equal(batch?.assistantMessageIndex, 4);
    assert.equal(batch?.proposals.length, 2);
  });

  it("marks proposals accepted individually", function () {
    const batch = createBatch("conv1", 3, [SAMPLE, SAMPLE]);
    setProposalStatus("conv1", batch.proposals[0].id, "accepted");
    const summary = summarizeBatch(
      getBatchForConversation("conv1") as ReturnType<
        typeof getBatchForConversation
      > &
        object,
    );
    assert.equal(summary.accepted, 1);
    assert.equal(summary.pending, 1);
  });

  it("accepts or rejects all pending only", function () {
    const batch = createBatch("conv1", 3, [SAMPLE, SAMPLE, SAMPLE]);
    setProposalStatus("conv1", batch.proposals[0].id, "rejected");
    const accepted = acceptAllPending("conv1");
    assert.equal(accepted.length, 2);
    assert.isFalse(hasPendingBatch("conv1"));

    const batch2 = createBatch("conv1", 4, [SAMPLE, SAMPLE]);
    setProposalStatus("conv1", batch2.proposals[0].id, "failed", "bad");
    const rejected = rejectAllPending("conv1");
    assert.equal(rejected.length, 1);
  });

  it("clears batches", function () {
    createBatch("conv1", 3, [SAMPLE]);
    assert.isTrue(clearBatch("conv1"));
    assert.isFalse(hasPendingBatch("conv1"));
    assert.isNull(getBatchForConversation("conv1"));
  });

  it("keeps error messages when status is failed", function () {
    const batch = createBatch("conv1", 3, [SAMPLE]);
    setProposalStatus("conv1", batch.proposals[0].id, "failed", "boom");
    const updated = getBatchForConversation("conv1");
    assert.equal(updated?.proposals[0].errorMessage, "boom");
  });
});
