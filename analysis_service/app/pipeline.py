from __future__ import annotations

from statistics import mean
from typing import Protocol

from .domain import DocumentResult, PageRecord
from .streams import discover_streams
from .structure import classify_pages, extract_document_title
from .units import extract_units


class OCRProvider(Protocol):
    name: str

    def analyze(self, images: list[object]) -> list[PageRecord]:
        ...


class SeferAnalysisPipeline:
    def __init__(self, provider: OCRProvider, engine_version: str = "1.0.0") -> None:
        self.provider = provider
        self.engine_version = engine_version

    def analyze_images(self, images: list[object]) -> DocumentResult:
        pages = self.provider.analyze(images)
        title = extract_document_title(pages)
        classify_pages(pages, title)
        streams = discover_streams(pages)
        units = extract_units(pages, streams)
        learnable_pages = [page.page for page in pages if page.page_type == "learning"]
        review_pages = sorted({
            page.page
            for page in pages
            if page.needs_review
        } | {
            block.page
            for page in pages
            for block in page.blocks
            if (
                block.role == "unclassified"
                or block.role_confidence < 0.65
                or (block.role in {"main", "commentary"} and block.confidence < 0.62)
            )
        } | {
            page.page
            for page in pages
            if page.page_type == "learning"
            and not any(block.role == "main" for block in page.blocks)
        })
        confidences = [
            page.page_type_confidence
            for page in pages
            if page.page_type != "blank"
        ] + [
            stream.confidence for stream in streams
        ]
        confidence = mean(confidences) if confidences else 0.0
        warnings: list[str] = []
        if not streams:
            warnings.append("No schedulable learning streams were detected.")
        if not any(stream.kind == "main" for stream in streams):
            warnings.append("The analyzer did not establish a main-text stream.")
        if review_pages:
            warnings.append(
                f"{len(review_pages)} page(s) remain below the automatic-certification threshold."
            )
        return DocumentResult(
            schema_version=1,
            engine={
                "name": "sefer-private-cloud",
                "version": self.engine_version,
                "ocr_provider": self.provider.name,
                "analysis_policy": "precision-gated",
            },
            title=title,
            page_count=len(pages),
            pages=pages,
            streams=streams,
            units=units,
            learnable_pages=learnable_pages,
            review_pages=review_pages,
            confidence=round(confidence, 3),
            warnings=warnings,
        )
