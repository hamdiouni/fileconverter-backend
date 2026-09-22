"""
Image worker — consumes from the BullMQ-compatible Redis queue and converts images
using Pillow via the existing converter module.

Queue protocol:
  Producer (TypeScript): LPUSH bull:fc:queue:image:wait <json-envelope>
  Consumer (this file):  BRPOP bull:fc:queue:image:wait 5

Job envelope format (matches queue/producer.ts):
  {
    "id": "<uuid>",          # BullMQ envelope ID
    "name": "convert",
    "data": {
      "jobId": "<db-job-id>",
      "sourceFileId": "...",
      "sourceFormat": "png",
      "targetFormat": "jpg",
      "options": { "quality": 85, "width": null, "height": null, "preserve_metadata": false },
      "sourceBucket": "fileconverter-uploads",
      "resultBucket": "fileconverter-results",
      "callbackUrl": "http://orchestrator-service:3003/internal/conversions/<jobId>/status"
    }
  }
"""
from __future__ import annotations

import json
import os
import signal
import threading
import time
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

import redis as redis_lib
import structlog

from .converter import convert_image, ImageConversionError
from .storage import StorageClient

log = structlog.get_logger()
_shutdown = False

# ── Configuration ─────────────────────────────────────────────────────────────

REDIS_URL         = os.environ.get("REDIS_URL", "redis://localhost:6379")
S3_ENDPOINT       = os.environ.get("S3_ENDPOINT", "http://localhost:9000")
AWS_ACCESS_KEY_ID = os.environ.get("AWS_ACCESS_KEY_ID", "minioadmin")
AWS_SECRET_ACCESS_KEY = os.environ.get("AWS_SECRET_ACCESS_KEY", "minioadmin_dev")
WORKER_CONCURRENCY = int(os.environ.get("WORKER_CONCURRENCY", "2"))

QUEUE_KEY      = "bull:fc:queue:image:wait"
QUEUE_ACTIVE   = "bull:fc:queue:image:active"
WORKER_ID      = f"image-worker-{os.getpid()}"


# ── Health HTTP server ────────────────────────────────────────────────────────

class _HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            body = b'{"status":"ok","service":"image-worker"}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, *args):
        pass


def _start_health_server(port: int = 9090) -> HTTPServer:
    server = HTTPServer(("0.0.0.0", port), _HealthHandler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server


# ── Shutdown handler ──────────────────────────────────────────────────────────

def handle_shutdown(signum, frame):
    global _shutdown
    _shutdown = True
    log.info("shutdown_signal_received", signal=signum)


signal.signal(signal.SIGTERM, handle_shutdown)
signal.signal(signal.SIGINT, handle_shutdown)


# ── Redis connection ──────────────────────────────────────────────────────────

def _make_redis_client() -> redis_lib.Redis:
    """Parse REDIS_URL and return a Redis client with connection retry."""
    import urllib.parse
    parsed = urllib.parse.urlparse(REDIS_URL)
    password = parsed.password or None
    host = parsed.hostname or "localhost"
    port = parsed.port or 6379
    db = int((parsed.path or "/0").lstrip("/") or "0")

    for attempt in range(10):
        try:
            client = redis_lib.Redis(
                host=host,
                port=port,
                db=db,
                password=password,
                decode_responses=True,
                socket_connect_timeout=5,
                socket_timeout=30,
            )
            client.ping()
            log.info("redis_connected", host=host, port=port)
            return client
        except Exception as exc:
            log.warning("redis_connect_retry", attempt=attempt + 1, error=str(exc))
            time.sleep(2 ** min(attempt, 4))
    raise RuntimeError("Failed to connect to Redis after 10 attempts")


# ── Storage client ────────────────────────────────────────────────────────────

def _make_storage(bucket: str) -> StorageClient:
    return StorageClient(
        endpoint_url=S3_ENDPOINT,
        access_key=AWS_ACCESS_KEY_ID,
        secret_key=AWS_SECRET_ACCESS_KEY,
        bucket=bucket,
    )


# ── Job processing ────────────────────────────────────────────────────────────

def _post_status(callback_url: str, payload: dict) -> None:
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        callback_url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=10):
                pass
            return
        except urllib.error.URLError as exc:
            log.warning("callback_retry", attempt=attempt + 1, url=callback_url, error=str(exc))
            time.sleep(2 ** attempt)


