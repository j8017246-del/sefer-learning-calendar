from __future__ import annotations

from pathlib import Path


def render_pdf(pdf_path: Path, dpi: int = 192) -> list[object]:
    try:
        import pypdfium2 as pdfium
        from PIL import Image, ImageEnhance, ImageFilter, ImageOps
    except ImportError as exc:
        raise RuntimeError("PDF rendering dependencies are not installed.") from exc

    document = pdfium.PdfDocument(str(pdf_path))
    scale = dpi / 72
    images: list[object] = []
    for index in range(len(document)):
        page = document[index]
        image = page.render(scale=scale).to_pil().convert("L")
        image = ImageOps.autocontrast(image, cutoff=1)
        image = ImageEnhance.Contrast(image).enhance(1.12)
        image = image.filter(ImageFilter.MedianFilter(size=3))
        images.append(image.convert("RGB"))
    return images

