import { assert } from "chai";
import { pdfReaderTestUtils } from "../src/modules/tools/pdfReader";
import { pdfAnnotationsTestUtils } from "../src/modules/tools/pdfAnnotations";

function makePage(
  pageIndex: number,
  pageHeight: number,
  spans: {
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[],
) {
  return {
    pageIndex,
    pageLabel: String(pageIndex + 1),
    pageWidth: 600,
    pageHeight,
    text: spans.map((s) => s.text).join(" "),
    spans,
  };
}

describe("pdf tools logic", function () {
  describe("pdf reader fuzzy matching", function () {
    it("normalizes whitespace before indexing", function () {
      const page = makePage(0, 800, [
        { text: "Hello   world", x: 0, y: 0, width: 100, height: 10 },
      ]);
      const { normalizedText } = pdfReaderTestUtils.buildNormalizedIndex(
        page.spans,
      );
      assert.equal(normalizedText, "hello world");
    });

    it("matches across adjacent spans", function () {
      const page = makePage(2, 800, [
        { text: "the quick ", x: 0, y: 100, width: 100, height: 12 },
        { text: "brown fox", x: 100, y: 100, width: 80, height: 12 },
      ]);
      const match = pdfReaderTestUtils.matchPage(page, "quick brown");
      assert.isNotNull(match);
      assert.equal(match?.pageIndex, 2);
      assert.equal(match?.rects.length, 1);
    });

    it("returns null when text is absent", function () {
      const page = makePage(0, 800, [
        { text: "alpha beta", x: 0, y: 0, width: 80, height: 10 },
      ]);
      const match = pdfReaderTestUtils.matchPage(page, "gamma delta");
      assert.isNull(match);
    });

    it("reorders search candidates by distance to target page", function () {
      const pages = [0, 1, 2, 3, 4].map((index) =>
        makePage(index, 800, [
          {
            text: `page${index}`,
            x: 0,
            y: 0,
            width: 50,
            height: 10,
          },
        ]),
      );
      const order = pdfReaderTestUtils
        .buildSearchOrder(pages, 2)
        .map((page) => page.pageIndex);
      assert.deepEqual(order, [2, 1, 3, 0, 4]);
    });

    it("merges rects on the same visual line", function () {
      const spans = [
        { text: "abc", x: 10, y: 200, width: 15, height: 10 },
        { text: "def", x: 25, y: 200, width: 15, height: 10 },
      ];
      const rects = pdfReaderTestUtils.mergeSpanRects(spans, 800);
      assert.equal(rects.length, 1);
      assert.deepEqual(rects[0], [10, 590, 40, 600]);
    });
  });

  describe("pdf annotation json builder", function () {
    it("normalizes color input", function () {
      assert.equal(
        pdfAnnotationsTestUtils.normalizeColor("#ff0000"),
        "#ff0000",
      );
      assert.equal(pdfAnnotationsTestUtils.normalizeColor("ff0000"), "#ff0000");
      assert.equal(
        pdfAnnotationsTestUtils.normalizeColor("not-a-color"),
        "#ffd400",
      );
      assert.equal(
        pdfAnnotationsTestUtils.normalizeColor(undefined),
        "#ffd400",
      );
    });

    it("builds a sort index matching Zotero's PPPPP|YYYYYY|XXXXX format", function () {
      const sortIndex = pdfAnnotationsTestUtils.buildSortIndex(
        3,
        [
          [10, 100, 200, 120],
          [10, 80, 200, 100],
        ],
        800,
      );
      // Zotero validates sortIndex against /^\d{5}\|\d{6,7}\|\d{5}$/
      assert.match(sortIndex, /^\d{5}\|\d{6,7}\|\d{5}$/);
      const parts = sortIndex.split("|");
      assert.equal(parts[0], "00003");
      assert.equal(parts[0].length, 5);
      assert.equal(parts[1].length, 6);
      assert.equal(parts[2].length, 5);
      // distance-from-top = pageHeight (800) - max y2 (120) = 680
      assert.equal(parts[1], "000680");
      // leftmost x = 10
      assert.equal(parts[2], "00010");
    });

    it("falls back to a default page height when none is provided", function () {
      const sortIndex = pdfAnnotationsTestUtils.buildSortIndex(0, [
        [0, 0, 10, 10],
      ]);
      assert.match(sortIndex, /^\d{5}\|\d{6,7}\|\d{5}$/);
    });
  });
});
