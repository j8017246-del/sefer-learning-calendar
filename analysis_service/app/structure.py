from __future__ import annotations

from collections import Counter

from .domain import PageRecord
from .hebrew import cue_hits, normalize_hebrew

PAGE_TYPES = ("title", "approbation", "introduction", "contents", "learning", "appendix", "blank", "other")


def _softmax_confidence(scores: dict[str, float], winner: str) -> float:
    ordered = sorted(scores.values(), reverse=True)
    if not ordered:
        return 0.0
    margin = ordered[0] - (ordered[1] if len(ordered) > 1 else 0.0)
    return min(0.99, 0.5 + 0.11 * margin)


def _page_text(page: PageRecord) -> str:
    return "\n".join(block.text for block in page.blocks if block.text)


def extract_document_title(pages: list[PageRecord]) -> str:
    candidates: list[tuple[float, str]] = []
    for page in pages:
        for block in page.blocks:
            text = normalize_hebrew(block.text)
            words = text.split()
            if not 1 <= len(words) <= 14:
                continue
            top_bonus = max(0.0, 0.45 - block.box.y)
            label_bonus = 0.6 if block.layout_label.lower() in {"sectionheader", "title"} else 0.0
            size_proxy = min(1.2, block.estimated_line_height * 25)
            cue_bonus = 0.5 if "ספר" in words else 0.0
            score = label_bonus + size_proxy + top_bonus + cue_bonus - page.page * 0.015
            candidates.append((score, block.text.strip()))
    return max(candidates, default=(0.0, ""))[1]


def classify_pages(pages: list[PageRecord], title: str) -> None:
    total = max(1, len(pages))
    normalized_title = normalize_hebrew(title)
    for page in pages:
        text = _page_text(page)
        normalized = normalize_hebrew(text)
        text_blocks = [b for b in page.blocks if b.layout_label.lower() not in {"picture", "figure"}]
        ink_proxy = sum(block.box.area for block in text_blocks)
        scores = {kind: 0.0 for kind in PAGE_TYPES}
        reasons: dict[str, list[str]] = {kind: [] for kind in PAGE_TYPES}

        if not normalized or not text_blocks or ink_proxy < 0.012:
            scores["blank"] += 8
            reasons["blank"].append("almost no recognized printed text")
        else:
            scores["learning"] += 1.2
            if len(text_blocks) >= 2:
                scores["learning"] += 0.8
            if ink_proxy > 0.18:
                scores["learning"] += 1.0

        for page_type in ("approbation", "introduction", "contents", "appendix", "learning"):
            hits = cue_hits(text, page_type)
            if hits:
                scores[page_type] += 6.5 + min(3, len(hits) - 1)
                reasons[page_type].append("recognized " + ", ".join(hits[:3]))

        toc_blocks = sum(b.layout_label.lower() == "tableofcontents" for b in page.blocks)
        if toc_blocks:
            scores["contents"] += 7
            reasons["contents"].append("layout model identified a table of contents")

        section_headers = [b for b in page.blocks if b.layout_label.lower() in {"sectionheader", "title"}]
        sparse_title_layout = len(text_blocks) <= 5 and ink_proxy < 0.16 and bool(section_headers)
        if sparse_title_layout:
            scores["title"] += 4.5
            reasons["title"].append("large sparse heading layout")
        if normalized_title and normalize_hebrew(title) in normalized:
            scores["title"] += 4
            reasons["title"].append("document title appears prominently")

        # Position is deliberately weak: language and layout evidence dominate.
        relative = page.page / total
        if relative <= 0.08:
            scores["title"] += 0.7
            scores["approbation"] += 0.4
            scores["introduction"] += 0.4
        if relative >= 0.9:
            scores["appendix"] += 0.5
            scores["contents"] += 0.2

        if max(scores.values()) <= 1.3:
            scores["other"] += 1.5
            reasons["other"].append("no strong structural evidence")

        winner = max(scores, key=scores.get)
        confidence = _softmax_confidence(scores, winner)
        page.page_type = winner
        page.page_type_confidence = confidence
        page.page_type_scores = {key: round(value, 3) for key, value in scores.items()}
        page.reasons = reasons[winner] or [f"{winner} received the strongest document-level score"]
        page.needs_review = confidence < 0.78 or winner == "other"

    _smooth_learning_runs(pages)


def _smooth_learning_runs(pages: list[PageRecord]) -> None:
    """Use neighboring agreement only to resolve weak pages, never to override strong cues."""
    for index, page in enumerate(pages):
        if page.page_type_confidence >= 0.78 or page.page_type in {"blank", "title"}:
            continue
        neighbors = pages[max(0, index - 2):index] + pages[index + 1:index + 3]
        strong = [p.page_type for p in neighbors if p.page_type_confidence >= 0.8]
        if len(strong) < 2:
            continue
        winner, count = Counter(strong).most_common(1)[0]
        if count >= 2 and winner == "learning":
            page.page_type = "learning"
            page.page_type_confidence = max(page.page_type_confidence, 0.73)
            page.reasons.append("surrounded by strongly classified learning pages")
            page.needs_review = True
