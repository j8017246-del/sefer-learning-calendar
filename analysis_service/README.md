# Private-cloud sefer analyzer

This service is the model-capable half of the Sefer Learning Calendar. GitHub
Pages remains the user interface; scanned PDFs are analyzed by this private
service and deleted after the structured result is saved.

The pipeline is intentionally staged:

1. render, normalize contrast, and denoise every PDF page;
2. run Surya 2 layout analysis and OCR in a private inference environment;
3. classify page purpose from recognized Hebrew cues and visual structure;
4. detect a main stream and any number of named or unnamed commentaries;
5. connect recurring streams across the entire edition;
6. extract weighted learning units and scored stopping boundaries;
7. refuse automatic certification where confidence is insufficient.

`ANALYSIS_API_KEY` protects the initial development service. Production should
replace the shared secret with real user authentication, signed uploads,
durable job storage, encrypted object storage, a queue, and managed secrets.

The model weights are not committed to this repository. Surya's model license
must be reviewed before commercial deployment. A sefer-specific fine-tuned
checkpoint will require a licensed ground-truth dataset of page images,
transcriptions, layout regions, reading order, and stream labels.

