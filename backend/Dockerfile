# syntax=docker/dockerfile:1
FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    MODEL_DIR=/app/artifacts

WORKDIR /app
RUN useradd --create-home --uid 10001 neurogrip

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
COPY scripts ./scripts

# Train the material classifier at build time (deterministic: seed 42) so the
# image ships with a ready model. A named volume mounted on /app/artifacts is
# seeded from this content and keeps models retrained from the ML Lab.
RUN python -m app.ml.train --out /app/artifacts && chown -R neurogrip:neurogrip /app

USER neurogrip
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3).status == 200 else 1)"

# One worker on purpose: the live-sensor hub (WebSocket fan-out) is in-process.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
