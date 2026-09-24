"""
CAD/Font worker — consumes from bull:fc:queue:cad:wait.
Uses fonttools for font format conversions (ttf/otf/woff/woff2).
CAD conversions (dwg/dxf) are placeholders that report failure gracefully
until a proper CAD library is integrated.
"""
from __future__ import annotations

import io
import json
import os
import signal
import threading
import time
import urllib.request
import urllib.error
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

import redis as redis_lib
import structlog
import boto3

log = structlog.get_logger()
_shutdown = False

REDIS_URL             = os.environ.get("REDIS_URL", "redis://localhost:6379")
S3_ENDPOINT           = os.environ.get("S3_ENDPOINT", "http://localhost:9000")
AWS_ACCESS_KEY_ID     = os.environ.get("AWS_ACCESS_KEY_ID", "minioadmin")
AWS_SECRET_ACCESS_KEY = os.environ.get("AWS_SECRET_ACCESS_KEY", "minioadmin_dev")
WORKER_ID             = f"cad-font-worker-{os.getpid()}"
QUEUE_KEY             = "bull:fc:queue:cad:wait"

FONT_FORMAT_MIME = {
    "ttf": "font/ttf", "otf": "font/otf",
    "woff": "font/woff", "woff2": "font/woff2",
}
FONT_FLAVORS = {"woff": "woff", "woff2": "woff2", "ttf": None, "otf": None}

FORMAT_MIME = {
    # Fonts
    "ttf": "font/ttf", "otf": "font/otf",
    "woff": "font/woff", "woff2": "font/woff2",
    "eot": "application/vnd.ms-fontobject",
    # CAD / Vector / 3D
    "pdf": "application/pdf",
    "svg": "image/svg+xml",
    "dxf": "image/vnd.dxf",
    "dwg": "image/vnd.dwg",
    "stl": "model/stl",
    "obj": "model/obj",
    "step": "model/step",
    "stp": "model/step",
    "iges": "model/iges",
    "igs": "model/iges",
}


_redis_client_for_health: Any = None


class _HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            checks = {}
            is_ok = True
            global _redis_client_for_health
            if _redis_client_for_health is not None:
                try:
                    _redis_client_for_health.ping()
                    checks["redis"] = "ok"
                except Exception as exc:
                    checks["redis"] = f"error: {exc}"
                    is_ok = False
            else:
                try:
                    import urllib.parse
                    p = urllib.parse.urlparse(REDIS_URL)
                    c = redis_lib.Redis(
                        host=p.hostname or "localhost",
                        port=p.port or 6379,
                        password=p.password or None,
                        socket_connect_timeout=2,
                        socket_timeout=2,
                    )
                    c.ping()
                    checks["redis"] = "ok"
                except Exception as exc:
                    checks["redis"] = f"error: {exc}"
                    is_ok = False

            status_code = 200 if is_ok else 503
            body = json.dumps({
                "status": "ok" if is_ok else "degraded",
                "service": "cad-font-worker",
                "checks": checks,
            }).encode("utf-8")
            self.send_response(status_code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, *args): pass

def _start_health_server(port=9090, redis_client=None):
    global _redis_client_for_health
    if redis_client is not None:
        _redis_client_for_health = redis_client
    threading.Thread(target=HTTPServer(("0.0.0.0", port), _HealthHandler).serve_forever, daemon=True).start()

def handle_shutdown(signum, frame):
    global _shutdown; _shutdown = True

signal.signal(signal.SIGTERM, handle_shutdown)
signal.signal(signal.SIGINT, handle_shutdown)


def make_redis():
    import urllib.parse
    p = urllib.parse.urlparse(REDIS_URL)
    for i in range(10):
        try:
            c = redis_lib.Redis(host=p.hostname or "localhost", port=p.port or 6379,
                                db=int((p.path or "/0").lstrip("/") or "0"),
                                password=p.password or None, decode_responses=True,
                                socket_connect_timeout=5, socket_timeout=30)
            c.ping()
            global _redis_client_for_health
            _redis_client_for_health = c
            return c
        except Exception as e:
            log.warning("redis_retry", attempt=i+1, error=str(e)); time.sleep(2 ** min(i, 4))
    raise RuntimeError("Redis connection failed")

def make_s3():
    return boto3.client("s3", endpoint_url=S3_ENDPOINT,
                        aws_access_key_id=AWS_ACCESS_KEY_ID,
                        aws_secret_access_key=AWS_SECRET_ACCESS_KEY)

def post_status(url, payload):
    body = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=body, method="POST",
                                 headers={"Content-Type": "application/json"})
    for i in range(3):
        try:
            with urllib.request.urlopen(req, timeout=10): return
        except urllib.error.URLError: time.sleep(2 ** i)


