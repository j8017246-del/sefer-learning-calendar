from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(frozen=True)
class Box:
    x: float
    y: float
    width: float
    height: float

    @property
    def right(self) -> float:
        return self.x + self.width

    @property
    def bottom(self) -> float:
        return self.y + self.height

    @property
    def center_x(self) -> float:
        return self.x + self.width / 2

    @property
    def area(self) -> float:
        return self.width * self.height


@dataclass
class OCRBlock:
    id: str
    page: int
    box: Box
    text: str
    confidence: float
    layout_label: str = "Text"
    reading_order: int = 0
    line_count: int = 1
    estimated_line_height: float = 0.02
    role: str = "unclassified"
    stream_id: str | None = None
    stream_name: str | None = None
    role_confidence: float = 0.0
    reasons: list[str] = field(default_factory=list)


@dataclass
class PageRecord:
    page: int
    width: int
    height: int
    blocks: list[OCRBlock]
    image_quality: dict[str, float] = field(default_factory=dict)
    page_type: str = "unclassified"
    page_type_confidence: float = 0.0
    page_type_scores: dict[str, float] = field(default_factory=dict)
    reasons: list[str] = field(default_factory=list)
    needs_review: bool = False


@dataclass
class LearningStream:
    id: str
    name: str
    kind: str
    confidence: float
    pages: list[int]
    block_ids: list[str]
    reasons: list[str] = field(default_factory=list)


@dataclass
class LearningUnit:
    id: str
    stream_id: str
    page: int
    start: dict[str, float | int]
    end: dict[str, float | int]
    text: str
    weight: float
    boundary_score: float
    boundary_kind: str
    confidence: float


@dataclass
class DocumentResult:
    schema_version: int
    engine: dict[str, Any]
    title: str
    page_count: int
    pages: list[PageRecord]
    streams: list[LearningStream]
    units: list[LearningUnit]
    learnable_pages: list[int]
    review_pages: list[int]
    confidence: float
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

