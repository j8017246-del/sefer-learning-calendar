(function (global) {
  "use strict";

  const trimSlash = (value) => String(value || "").trim().replace(/\/+$/, "");
  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  class PrivateAnalysisError extends Error {
    constructor(message, status, detail) {
      super(message);
      this.name = "PrivateAnalysisError";
      this.status = status || 0;
      this.detail = detail || "";
    }
  }

  class PrivateSeferAnalysisClient {
    constructor(options) {
      const config = options || {};
      this.baseUrl = trimSlash(config.baseUrl);
      this.fetchImpl = config.fetchImpl || global.fetch.bind(global);
      this.pollInterval = config.pollInterval || 1600;
    }

    setBaseUrl(value) {
      this.baseUrl = trimSlash(value);
    }

    requireUrl() {
      if (!this.baseUrl) {
        throw new PrivateAnalysisError(
          "The private analysis service is not connected. Add its HTTPS address first."
        );
      }
    }

    async request(path, options) {
      this.requireUrl();
      const response = await this.fetchImpl(this.baseUrl + path, options || {});
      if (response.ok) {
        if (response.status === 204) return null;
        return response.json();
      }
      let detail = "";
      try {
        const payload = await response.json();
        detail = payload.detail || payload.error || "";
      } catch (_) {
        detail = await response.text();
      }
      throw new PrivateAnalysisError(
        detail || `Private analysis request failed (${response.status}).`,
        response.status,
        detail
      );
    }

    health() {
      return this.request("/health");
    }

    async createJob(file) {
      const form = new FormData();
      form.append("pdf", file, file.name || "sefer.pdf");
      return this.request("/v1/jobs", { method: "POST", body: form });
    }

    getJob(jobId) {
      return this.request(`/v1/jobs/${encodeURIComponent(jobId)}`);
    }

    getResult(jobId) {
      return this.request(`/v1/jobs/${encodeURIComponent(jobId)}/result`);
    }

    deleteJob(jobId) {
      return this.request(`/v1/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
    }

    async analyze(file, options) {
      const config = options || {};
      const created = await this.createJob(file);
      const jobId = created.job_id;
      if (config.onJob) config.onJob(jobId);
      for (;;) {
        if (config.isCancelled && config.isCancelled()) {
          await this.deleteJob(jobId).catch(() => {});
          throw new PrivateAnalysisError("Analysis paused by the learner.");
        }
        const job = await this.getJob(jobId);
        if (config.onProgress) config.onProgress(job);
        if (job.status === "complete") {
          const result = await this.getResult(jobId);
          return { job, result };
        }
        if (job.status === "failed") {
          throw new PrivateAnalysisError(job.error || "The private analysis job failed.");
        }
        await wait(config.pollInterval || this.pollInterval);
      }
    }
  }

  global.PrivateAnalysisError = PrivateAnalysisError;
  global.PrivateSeferAnalysisClient = PrivateSeferAnalysisClient;
})(window);
