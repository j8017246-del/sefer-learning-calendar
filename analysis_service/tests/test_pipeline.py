from __future__ import annotations

import unittest

from app.domain import Box, OCRBlock, PageRecord
from app.pipeline import SeferAnalysisPipeline


def block(
    block_id: str,
    page: int,
    text: str,
    x: float,
    y: float,
    width: float,
    height: float,
    *,
    label: str = "Text",
    line_height: float = 0.03,
    confidence: float = 0.94,
) -> OCRBlock:
    return OCRBlock(
        id=block_id,
        page=page,
        box=Box(x, y, width, height),
        text=text,
        confidence=confidence,
        layout_label=label,
        reading_order=0,
        line_count=max(1, text.count("\n") + 1),
        estimated_line_height=line_height,
    )


class FixtureProvider:
    name = "fixture"

    def analyze(self, images: list[object]) -> list[PageRecord]:
        return [
            PageRecord(1, 1000, 1400, [
                block("t1", 1, "ספר אור ישראל", 0.2, 0.12, 0.6, 0.16, label="SectionHeader", line_height=0.09),
                block("t2", 1, "נדפס בירושלים", 0.33, 0.72, 0.34, 0.04),
            ]),
            PageRecord(2, 1000, 1400, [
                block("h1", 2, "הסכמת הרב הגאון", 0.18, 0.1, 0.64, 0.08, label="SectionHeader"),
                block("h2", 2, "ברכה והצלחה למחבר", 0.16, 0.22, 0.68, 0.5),
            ]),
            PageRecord(3, 1000, 1400, [
                block("i1", 3, "הקדמת המחבר", 0.25, 0.08, 0.5, 0.08, label="SectionHeader"),
                block("i2", 3, "אמר המחבר הנה מטרת הספר", 0.14, 0.2, 0.72, 0.6),
            ]),
            PageRecord(4, 1000, 1400, [
                block("m1", 4, "פרק ראשון\nאמר רב יהודה הלכה זו", 0.35, 0.12, 0.3, 0.65, line_height=0.045),
                block("r1", 4, 'רש"י ד"ה אמר רב', 0.05, 0.18, 0.24, 0.5, line_height=0.022),
                block("x1", 4, "תוספות ד\"ה הלכה", 0.71, 0.18, 0.24, 0.5, line_height=0.021),
            ]),
            PageRecord(5, 1000, 1400, [
                block("m2", 5, "פרק שני\nמשנה אחת ועוד משנה", 0.35, 0.1, 0.3, 0.68, line_height=0.046),
                block("r2", 5, 'פירוש רש"י והמשך הדברים', 0.05, 0.16, 0.24, 0.52, line_height=0.022),
                block("x2", 5, "תוספות ועוד ביאור", 0.71, 0.16, 0.24, 0.52, line_height=0.021),
            ]),
            PageRecord(6, 1000, 1400, [
                block("c1", 6, "תוכן העניינים", 0.25, 0.08, 0.5, 0.08, label="TableOfContents"),
                block("c2", 6, "פרק ראשון א\nפרק שני ב", 0.2, 0.2, 0.6, 0.55),
            ]),
        ]


class PipelineTests(unittest.TestCase):
    def test_classifies_document_and_discovers_multiple_commentaries(self) -> None:
        result = SeferAnalysisPipeline(FixtureProvider()).analyze_images([object()] * 6)
        self.assertEqual(
            [page.page_type for page in result.pages],
            ["title", "approbation", "introduction", "learning", "learning", "contents"],
        )
        self.assertEqual(result.learnable_pages, [4, 5])
        self.assertEqual([stream.name for stream in result.streams], ["Main text", "רש״י", "תוספות"])
        self.assertTrue(all(unit.page in {4, 5} for unit in result.units))
        self.assertGreaterEqual(len(result.units), 6)

    def test_explicit_cues_outweigh_page_order(self) -> None:
        provider = FixtureProvider()
        pages = provider.analyze([])
        pages[4].blocks[0].text = "הקדמה מיוחדת למהדורה זו"

        class ChangedProvider:
            name = "changed"

            def analyze(self, images: list[object]) -> list[PageRecord]:
                return pages

        result = SeferAnalysisPipeline(ChangedProvider()).analyze_images([])
        self.assertEqual(result.pages[4].page_type, "introduction")

    def test_links_commentary_continuations_without_repeated_heading(self) -> None:
        provider = FixtureProvider()
        pages = provider.analyze([])
        pages[4].blocks[1].text = "והמשך הפירוש על דברי הגמרא"
        pages[4].blocks[2].text = "ועוד יש לבאר קושיא זו"

        class ContinuationProvider:
            name = "continuation"

            def analyze(self, images: list[object]) -> list[PageRecord]:
                return pages

        result = SeferAnalysisPipeline(ContinuationProvider()).analyze_images([])
        streams = {stream.name: stream for stream in result.streams}
        self.assertEqual(streams["רש״י"].pages, [4, 5])
        self.assertEqual(streams["תוספות"].pages, [4, 5])

    def test_low_confidence_stream_block_is_sent_to_review(self) -> None:
        provider = FixtureProvider()
        pages = provider.analyze([])
        pages[3].blocks[1].confidence = 0.41
        pages[3].blocks[1].role_confidence = 0.0

        class WeakProvider:
            name = "weak"

            def analyze(self, images: list[object]) -> list[PageRecord]:
                return pages

        result = SeferAnalysisPipeline(WeakProvider()).analyze_images([])
        self.assertIn(4, result.review_pages)


if __name__ == "__main__":
    unittest.main()
