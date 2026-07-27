from __future__ import annotations

import re
from html import unescape
from itertools import count

from ..domain import Box, OCRBlock, PageRecord

TAG_RE = re.compile(r"<[^>]+>")


class SuryaProvider:
    """Surya 2 layout + OCR adapter.

    The model runs in the private analysis environment. It is never downloaded
    into the learner's browser and can point at a persistent vLLM service using
    SURYA_INFERENCE_URL.
    """

    name = "surya-2"

    def __init__(self) -> None:
        try:
            from surya.inference import SuryaInferenceManager
            from surya.layout import LayoutPredictor
            from surya.recognition import RecognitionPredictor
        except ImportError as exc:
            raise RuntimeError(
                "Surya is not installed. Install the private-cloud model extras."
            ) from exc
        manager = SuryaInferenceManager()
        self.layout_predictor = LayoutPredictor(manager)
        self.recognition_predictor = RecognitionPredictor(manager)

    def analyze(self, images: list[object]) -> list[PageRecord]:
        pages = self._predict(images, list(range(1, len(images) + 1)))
        retry_indexes = [
            index
            for index, page in enumerate(pages)
            if self._needs_retry(page)
        ]
        if retry_indexes:
            retry_images = [self._restoration_variant(images[index]) for index in retry_indexes]
            retry_pages = self._predict(
                retry_images,
                [index + 1 for index in retry_indexes],
            )
            for index, candidate in zip(retry_indexes, retry_pages):
                if self._page_score(candidate) > self._page_score(pages[index]):
                    candidate.reasons.append("alternate restoration produced stronger OCR/layout evidence")
                    pages[index] = candidate
        return pages

    def _predict(self, images: list[object], page_numbers: list[int]) -> list[PageRecord]:
        layouts = self.layout_predictor(images)
        predictions = self.recognition_predictor(images, layouts)
        pages: list[PageRecord] = []
        block_ids = count(1)
        for page_number, image, prediction in zip(page_numbers, images, predictions):
            width, height = image.size
            blocks: list[OCRBlock] = []
            for order, source in enumerate(prediction.blocks):
                x0, y0, x1, y1 = [float(value) for value in source.bbox]
                html = getattr(source, "html", "") or ""
                text = unescape(TAG_RE.sub(" ", html)).strip()
                blocks.append(
                    OCRBlock(
                        id=f"p{page_number}-b{next(block_ids)}",
                        page=page_number,
                        box=Box(x0 / width, y0 / height, (x1 - x0) / width, (y1 - y0) / height),
                        text=text,
                        confidence=float(getattr(source, "confidence", 0.0) or 0.0),
                        layout_label=str(getattr(source, "label", "Text")),
                        reading_order=int(getattr(source, "reading_order", order)),
                        line_count=max(1, text.count("\n") + 1),
                        estimated_line_height=max(0.005, ((y1 - y0) / height) / max(1, text.count("\n") + 1)),
                    )
                )
            pages.append(
                PageRecord(
                    page=page_number,
                    width=width,
                    height=height,
                    blocks=blocks,
                    image_quality=self._image_quality(image),
                )
            )
        return pages

    @staticmethod
    def _image_quality(image: object) -> dict[str, float]:
        from PIL import ImageStat

        grayscale = image.convert("L")
        stats = ImageStat.Stat(grayscale)
        mean = float(stats.mean[0])
        deviation = float(stats.stddev[0])
        return {
            "brightness": round(mean / 255, 3),
            "contrast": round(deviation / 128, 3),
        }

    @staticmethod
    def _page_score(page: PageRecord) -> float:
        if not page.blocks:
            return 0.0
        confidence = sum(block.confidence for block in page.blocks) / len(page.blocks)
        coverage = min(1.0, sum(block.box.area for block in page.blocks))
        useful_blocks = min(8, len([block for block in page.blocks if block.text.strip()]))
        return confidence * 3 + coverage + useful_blocks * 0.16

    def _needs_retry(self, page: PageRecord) -> bool:
        useful = [block for block in page.blocks if block.text.strip()]
        if not useful:
            return True
        mean_confidence = sum(block.confidence for block in useful) / len(useful)
        suspicious_single_block = len(useful) == 1 and useful[0].box.area > 0.22
        low_contrast = page.image_quality.get("contrast", 1.0) < 0.28
        return mean_confidence < 0.74 or suspicious_single_block or low_contrast

    @staticmethod
    def _restoration_variant(image: object) -> object:
        from PIL import ImageEnhance, ImageFilter, ImageOps

        grayscale = ImageOps.autocontrast(image.convert("L"), cutoff=2)
        grayscale = ImageEnhance.Contrast(grayscale).enhance(1.35)
        grayscale = grayscale.filter(ImageFilter.UnsharpMask(radius=1.2, percent=145, threshold=3))
        return grayscale.convert("RGB")
