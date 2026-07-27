const assert = require("assert");

global.window = global;
require("../private-analysis-client.js");

const calls = [];
let statusReads = 0;
const fakeFetch = async (url, options = {}) => {
  calls.push({ url, method: options.method || "GET" });
  if (url.endsWith("/v1/jobs") && options.method === "POST") {
    assert(options.body instanceof FormData);
    return response(202, { job_id: "job-1" });
  }
  if (url.endsWith("/v1/jobs/job-1/result")) {
    return response(200, { schema_version: 1, page_count: 12 });
  }
  if (url.endsWith("/v1/jobs/job-1")) {
    statusReads += 1;
    return response(200, statusReads === 1
      ? { id: "job-1", status: "processing", stage: "layout-and-hebrew-ocr", progress: 0.5 }
      : { id: "job-1", status: "complete", stage: "complete", progress: 1 });
  }
  if (url.endsWith("/health")) {
    return response(200, { status: "ok", engine: "private-cloud" });
  }
  return response(404, { detail: "not found" });
};

function response(status, payload) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

(async () => {
  const client = new PrivateSeferAnalysisClient({
    baseUrl: "https://private.example.test/",
    fetchImpl: fakeFetch,
    pollInterval: 1,
  });
  assert.equal((await client.health()).status, "ok");
  const pdf = new Blob(["%PDF fixture"], { type: "application/pdf" });
  Object.defineProperty(pdf, "name", { value: "fixture.pdf" });
  const progress = [];
  const { result } = await client.analyze(pdf, {
    onProgress: (job) => progress.push(job.progress),
  });
  assert.equal(result.page_count, 12);
  assert.deepEqual(progress, [0.5, 1]);
  assert(calls.some((call) => call.method === "POST"));
  console.log("private analysis client contract passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
