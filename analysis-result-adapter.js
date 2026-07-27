(function (global) {
  "use strict";

  const mapPageType = (value) => ({
    contents: "index",
    preface: "introduction",
    main: "learning",
    back_matter: "other",
  }[value] || value || "other");

  const roleType = (block) => {
    if (block.stream_id === "main" || block.role === "main") return "main";
    if (block.role === "commentary" || String(block.stream_id || "").startsWith("commentary-")) {
      return "commentary";
    }
    const label = String(block.layout_label || "").toLowerCase();
    if (label.includes("title") || label.includes("header")) return "heading";
    if (label.includes("foot") || label.includes("caption")) return "footnote";
    return "excluded";
  };

  const toBrowserAnalysis = (result, now) => {
    const timestamp = now || new Date().toISOString();
    const review = new Set(result.review_pages || []);
    const pages = {};
    for (const source of result.pages || []) {
      const pageType = mapPageType(source.page_type);
      const confidence = Math.round((source.page_type_confidence || 0) * 100);
      const needsReview = Boolean(source.needs_review) || review.has(source.page);
      const regions = (source.blocks || []).map((block, index) => {
        const box = block.box || {};
        const type = roleType(block);
        const lineCount = Math.max(1, block.line_count || 1);
        const lines = [];
        for (let line = 0; line < lineCount; line += 1) {
          const height = (box.height || 0.02) / lineCount;
          lines.push({
            id: `${block.id}:line:${line + 1}`,
            x: box.x || 0,
            y: (box.y || 0) + height * line,
            w: box.width || 0.1,
            h: height,
            order: line + 1,
            weight: Math.max(
              0.5,
              String(block.text || "").split(/\s+/).filter(Boolean).length / lineCount
            ),
          });
        }
        return {
          id: block.id || `page-${source.page}-region-${index + 1}`,
          type,
          included: type === "main" || type === "commentary",
          order: Number.isInteger(block.reading_order) ? block.reading_order + 1 : index + 1,
          x: box.x || 0,
          y: box.y || 0,
          w: box.width || 0.1,
          h: box.height || 0.02,
          confidence: Math.round((block.confidence || 0) * 100),
          roleConfidence: Math.round((block.role_confidence || 0) * 100),
          text: block.text || "",
          streamId: block.stream_id || null,
          streamName: block.stream_name || null,
          layoutLabel: block.layout_label || "Text",
          reasons: block.reasons || [],
          lines,
        };
      });
      pages[source.page] = {
        page: source.page,
        pageType,
        pageTypeConfidence: confidence,
        pageTypeReason: (source.reasons || []).join(" · ") || "Private document classifier",
        approved: pageType === "learning" && !needsReview,
        status: needsReview ? "review" : pageType === "learning" ? "automatic" : "excluded",
        needsReview,
        reviewResolved: false,
        ocrStatus: "Private Hebrew/Aramaic OCR",
        error: "",
        imageQuality: source.image_quality || {},
        regions,
        analyzedAt: timestamp,
      };
    }
    return {
      version: 3,
      pages,
      lastRun: timestamp,
      documentStatus: "complete",
      engine: result.engine || {},
      title: result.title || "",
      documentConfidence: result.confidence || 0,
      warnings: result.warnings || [],
      reviewPages: result.review_pages || [],
      discoveredStreams: result.streams || [],
      cloudUnits: result.units || [],
      learnablePages: result.learnable_pages || [],
    };
  };

  global.SeferAnalysisResultAdapter = { mapPageType, roleType, toBrowserAnalysis };
})(window);
