const assert = require("assert");

global.window = global;
require("../analysis-result-adapter.js");

const result = {
  engine: { name: "fixture" },
  title: "ספר בדיקה",
  confidence: 0.88,
  learnable_pages: [2, 3],
  review_pages: [3],
  warnings: ["one review page"],
  streams: [
    { id: "main", name: "Main text", kind: "main" },
    { id: "commentary-1", name: "רש״י", kind: "commentary" },
  ],
  units: [{ id: "u1", stream_id: "main", page: 2 }],
  pages: [
    {
      page: 1,
      page_type: "contents",
      page_type_confidence: 0.95,
      reasons: ["recognized תוכן"],
      blocks: [],
    },
    {
      page: 2,
      page_type: "learning",
      page_type_confidence: 0.91,
      reasons: ["sustained learning layout"],
      blocks: [
        {
          id: "m2",
          box: { x: 0.3, y: 0.1, width: 0.4, height: 0.7 },
          text: "פרק ראשון",
          confidence: 0.92,
          role_confidence: 0.9,
          role: "main",
          stream_id: "main",
          stream_name: "Main text",
          line_count: 4,
          reading_order: 0,
        },
        {
          id: "r2",
          box: { x: 0.04, y: 0.14, width: 0.22, height: 0.62 },
          text: "רש״י",
          confidence: 0.9,
          role_confidence: 0.92,
          role: "commentary",
          stream_id: "commentary-1",
          stream_name: "רש״י",
          line_count: 3,
          reading_order: 1,
        },
      ],
    },
    {
      page: 3,
      page_type: "learning",
      page_type_confidence: 0.7,
      needs_review: true,
      blocks: [],
    },
  ],
};

const analysis = SeferAnalysisResultAdapter.toBrowserAnalysis(
  result,
  "2026-07-26T00:00:00.000Z"
);
assert.equal(analysis.pages[1].pageType, "index");
assert.equal(analysis.pages[2].approved, true);
assert.equal(analysis.pages[3].approved, false);
assert.equal(analysis.pages[3].status, "review");
assert.equal(analysis.pages[2].regions[1].streamName, "רש״י");
assert.equal(analysis.pages[2].regions[1].type, "commentary");
assert.equal(analysis.pages[2].regions[1].order, 2);
assert.equal(analysis.discoveredStreams.length, 2);
assert.equal(analysis.cloudUnits.length, 1);
console.log("analysis result adapter passed");
