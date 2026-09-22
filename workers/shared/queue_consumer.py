"""
Shared queue consumer base for all FileConverter workers.

Each worker imports this module, provides a process_job callback, and calls run().
"""
from __future__ import annotations

import json
import os
import signal
import time
import urllib.request
import urllib.error
from typing import Callable, Any

import redis as redis_lib
import structlog

log = structlog.get_logger()
_shutdown = False


def handle_shutdown(signum, frame):
    global _shutdown
    _shutdown = True
    log.info("shutdown_signal_received", signal=signum)


signal.signal(signal.SIGTERM, handle_shutdown)
signal.signal(signal.SIGINT, handle_shutdown)


REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")


def make_redis_client() -> redis_lib.Redis:
    import urllib.parse
    parsed = urllib.parse.urlparse(REDIS_URL)
    password = parsed.password or None
    host = parsed.hostname or "localhost"
    port = parsed.port or 6379
    db = int((parsed.path or "/0").lstrip("/") or "0")

    for attempt in range(10):
        try:
            client = redis_lib.Redis(
                host=host, port=port, db=db, password=password,
                decode_responses=True, socket_connect_timeout=5, socket_timeout=30,
            )
            client.ping()
            log.info("redis_connected", host=host, port=port)
            return client
        except Exception as exc:
            log.warning("redis_connect_retry", attempt=attempt + 1, error=str(exc))
            time.sleep(2 ** min(attempt, 4))
    raise RuntimeError("Failed to connect to Redis after 10 attempts")


def post_status(callback_url: str, payload: dict) -> None:
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        callback_url, data=body, method="POST",
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


def run_consumer(
    queue_key: str,
    processor: Callable[[dict[str, Any]], None],
    redis_client: redis_lib.Redis,
) -> None:
    log.info("consumer_started", queue=queue_key)
    while not _shutdown:
        try:
            result = redis_client.brpop(queue_key, timeout=5)
            if result is None:
                continue

            _key, raw = result
            try:
                envelope = json.loads(raw)
                job_data = envelope.get("data", {})
            except json.JSONDecodeError as exc:
                log.error("envelope_parse_error", error=str(exc))
                continue

            try:
                processor(job_data)
            except Exception as exc:
                log.error("job_processor_error", error=str(exc), exc_info=True)

        except redis_lib.exceptions.ConnectionError as exc:
            log.error("redis_connection_lost", error=str(exc))
            time.sleep(5)
        except Exception as exc:
            log.error("consumer_loop_error", error=str(exc), exc_info=True)
            time.sleep(1)

    log.info("consumer_stopped", queue=queue_key)