def process_job(job_data: dict[str, Any], redis_client: redis_lib.Redis) -> None:
    job_id      = job_data["jobId"]
    source_id   = job_data["sourceFileId"]
    source_fmt  = job_data.get("sourceFormat", "unknown")
    target_fmt  = job_data["targetFormat"]
    opts        = job_data.get("options", {})
    src_bucket  = job_data.get("sourceBucket", "fileconverter-uploads")
    res_bucket  = job_data.get("resultBucket", "fileconverter-results")
    callback    = job_data["callbackUrl"]

    logger = log.bind(job_id=job_id, source=source_id, target=target_fmt)
    logger.info("job_started")

    # Report processing
    _post_status(callback, {"status": "processing", "progress": 10, "workerId": WORKER_ID})

    try:
        # Download source file
        src_storage = _make_storage(src_bucket)
        image_data = src_storage.download(source_id)
        logger.info("source_downloaded", bytes=len(image_data))

        _post_status(callback, {"status": "processing", "progress": 30, "workerId": WORKER_ID})

        # Convert
        quality  = opts.get("quality") or None
        width    = opts.get("width") or None
        height   = opts.get("height") or None
        preserve = bool(opts.get("preserve_metadata") or opts.get("preserveMetadata") or False)

        output_bytes = convert_image(
            image_data,
            target_format=target_fmt,
            quality=quality,
            width=width,
            height=height,
            preserve_metadata=preserve,
        )
        logger.info("conversion_done", output_bytes=len(output_bytes))

        _post_status(callback, {"status": "processing", "progress": 70, "workerId": WORKER_ID})

        # Upload result
        import uuid as _uuid
        result_key = f"results/{job_id}/{_uuid.uuid4()}.{target_fmt}"
        res_storage = _make_storage(res_bucket)
        mime_map = {
            "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
            "webp": "image/webp", "gif": "image/gif", "bmp": "image/bmp",
            "tiff": "image/tiff", "pdf": "application/pdf",
        }
        mime = mime_map.get(target_fmt.lower(), "application/octet-stream")
        res_storage.upload(result_key, output_bytes, content_type=mime)
        logger.info("result_uploaded", key=result_key)

        # Report success
        _post_status(callback, {
            "status": "completed",
            "progress": 100,
            "resultFileId": result_key,
            "workerId": WORKER_ID,
        })
        logger.info("job_completed", result_key=result_key)

    except ImageConversionError as exc:
        logger.error("conversion_error", error=str(exc))
        _post_status(callback, {
            "status": "failed",
            "errorMessage": str(exc),
            "workerId": WORKER_ID,
        })
    except Exception as exc:
        logger.error("unexpected_error", error=str(exc), exc_info=True)
        _post_status(callback, {
            "status": "failed",
            "errorMessage": f"Internal worker error: {exc}",
            "workerId": WORKER_ID,
        })


# ── Consumer loop ─────────────────────────────────────────────────────────────

def run_consumer(redis_client: redis_lib.Redis) -> None:
    log.info("consumer_started", queue=QUEUE_KEY, concurrency=WORKER_CONCURRENCY)
    while not _shutdown:
        try:
            # BRPOP blocks up to 5 seconds then returns None if nothing arrives
            result = redis_client.brpop(QUEUE_KEY, timeout=5)
            if result is None:
                continue

            _queue_key, raw_envelope = result
            try:
                envelope = json.loads(raw_envelope)
                job_data = envelope.get("data", {})
            except json.JSONDecodeError as exc:
                log.error("envelope_parse_error", error=str(exc), raw=raw_envelope[:200])
                continue

            # Process synchronously in the single-worker loop.
            # For higher concurrency, run multiple container replicas.
            process_job(job_data, redis_client)

        except redis_lib.exceptions.ConnectionError as exc:
            log.error("redis_connection_lost", error=str(exc))
            time.sleep(5)
        except Exception as exc:
            log.error("consumer_loop_error", error=str(exc), exc_info=True)
            time.sleep(1)

    log.info("consumer_stopped")


# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    log.info("worker_started", service="image-worker", pid=os.getpid())
    _start_health_server(9090)
    log.info("health_server_started", port=9090)

    redis_client = _make_redis_client()
    run_consumer(redis_client)

    log.info("worker_stopped", service="image-worker")
