"""Local browser-test double for the private analysis API.

This file never performs OCR and is not used by production. It verifies the
static website's upload, polling, result conversion, stream selection, and
review-gating workflow without downloading model weights.
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def block(block_id, page, stream_id, stream_name, text, x, role):
    return {
        "id": block_id,
        "page": page,
        "box": {"x": x, "y": 0.16, "width": 0.24 if role == "commentary" else 0.32, "height": 0.62},
        "text": text,
        "confidence": 0.94,
        "layout_label": "Text",
        "reading_order": 1,
        "line_count": 5,
        "estimated_line_height": 0.024,
        "role": role,
        "stream_id": stream_id,
        "stream_name": stream_name,
        "role_confidence": 0.92,
        "reasons": ["browser integration fixture"],
    }


def page(number, page_type, blocks, confidence=0.92, review=False):
    return {
        "page": number,
        "width": 1000,
        "height": 1400,
        "blocks": blocks,
        "image_quality": {"contrast": 0.71},
        "page_type": page_type,
        "page_type_confidence": confidence,
        "page_type_scores": {page_type: 8.0},
        "reasons": [f"recognized {page_type} fixture"],
        "needs_review": review,
    }


RESULT = {
    "schema_version": 1,
    "engine": {
        "name": "sefer-private-cloud",
        "version": "test",
        "ocr_provider": "fixture",
        "analysis_policy": "precision-gated",
    },
    "title": "ספר בדיקה",
    "page_count": 6,
    "pages": [
        page(1, "title", []),
        page(2, "approbation", []),
        page(3, "introduction", []),
        page(4, "learning", [
            block("m4", 4, "main", "Main text", "פרק ראשון", 0.34, "main"),
            block("r4", 4, "commentary-1", "רש״י", "רש״י ד״ה", 0.05, "commentary"),
            block("t4", 4, "commentary-2", "תוספות", "תוספות ד״ה", 0.72, "commentary"),
        ]),
        page(5, "learning", [
            block("m5", 5, "main", "Main text", "פרק שני", 0.34, "main"),
            block("r5", 5, "commentary-1", "רש״י", "המשך הפירוש", 0.05, "commentary"),
            block("t5", 5, "commentary-2", "תוספות", "המשך הביאור", 0.72, "commentary"),
        ], confidence=0.7, review=True),
        page(6, "contents", []),
    ],
    "streams": [
        {"id": "main", "name": "Main text", "kind": "main", "confidence": 0.94, "pages": [4, 5], "block_ids": ["m4", "m5"], "reasons": ["2 regions linked"]},
        {"id": "commentary-1", "name": "רש״י", "kind": "commentary", "confidence": 0.92, "pages": [4, 5], "block_ids": ["r4", "r5"], "reasons": ["named by heading"]},
        {"id": "commentary-2", "name": "תוספות", "kind": "commentary", "confidence": 0.91, "pages": [4, 5], "block_ids": ["t4", "t5"], "reasons": ["named by heading"]},
    ],
    "units": [
        {
            "id": f"{stream}:{page_number}",
            "stream_id": stream,
            "page": page_number,
            "start": {"page": page_number, "x": 0.8, "y": 0.16},
            "end": {"page": page_number, "x": 0.2, "y": 0.78},
            "text": "fixture learning unit",
            "weight": 1.0,
            "boundary_score": 0.9,
            "boundary_kind": "numbered section",
            "confidence": 0.9,
        }
        for stream in ("main", "commentary-1", "commentary-2")
        for page_number in (4, 5)
    ],
    "learnable_pages": [4, 5],
    "review_pages": [5],
    "confidence": 0.91,
    "warnings": ["1 page remains below the automatic-certification threshold."],
}


class Handler(BaseHTTPRequestHandler):
    reads = 0

    def _headers(self, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
        self.end_headers()

    def do_OPTIONS(self):
        self._headers(204)

    def do_GET(self):
        if self.path == "/health":
            return self._json({"status": "ok", "engine": "private-cloud", "ocr": "fixture"})
        if self.path == "/v1/jobs/job-test/result":
            return self._json(RESULT)
        if self.path == "/v1/jobs/job-test":
            Handler.reads += 1
            if Handler.reads == 1:
                return self._json({"id": "job-test", "status": "processing", "stage": "layout-and-hebrew-ocr", "progress": 0.55, "page_count": 6})
            return self._json({"id": "job-test", "status": "complete", "stage": "complete", "progress": 1, "page_count": 6})
        self._json({"detail": "not found"}, 404)

    def do_POST(self):
        size = int(self.headers.get("Content-Length", "0"))
        self.rfile.read(size)
        self._json({"job_id": "job-test", "status_url": "/v1/jobs/job-test"}, 202)

    def do_DELETE(self):
        self._headers(204)

    def _json(self, payload, status=200):
        self._headers(status)
        self.wfile.write(json.dumps(payload, ensure_ascii=False).encode())

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8766), Handler).serve_forever()
