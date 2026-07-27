# Evaluation set

Accuracy must be measured on complete editions that were not used for
fine-tuning. Keep separate strata for:

- clean modern Hebrew print;
- old print and broken type;
- Vilna-style Gemara pages;
- Mishnayos with one or more commentaries;
- Shulchan Aruch / Mishnah Berurah layouts;
- prose, responsa, and machshavah;
- skewed, stained, low-contrast, and incomplete scans.

Each private ground-truth JSON file uses:

```json
{
  "edition_id": "licensed-edition-identifier",
  "page_types": {
    "1": "title",
    "2": "approbation",
    "3": "introduction",
    "4": "learning"
  },
  "stream_names": ["Main text", "רש״י", "תוספות"]
}
```

Run:

```bash
python evaluate.py result.json ground_truth.json
```

`unsafe_errors` is the primary release blocker: it lists incorrect page
classifications that the engine failed to send to review. Production
thresholds should be calibrated to reduce that list before optimizing the
review rate.
