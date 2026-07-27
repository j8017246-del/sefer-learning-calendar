from __future__ import annotations

import re

from .domain import LearningStream, LearningUnit, PageRecord
from .hebrew import BOUNDARY_CUES, contains_cue, normalize_hebrew

SENTENCE_END = re.compile(r"[.׃:!?]\s*$")


def extract_units(pages: list[PageRecord], streams: list[LearningStream]) -> list[LearningUnit]:
    stream_ids = {stream.id for stream in streams}
    units: list[LearningUnit] = []
    for page in pages:
        if page.page_type != "learning":
            continue
        blocks = sorted(page.blocks, key=lambda block: block.reading_order)
        for block in blocks:
            if block.stream_id not in stream_ids or not block.text.strip():
                continue
            paragraphs = [part.strip() for part in re.split(r"\n{2,}", block.text) if part.strip()]
            if not paragraphs:
                paragraphs = [block.text.strip()]
            for index, paragraph in enumerate(paragraphs):
                boundary_score, boundary_kind = _boundary(paragraph, block.layout_label)
                start_y = block.box.y + block.box.height * index / len(paragraphs)
                end_y = block.box.y + block.box.height * (index + 1) / len(paragraphs)
                word_count = max(1, len(normalize_hebrew(paragraph).split()))
                units.append(
                    LearningUnit(
                        id=f"{block.stream_id}:{page.page}:{block.id}:{index + 1}",
                        stream_id=block.stream_id,
                        page=page.page,
                        start={"page": page.page, "x": block.box.right, "y": start_y},
                        end={"page": page.page, "x": block.box.x, "y": end_y},
                        text=paragraph,
                        weight=round(max(0.5, word_count / 18), 3),
                        boundary_score=boundary_score,
                        boundary_kind=boundary_kind,
                        confidence=round(min(block.confidence, block.role_confidence), 3),
                    )
                )
    return units


def _boundary(text: str, layout_label: str) -> tuple[float, str]:
    if layout_label.lower() in {"sectionheader", "title"}:
        return 0.95, "section heading"
    hits = [cue for cue in BOUNDARY_CUES if contains_cue(text, cue)]
    if hits:
        if any(cue in {"סליק", "הדרן עלך", "תם ונשלם", "סוף פרק", "סוף סימן"} for cue in hits):
            return 1.0, "major completion"
        return 0.9, "numbered or named section"
    if SENTENCE_END.search(text):
        return 0.72, "sentence or paragraph ending"
    return 0.48, "visual paragraph ending"

