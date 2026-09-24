"""
Archive worker — consumes from bull:fc:queue:archive:wait.
Uses Python's standard zipfile/tarfile modules for archive conversions.
"""
from __future__ import annotations

import io
import json
import os
import signal
import tarfile
import tempfile
import threading
import time
import urllib.request
import urllib.error
import uuid
import zipfile
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
WORKER_ID             = f"archive-worker-{os.getpid()}"
QUEUE_KEY             = "bull:fc:queue:archive:wait"


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
                "service": "archive-worker",
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


from src.converter import (
    repack_archive,
    sanitize_entry_name,
    validate_archive_safety,
    ArchiveSecurityError,
    ArchiveTooLargeError,
    UnsupportedFormatError,
)

ARCHIVE_MIME = {
    "zip": "application/zip",
    "tar": "application/x-tar",
    "gz": "application/gzip",
    "tar.gz": "application/gzip",
    "tgz": "application/gzip",
    "7z": "application/x-7z-compressed",
    "rar": "application/x-rar-compressed",
    "bz2": "application/x-bzip2",
    "tar.bz2": "application/x-bzip2",
    "xz": "application/x-xz",
    "tar.xz": "application/x-xz",
}


def extract_files(src_bytes: bytes, src_fmt: str) -> list[tuple[str, bytes]]:
    """Extract all files from an archive with path traversal and size checks."""
    from src.converter import repack_archive
    # Extract using converter logic
    files: list[tuple[str, bytes]] = []
    if src_fmt == "zip":
        with zipfile.ZipFile(io.BytesIO(src_bytes)) as zf:
            total_size = 0
            for info in zf.infolist():
                if not info.filename.endswith("/"):
                    safe_name = sanitize_entry_name(info.filename)
                    data = zf.read(info)
                    total_size += len(data)
                    validate_archive_safety(len(src_bytes), total_size, len(files) + 1)
                    files.append((safe_name, data))
    elif src_fmt in ("tar", "gz", "bz2", "xz", "tar.gz", "tar.bz2", "tar.xz", "tgz"):
        mode = "r:gz" if src_fmt in ("gz", "tar.gz", "tgz") else ("r:bz2" if src_fmt in ("bz2", "tar.bz2") else ("r:xz" if src_fmt in ("xz", "tar.xz") else "r:*"))
        with tarfile.open(fileobj=io.BytesIO(src_bytes), mode=mode) as tf:
            total_size = 0
            for m in tf.getmembers():
                if m.isfile():
                    safe_name = sanitize_entry_name(m.name)
                    f = tf.extractfile(m)
                    if f:
                        data = f.read()
                        total_size += len(data)
                        validate_archive_safety(len(src_bytes), total_size, len(files) + 1)
                        files.append((safe_name, data))
    elif src_fmt in ("7z", "rar"):
        from src.converter import extract_7z_or_rar
        files = extract_7z_or_rar(src_bytes, src_fmt)
    else:
        raise UnsupportedFormatError(f"Unsupported source archive format: {src_fmt}")
    return files


def pack_files(files: list[tuple[str, bytes]], tgt_fmt: str) -> bytes:
    """Pack files into the target archive format."""
    buf = io.BytesIO()
    if tgt_fmt == "zip":
        with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for name, data in files:
                zf.writestr(name, data)
    elif tgt_fmt in ("tar", "gz", "tar.gz", "tgz"):
        mode = "w:gz" if tgt_fmt in ("gz", "tar.gz", "tgz") else "w:"
        with tarfile.open(fileobj=buf, mode=mode) as tf:
            for name, data in files:
                info = tarfile.TarInfo(name=name)
                info.size = len(data)
                tf.addfile(info, io.BytesIO(data))
    else:
        raise UnsupportedFormatError(f"Unsupported target archive format: {tgt_fmt}")
    return buf.getvalue()


def process_job(job_data: dict[str, Any]) -> None:
    job_id     = job_data["jobId"]
    source_id  = job_data["sourceFileId"]
    src_fmt    = job_data.get("sourceFormat", "zip")
    tgt_fmt    = job_data["targetFormat"]
    src_bucket = job_data.get("sourceBucket", "fileconverter-uploads")
    res_bucket = job_data.get("resultBucket", "fileconverter-results")
    callback   = job_data["callbackUrl"]

    logger = log.bind(job_id=job_id, src=src_fmt, tgt=tgt_fmt)
    logger.info("archive_job_started")
    post_status(callback, {"status": "processing", "progress": 10, "workerId": WORKER_ID})

    s3 = make_s3()
    try:
        resp = s3.get_object(Bucket=src_bucket, Key=source_id)
        src_bytes = resp["Body"].read()
        post_status(callback, {"status": "processing", "progress": 40, "workerId": WORKER_ID})

        # Repack with zip bomb protection, uncompressed size checks, and path traversal guards
        out_bytes = repack_archive(src_bytes, src_fmt, tgt_fmt)

        post_status(callback, {"status": "processing", "progress": 80, "workerId": WORKER_ID})

        result_key = f"results/{job_id}/{uuid.uuid4()}.{tgt_fmt}"
        mime = ARCHIVE_MIME.get(tgt_fmt, "application/octet-stream")
        s3.put_object(Bucket=res_bucket, Key=result_key, Body=out_bytes, ContentType=mime)

        post_status(callback, {"status": "completed", "progress": 100,
                                "resultFileId": result_key, "workerId": WORKER_ID})
        logger.info("archive_job_completed", result_key=result_key)

    except Exception as exc:
        logger.error("archive_job_failed", error=str(exc))
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
    log.info("worker_started", service="archive-worker", pid=os.getpid())
    redis_client = make_redis()
    _start_health_server(9090, redis_client=redis_client)
    run_consumer(redis_client)
    log.info("worker_stopped", service="archive-worker")
