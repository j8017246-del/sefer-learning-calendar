from __future__ import annotations

import unittest

from evaluate import evaluate


class EvaluationTests(unittest.TestCase):
    def test_reports_unreviewed_errors_as_unsafe(self) -> None:
        result = {
            "pages": [
                {"page": 1, "page_type": "title"},
                {"page": 2, "page_type": "learning"},
                {"page": 3, "page_type": "learning"},
            ],
            "learnable_pages": [2, 3],
            "review_pages": [2],
            "streams": [{"name": "Main text"}, {"name": "רש״י"}],
        }
        truth = {
            "page_types": {"1": "title", "2": "introduction", "3": "contents"},
            "stream_names": ["Main text", "רש״י", "תוספות"],
        }
        metrics = evaluate(result, truth)
        self.assertEqual(metrics["unsafe_errors"], [3])
        self.assertEqual(metrics["page_type_accuracy"], 0.3333)
        self.assertEqual(metrics["stream_name_recall"], 0.6667)


if __name__ == "__main__":
    unittest.main()
