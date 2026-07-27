# Sefer Learning Calendar

A PDF-first digital shtender that creates accountable learning calendars while
preserving the original *tzuras hadaf*.

## Demo 10

The browser application remains a static GitHub Pages site. Page analysis now
uses a separate private model service instead of attempting to understand old
Hebrew scans with browser heuristics.

The private pipeline:

1. restores and renders every page of the complete PDF;
2. performs Hebrew/Aramaic OCR and layout recognition;
3. classifies title pages, haskamos, introductions, contents, appendices, and
   learning pages from explicit text and layout evidence;
4. discovers a main text and any number of named or recurring commentaries;
5. links those streams across the edition;
6. extracts weighted learning units and scored stopping boundaries;
7. withholds uncertain pages for focused human review.

The learner still reads only from the original scan. OCR is metadata for
navigation, structure, scheduling, and confidence—not an authoritative Torah
text.

## Run the website

Serve the repository root with any static server, for example:

```bash
python3 -m http.server 8765
```

Open `http://127.0.0.1:8765`, create a project, and enter the HTTPS address of
the private analyzer when prompted.

## Run the private analyzer

The model service is in `analysis_service/`. It is intended for a private GPU
environment rather than GitHub Pages.

```bash
cd analysis_service
docker build -t sefer-analyzer .
docker run --gpus all --rm -p 8000:8000 \
  -e ALLOWED_ORIGINS=https://j8017246-del.github.io \
  sefer-analyzer
```

For local development, use `http://127.0.0.1:8000` as the analyzer address.
Production must put the service behind HTTPS and real user authentication.
Do not place a shared service secret in `index.html`.

## Tests

The pipeline tests do not download model weights:

```bash
PYTHONPATH=analysis_service python3 -m unittest discover \
  -s analysis_service/tests -v
```

See [docs/analysis-architecture.md](docs/analysis-architecture.md) for the
model boundary, confidence policy, privacy lifecycle, evaluation plan, and
production hardening requirements.