def convert_font(src_bytes: bytes, src_fmt: str, tgt_fmt: str) -> bytes:
    """Convert font using fonttools."""
    try:
        from fontTools.ttLib import TTFont
    except ImportError:
        raise RuntimeError("fonttools is not installed — font conversion unavailable")

    buf = io.BytesIO(src_bytes)
    font = TTFont(buf)

    out = io.BytesIO()
    flavor = FONT_FLAVORS.get(tgt_fmt)
    if flavor:
        font.flavor = flavor
        font.save(out)
    else:
        # Remove WOFF/WOFF2 flavor for plain ttf/otf output
        font.flavor = None
        font.save(out)
    return out.getvalue()


def process_job(job_data: dict[str, Any]) -> None:
    from src.converter import classify_job, convert_cad

    job_id     = job_data["jobId"]
    source_id  = job_data["sourceFileId"]
    src_fmt    = job_data.get("sourceFormat", "ttf").lower().strip()
    tgt_fmt    = job_data["targetFormat"].lower().strip()
    src_bucket = job_data.get("sourceBucket", "fileconverter-uploads")
    res_bucket = job_data.get("resultBucket", "fileconverter-results")
    callback   = job_data["callbackUrl"]

    logger = log.bind(job_id=job_id, src=src_fmt, tgt=tgt_fmt)

    try:
        job_type = classify_job(src_fmt, tgt_fmt)
    except Exception as exc:
        logger.error("unsupported_job_type", error=str(exc))
        post_status(callback, {
            "status": "failed",
            "errorMessage": str(exc),
            "workerId": WORKER_ID,
        })
        return

    logger.info("job_started", job_type=job_type)
    post_status(callback, {"status": "processing", "progress": 10, "workerId": WORKER_ID})

    s3 = make_s3()
    import tempfile
    with tempfile.TemporaryDirectory() as tmp_dir:
        in_path = os.path.join(tmp_dir, f"input.{src_fmt}")
        out_path = os.path.join(tmp_dir, f"output.{tgt_fmt}")
        try:
            s3.download_file(src_bucket, source_id, in_path)
            post_status(callback, {"status": "processing", "progress": 40, "workerId": WORKER_ID})

            if job_type == "cad":
                convert_cad(in_path, out_path, src_fmt, tgt_fmt)
            else:
                with open(in_path, "rb") as f_in:
                    src_bytes = f_in.read()
                out_bytes = convert_font(src_bytes, src_fmt, tgt_fmt)
                with open(out_path, "wb") as f_out:
                    f_out.write(out_bytes)

            post_status(callback, {"status": "processing", "progress": 80, "workerId": WORKER_ID})

            result_key = f"results/{job_id}/{uuid.uuid4()}.{tgt_fmt}"
            mime = FORMAT_MIME.get(tgt_fmt, "application/octet-stream")
            s3.upload_file(out_path, res_bucket, result_key, ExtraArgs={"ContentType": mime})

            post_status(callback, {
                "status": "completed",
                "progress": 100,
                "resultFileId": result_key,
                "workerId": WORKER_ID,
            })
            logger.info("job_completed", job_type=job_type, result_key=result_key)

        except Exception as exc:
            logger.error("job_failed", job_type=job_type, error=str(exc))
            post_status(callback, {"status": "failed", "errorMessage": str(exc), "workerId": WORKER_ID})



def run_consumer(redis_client):
    active_key = QUEUE_KEY.replace(":wait", ":active") if ":wait" in QUEUE_KEY else f"{QUEUE_KEY}:active"
    log.info("consumer_started", queue=QUEUE_KEY, active_queue=active_key)

    # Recover any orphaned jobs from a previous crash
    try:
        recovered = 0
        while True:
            item = redis_client.rpoplpush(active_key, QUEUE_KEY)
            if item is None:
                break
            recovered += 1
        if recovered > 0:
            log.info("recovered_orphaned_jobs", count=recovered, queue=QUEUE_KEY)
    except Exception as exc:
        log.warning("orphan_recovery_failed", error=str(exc))

    while not _shutdown:
        raw = None
        try:
            raw = redis_client.brpoplpush(QUEUE_KEY, active_key, timeout=5)
            if raw is None:
                continue
            try:
                envelope = json.loads(raw)
                process_job(envelope.get("data", {}))
            except json.JSONDecodeError as e:
                log.error("envelope_parse_error", error=str(e))
                redis_client.lrem(active_key, 1, raw)
            finally:
                try:
                    redis_client.lrem(active_key, 1, raw)
                except Exception:
                    pass
        except redis_lib.exceptions.ConnectionError as e:
            log.error("redis_lost", error=str(e)); time.sleep(5)
        except Exception as e:
            log.error("consumer_error", error=str(e)); time.sleep(1)


if __name__ == "__main__":
    log.info("worker_started", service="cad-font-worker", pid=os.getpid())
    redis_client = make_redis()
    _start_health_server(9090, redis_client=redis_client)
    run_consumer(redis_client)
    log.info("worker_stopped", service="cad-font-worker")
