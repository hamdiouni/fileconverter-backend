# Document Worker — Requirements: 16.1, 19.5
FROM python:3.11-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice \
    pandoc \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir poetry==1.8.2

WORKDIR /app
COPY pyproject.toml poetry.lock* ./
RUN poetry config virtualenvs.create false \
    && poetry install --only main --no-root

COPY src/ ./src/

RUN groupadd -r worker && useradd -r -g worker worker
USER worker

EXPOSE 9090

HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:9090/health')" || exit 1

CMD ["python", "-m", "src.worker"]
