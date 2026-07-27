from __future__ import annotations

import json
import os
import shutil
import tempfile
import threading
import uuid
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .pipeline import SeferAnalysisPipeline
from .providers.surya_provider import SuryaProvider
from .rendering import render_pdf

MAX_PDF_BYTES = int(os.getenv("MAX_PDF_BYTES", str(500 * 1024 * 1024)))
API_KEY = os.getenv("ANALYSIS_API_KEY", "")
ALLOWED_ORIGINS = [
    value.strip()
    for value in os.getenv(
        "ALLOWED_ORIGINS",
        "https://j8017246-del.github.io,http://127.0.0.1:8765,http://localhost:8765",
    ).split(",")
    if value.strip()
]
DATA_DIR = Path(os.getenv("ANALYSIS_DATA_DIR", tempfile.gettempdir())) / "sefer-analysis"
DATA_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Sefer Learning Calendar Private Analyzer", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type", "X-Analysis-Key"],
)

jobs: dict[str, dict[str, Any]] = {}
jobs_lock = threading.Lock()


def require_key(value: str | None) -> None:
    if API_KEY and value != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid analysis credential")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "engine": "private-cloud", "ocr": "surya-2"}


@app.post("/v1/jobs", status_code=202)
async def create_job(
    background_tasks: BackgroundTasks,
    pdf: UploadFile = File(...),
    x_analysis_key: str | None = Header(default=None),
) -> dict[str, Any]:
    require_key(x_analysis_key)
    if pdf.content_type not in {"application/pdf", "application/octet-stream"}:
        raise HTTPException(status_code=415, detail="Only PDF files are accepted")
    job_id = uuid.uuid4().hex
    job_dir = DATA_DIR / job_id
    job_dir.mkdir(mode=0o700)
    pdf_path = job_dir / "source.pdf"
    size = 0
    with pdf_path.open("wb") as destination:
        while chunk := await pdf.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_PDF_BYTES:
                destination.close()
                shutil.rmtree(job_dir, ignore_errors=True)
                raise HTTPException(status_code=413, detail="PDF exceeds the configured limit")
            destination.write(chunk)
    pdf_path.chmod(0o600)
    with jobs_lock:
        jobs[job_id] = {
            "id": job_id,
            "status": "queued",
            "stage": "secure-upload",
            "progress": 0.02,
            "filename": pdf.filename,
        }
    background_tasks.add_task(run_job, job_id, pdf_path)
    return {"job_id": job_id, "status_url": f"/v1/jobs/{job_id}"}


@app.get("/v1/jobs/{job_id}")
def get_job(job_id: str, x_analysis_key: str | None = Header(default=None)) -> dict[str, Any]:
    require_key(x_analysis_key)
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Unknown analysis job")
        return dict(job)


@app.get("/v1/jobs/{job_id}/result")
def get_result(job_id: str, x_analysis_key: str | None = Header(default=None)) -> dict[str, Any]:
    require_key(x_analysis_key)
    with jobs_lock:
        job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Unknown analysis job")
    if job["status"] != "complete":
        raise HTTPException(status_code=409, detail="Analysis is not complete")
    result_path = DATA_DIR / job_id / "result.json"
    return json.loads(result_path.read_text(encoding="utf-8"))


@app.delete("/v1/jobs/{job_id}", status_code=204)
def delete_job(job_id: str, x_analysis_key: str | None = Header(default=None)) -> None:
    require_key(x_analysis_key)
    with jobs_lock:
        jobs.pop(job_id, None)
    shutil.rmtree(DATA_DIR / job_id, ignore_errors=True)


def set_job(job_id: str, **changes: Any) -> None:
    with jobs_lock:
        if job_id in jobs:
            jobs[job_id].update(changes)


def run_job(job_id: str, pdf_path: Path) -> None:
    try:
        set_job(job_id, status="processing", stage="scan-restoration", progress=0.08)
        images = render_pdf(pdf_path)
        set_job(job_id, stage="layout-and-hebrew-ocr", progress=0.28, page_count=len(images))
        pipeline = SeferAnalysisPipeline(SuryaProvider())
        result = pipeline.analyze_images(images)
        set_job(job_id, stage="document-structure", progress=0.78)
        result_path = pdf_path.parent / "result.json"
        result_path.write_text(
            json.dumps(result.to_dict(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        # The raw PDF is deliberately removed when analysis completes.
        pdf_path.unlink(missing_ok=True)
        set_job(
            job_id,
            status="complete",
            stage="complete",
            progress=1.0,
            confidence=result.confidence,
            review_pages=len(result.review_pages),
            stream_count=len(result.streams),
        )
    except Exception as exc:
        set_job(job_id, status="failed", stage="failed", error=str(exc))
        pdf_path.unlink(missing_ok=True)

