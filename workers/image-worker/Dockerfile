# Image Worker — Requirements: 16.1, 19.1, 19.5
FROM python:3.11-slim AS base

# Install system-level image libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips-dev \
    imagemagick \
    libmagic1 \
    && rm -rf /var/lib/apt/lists/*

# Install Poetry
RUN pip install --no-cache-dir poetry==1.8.2

WORKDIR /app

COPY pyproject.toml poetry.lock* ./
RUN poetry config virtualenvs.create false \
    && poetry install --only main --no-root

COPY src/ ./src/

# ── Security hardening ────────────────────────────────────────────────────────
RUN groupadd -r worker && useradd -r -g worker worker
USER worker

# Metrics port
EXPOSE 9090

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:9090/health')" || exit 1

CMD ["python", "-m", "src.worker"]
