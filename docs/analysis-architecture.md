# Private-cloud sefer analysis architecture

## Decision

The static website must not classify a page with lightweight browser OCR and
geometry rules. A complete edition is analyzed as one document by a private,
model-capable service. The service returns structured metadata; the original
PDF remains stored in the learner's browser and remains the authoritative
learning surface.

This boundary is necessary because accurate analysis of old sefarim requires
scan restoration, multilingual OCR, layout segmentation, document-wide
context, recurring-layout comparison, and confidence calibration. A static
GitHub Pages process cannot safely host the required model weights or secrets.

## Pipeline

```text
complete scanned PDF
        |
        v
secure temporary upload
        |
        v
page rendering and scan restoration
        |
        v
layout-aware Hebrew/Aramaic OCR
        |
        v
document-wide page-purpose classification
        |
        v
main text and N commentary stream discovery
        |
        v
reading order, learning units, boundary scores
        |
        +--> high confidence: proposed map
        |
        +--> uncertain: focused review queue
```

## Page purpose

Page order is weak evidence. Explicit cues and layout are stronger evidence.
The classifier recognizes normalized Hebrew variants for categories including:

- title and publication pages;
- הסכמה / הסכמות and approbation language;
- הקדמה, מבוא, and פתח דבר;
- תוכן, תוכן הענינים, and מפתח;
- main learning text;
- appendices and other back matter;
- blank or non-learning pages.

Neighbouring pages may smooth only a low-confidence classification. They may
not override a strong explicit cue.

## Text streams

Every OCR block keeps its page polygon, reading order, recognized text,
confidence, role, stream identity, and reasons. Stream discovery uses:

- recognized headings and dibbur-hamaschil patterns;
- relative font and line height;
- central versus peripheral placement;
- repeated geometry across nearby pages;
- recurrence across the whole edition;
- explicit commentary names such as Rashi, Tosafos, Bartenura, Maharsha,
  Shach, Taz, Mishnah Berurah, and Biur Halacha.

The schema supports one main stream and any number of separate commentaries.
The current reader can schedule main text with one selected commentary while
the analyzer preserves every discovered commentary independently for the
multi-stream reader expansion.

## Confidence policy

No schedule is certified merely because the model returned a result.

- High-confidence learning pages may be proposed automatically.
- Low-confidence page purpose, poor OCR, ambiguous stream assignment, or an
  absent main stream puts that page in the review queue.
- Flagged pages remain unschedulable until reviewed.
- A learner correction is stored as an explicit correction, not as new OCR.
- Production evaluation must report performance separately for old print,
  new print, Gemara layouts, multi-commentary pages, prose sefarim, and degraded
  scans. A single overall accuracy number is insufficient.

## Privacy lifecycle

1. The browser uploads the complete PDF over HTTPS.
2. The service stores it in a job-specific directory with restrictive
   permissions.
3. The service analyzes the PDF and writes only structured output.
4. The raw PDF is deleted when the job completes or fails.
5. The browser stores its own PDF copy locally for the reader.

Production must add authenticated users, signed upload authorization,
encryption at rest, durable queued jobs, retention enforcement, audit logs,
rate limits, and a deletion monitor. CORS is not authentication.

## Model strategy

The initial provider adapter uses a layout-aware multilingual OCR model rather
than Tesseract in the browser. The provider interface is deliberately narrow
so the engine can later substitute or ensemble:

- a stronger Hebrew/Aramaic recognizer;
- a Kraken model fine-tuned on licensed historical sefer ground truth;
- a specialized layout detector for Vilna-style pages;
- a text classifier trained on reviewed page and stream labels.

Fine-tuning requires licensed page images plus verified transcriptions,
polygons, reading order, page purpose, stream identity, and learning-boundary
labels. User corrections must not enter training automatically; they require
consent, validation, provenance, and a held-out edition split to prevent data
leakage.

## Production deployment

The included FastAPI service demonstrates the contract and pipeline. A
production deployment should replace in-process background tasks and memory
job state with:

- an authenticated API gateway;
- signed object-storage uploads;
- a durable queue;
- separate GPU workers;
- a job/status database;
- encrypted result storage with expiration;
- health, metrics, tracing, and failure alerts.

The public website should receive only a user-scoped job token. It must never
contain a reusable service API key.
