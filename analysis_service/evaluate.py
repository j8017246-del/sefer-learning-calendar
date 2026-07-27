"""Evaluate a structured analysis result against edition-level ground truth."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def safe_div(numerator: int, denominator: int) -> float:
    return numerator / denominator if denominator else 0.0


def evaluate(result: dict, truth: dict) -> dict:
    predicted_pages = {page["page"]: page for page in result.get("pages", [])}
    true_pages = {int(page): kind for page, kind in truth.get("page_types", {}).items()}
    matched = sum(
        predicted_pages.get(page, {}).get("page_type") == kind
        for page, kind in true_pages.items()
    )
    true_learning = {page for page, kind in true_pages.items() if kind == "learning"}
    predicted_learning = set(result.get("learnable_pages", []))
    review = set(result.get("review_pages", []))
    stream_truth = set(truth.get("stream_names", []))
    stream_predicted = {stream["name"] for stream in result.get("streams", [])}
    return {
        "page_type_accuracy": round(safe_div(matched, len(true_pages)), 4),
        "learning_precision": round(
            safe_div(len(true_learning & predicted_learning), len(predicted_learning)), 4
        ),
        "learning_recall": round(
            safe_div(len(true_learning & predicted_learning), len(true_learning)), 4
        ),
        "stream_name_precision": round(
            safe_div(len(stream_truth & stream_predicted), len(stream_predicted)), 4
        ),
        "stream_name_recall": round(
            safe_div(len(stream_truth & stream_predicted), len(stream_truth)), 4
        ),
        "review_rate": round(safe_div(len(review), len(true_pages)), 4),
        "unsafe_errors": sorted(
            page
            for page, kind in true_pages.items()
            if predicted_pages.get(page, {}).get("page_type") != kind and page not in review
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("result", type=Path)
    parser.add_argument("truth", type=Path)
    args = parser.parse_args()
    result = json.loads(args.result.read_text(encoding="utf-8"))
    truth = json.loads(args.truth.read_text(encoding="utf-8"))
    print(json.dumps(evaluate(result, truth), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
