FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ANALYSIS_DATA_DIR=/var/lib/sefer-analysis

WORKDIR /service
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app

RUN useradd --create-home --uid 10001 analyzer \
    && mkdir -p /var/lib/sefer-analysis \
    && chown -R analyzer:analyzer /var/lib/sefer-analysis /service
USER analyzer

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

