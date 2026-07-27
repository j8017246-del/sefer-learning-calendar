from __future__ import annotations

from collections import defaultdict
from statistics import median

from .domain import LearningStream, OCRBlock, PageRecord
from .hebrew import COMMENTARY_WORDS, commentary_name, contains_cue, normalize_hebrew


def _block_size(block: OCRBlock) -> float:
    return max(0.001, block.estimated_line_height)


def _main_score(block: OCRBlock, median_height: float) -> float:
    centrality = 1 - min(1.0, abs(block.box.center_x - 0.5) * 2)
    size = min(2.0, _block_size(block) / max(0.001, median_height))
    width = min(1.5, block.box.width * 1.8)
    area = min(1.0, block.box.area * 3)
    label = 0.4 if block.layout_label.lower() == "text" else 0.0
    explicit_commentary = 2.5 if commentary_name(block.text) else 0.0
    return centrality * 1.5 + size + width + area + label - explicit_commentary


def _geometry_key(block: OCRBlock) -> tuple[int, int, int]:
    return (
        round(block.box.center_x * 5),
        round(block.box.width * 5),
        round(block.estimated_line_height * 70),
    )


def _prototype(blocks: list[OCRBlock]) -> tuple[float, float, float]:
    return (
        median(block.box.center_x for block in blocks),
        median(block.box.width for block in blocks),
        median(_block_size(block) for block in blocks),
    )


def _prototype_distance(block: OCRBlock, prototype: tuple[float, float, float]) -> float:
    center, width, size = prototype
    return (
        abs(block.box.center_x - center) * 3.2
        + abs(block.box.width - width) * 2.0
        + abs(_block_size(block) - size) / max(0.008, size) * 0.45
    )


def discover_streams(pages: list[PageRecord]) -> list[LearningStream]:
    learning_pages = [page for page in pages if page.page_type == "learning"]
    blocks = [
        block
        for page in learning_pages
        for block in page.blocks
        if block.layout_label.lower() not in {
            "pageheader", "pagefooter", "picture", "figure", "table", "form"
        } and block.text.strip()
    ]
    if not blocks:
        return []

    heights = [_block_size(block) for block in blocks]
    median_height = median(heights)
    named_groups: dict[str, list[OCRBlock]] = defaultdict(list)
    unnamed_commentary: list[OCRBlock] = []
    main_blocks: list[OCRBlock] = []

    by_page: dict[int, list[OCRBlock]] = defaultdict(list)
    for block in blocks:
        by_page[block.page].append(block)

    for page_number, page_blocks in by_page.items():
        ranked = sorted(page_blocks, key=lambda block: _main_score(block, median_height), reverse=True)
        primary = ranked[0]
        primary.role = "main"
        primary.stream_id = "main"
        primary.stream_name = "Main text"
        primary.role_confidence = min(0.97, 0.62 + max(0, _main_score(primary, median_height)) * 0.06)
        primary.reasons.append("strongest main-text score on this page")
        main_blocks.append(primary)

        for block in page_blocks:
            if block is primary:
                continue
            name = commentary_name(block.text)
            explicit_word = any(contains_cue(block.text, cue) for cue in COMMENTARY_WORDS)
            smaller = _block_size(block) < _block_size(primary) * 0.88
            side_or_bottom = block.box.center_x < 0.3 or block.box.center_x > 0.7 or block.box.y > 0.72
            if name or explicit_word or smaller or side_or_bottom:
                block.role = "commentary"
                block.role_confidence = 0.92 if name else 0.78 if explicit_word else 0.68
                block.reasons.append(
                    "explicit commentary heading" if name or explicit_word
                    else "smaller or peripheral recurring text region"
                )
                if name:
                    named_groups[name].append(block)
                else:
                    unnamed_commentary.append(block)
            else:
                block.role = "main"
                block.stream_id = "main"
                block.stream_name = "Main text"
                block.role_confidence = 0.58
                block.reasons.append("main-text continuation with similar typography")
                main_blocks.append(block)

    # A commentary heading may be present on only some pages. Link unnamed
    # continuation blocks to document-wide named prototypes before falling
    # back to geometry-only anonymous streams.
    still_unnamed: list[OCRBlock] = []
    named_prototypes = {
        name: _prototype(group)
        for name, group in named_groups.items()
        if group
    }
    for block in unnamed_commentary:
        ranked_names = sorted(
            (
                (_prototype_distance(block, prototype), name)
                for name, prototype in named_prototypes.items()
            ),
            key=lambda item: item[0],
        )
        if ranked_names and ranked_names[0][0] <= 0.78:
            distance, name = ranked_names[0]
            named_groups[name].append(block)
            block.role_confidence = max(block.role_confidence, 0.71)
            block.reasons.append(
                f"linked to recurring {name} typography and page position"
            )
        else:
            still_unnamed.append(block)

    geometry_groups: dict[tuple[int, int, int], list[OCRBlock]] = defaultdict(list)
    for block in still_unnamed:
        geometry_groups[_geometry_key(block)].append(block)

    commentary_groups: list[tuple[str, list[OCRBlock]]] = list(named_groups.items())
    unidentified_index = 1
    for group in geometry_groups.values():
        if not group:
            continue
        name = f"Commentary {unidentified_index}"
        unidentified_index += 1
        commentary_groups.append((name, group))

    streams: list[LearningStream] = []
    if main_blocks:
        streams.append(_make_stream("main", "Main text", "main", main_blocks))
    for index, (name, group) in enumerate(commentary_groups, start=1):
        stream_id = f"commentary-{index}"
        for block in group:
            block.stream_id = stream_id
            block.stream_name = name
        streams.append(_make_stream(stream_id, name, "commentary", group))
    return streams


def _make_stream(stream_id: str, name: str, kind: str, blocks: list[OCRBlock]) -> LearningStream:
    pages = sorted({block.page for block in blocks})
    confidence = sum(block.role_confidence for block in blocks) / max(1, len(blocks))
    return LearningStream(
        id=stream_id,
        name=name,
        kind=kind,
        confidence=round(confidence, 3),
        pages=pages,
        block_ids=[block.id for block in blocks],
        reasons=[
            f"{len(blocks)} region(s) linked across {len(pages)} page(s)",
            "named by recognized heading" if not name.startswith("Commentary ") else "clustered by recurring geometry",
        ],
    )
