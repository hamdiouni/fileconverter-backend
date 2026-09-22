"""
Video worker — consumes from bull:fc:queue:video:wait and converts video files
using ffmpeg via subprocess.
"""
from __future__ import annotations

import json
import os
import signal
import subprocess
import tempfile
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
WORKER_ID             = f"video-worker-{os.getpid()}"
QUEUE_KEY             = "bull:fc:queue:video:wait"

VIDEO_FORMAT_MIME = {
    "mp4": "video/mp4", "webm": "video/webm", "avi": "video/x-msvideo",
    "mkv": "video/x-matroska", "mov": "video/quicktime", "flv": "video/x-flv",
}


class _HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            body = b'{"status":"ok","service":"video-worker"}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404); self.end_headers()
    def log_message(self, *args): pass

def _start_health_server(port=9090):
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
            c.ping(); return c
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


def process_job(job_data: dict[str, Any]) -> None:
    job_id     = job_data["jobId"]
    source_id  = job_data["sourceFileId"]
    src_fmt    = job_data.get("sourceFormat", "mp4")
    tgt_fmt    = job_data["targetFormat"]
    opts       = job_data.get("options", {})
    src_bucket = job_data.get("sourceBucket", "fileconverter-uploads")
    res_bucket = job_data.get("resultBucket", "fileconverter-results")
    callback   = job_data["callbackUrl"]

    logger = log.bind(job_id=job_id, target=tgt_fmt)
    logger.info("video_job_started")
    post_status(callback, {"status": "processing", "progress": 5, "workerId": WORKER_ID})

    s3 = make_s3()
    try:
        resp = s3.get_object(Bucket=src_bucket, Key=source_id)
        video_bytes = resp["Body"].read()
        post_status(callback, {"status": "processing", "progress": 20, "workerId": WORKER_ID})

        codec = opts.get("codec")
        bitrate = opts.get("bitrate")

        with tempfile.NamedTemporaryFile(suffix=f".{src_fmt}", delete=False) as inf, \
             tempfile.NamedTemporaryFile(suffix=f".{tgt_fmt}", delete=False) as outf:
            inf_path, outf_path = inf.name, outf.name
            inf.write(video_bytes)

        cmd = ["ffmpeg", "-y", "-i", inf_path]
        if codec: cmd += ["-c:v", codec]
        if bitrate: cmd += ["-b:v", bitrate]
        cmd.append(outf_path)

        try:
            result = subprocess.run(cmd, capture_output=True, timeout=1800)
            if result.returncode != 0:
                raise RuntimeError(f"ffmpeg failed: {result.stderr.decode()[:500]}")
            with open(outf_path, "rb") as f:
                out_bytes = f.read()
        finally:
            os.unlink(inf_path)
            try: os.unlink(outf_path)
            except: pass

        post_status(callback, {"status": "processing", "progress": 85, "workerId": WORKER_ID})

        result_key = f"results/{job_id}/{uuid.uuid4()}.{tgt_fmt}"
        mime = VIDEO_FORMAT_MIME.get(tgt_fmt, "video/mp4")
        s3.put_object(Bucket=res_bucket, Key=result_key, Body=out_bytes, ContentType=mime)

        post_status(callback, {"status": "completed", "progress": 100,
                                "resultFileId": result_key, "workerId": WORKER_ID})
        logger.info("video_job_completed", result_key=result_key)

    except Exception as exc:
        logger.error("video_job_failed", error=str(exc))
        post_status(callback, {"status": "failed", "errorMessage": str(exc), "workerId": WORKER_ID})


def run_consumer(redis_client):
    log.info("consumer_started", queue=QUEUE_KEY)
    while not _shutdown:
        try:
            result = redis_client.brpop(QUEUE_KEY, timeout=5)
            if result is None: continue
            _, raw = result
            try:
                envelope = json.loads(raw)
                process_job(envelope.get("data", {}))
            except json.JSONDecodeError as e:
                log.error("envelope_parse_error", error=str(e))
        except redis_lib.exceptions.ConnectionError as e:
            log.error("redis_lost", error=str(e)); time.sleep(5)
        except Exception as e:
            log.error("consumer_error", error=str(e)); time.sleep(1)


if __name__ == "__main__":
    log.info("worker_started", service="video-worker", pid=os.getpid())
    _start_health_server(9090)
    redis_client = make_redis()
    run_consumer(redis_client)
    log.info("worker_stopped", service="video-worker")
