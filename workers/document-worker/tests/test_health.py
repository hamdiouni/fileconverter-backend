"""
Unit tests for document worker health handler.
"""
from __future__ import annotations

import io
import json
import sys
from unittest.mock import MagicMock

try:
    import redis
except ImportError:
    sys.modules['redis'] = MagicMock()

try:
    import structlog
except ImportError:
    sys.modules['structlog'] = MagicMock()

try:
    import boto3
except ImportError:
    sys.modules['boto3'] = MagicMock()

import src.worker as worker_mod
from src.worker import _HealthHandler


def test_health_handler_ok():
    mock_redis = MagicMock()
    mock_redis.ping.return_value = True

    worker_mod._redis_client_for_health = mock_redis

    handler = _HealthHandler.__new__(_HealthHandler)
    handler.path = "/health"
    handler.wfile = io.BytesIO()

    responses = []
    headers = {}

    def send_response(code):
        responses.append(code)

    def send_header(k, v):
        headers[k] = v

    def end_headers():
        pass

    handler.send_response = send_response
    handler.send_header = send_header
    handler.end_headers = end_headers

    handler.do_GET()

    assert responses == [200]
    payload = json.loads(handler.wfile.getvalue().decode("utf-8"))
    assert payload["status"] == "ok"
    assert payload["checks"]["redis"] == "ok"


def test_health_handler_degraded():
    mock_redis = MagicMock()
    mock_redis.ping.side_effect = Exception("Redis connection refused")

    worker_mod._redis_client_for_health = mock_redis

    handler = _HealthHandler.__new__(_HealthHandler)
    handler.path = "/health"
    handler.wfile = io.BytesIO()

    responses = []
    headers = {}

    def send_response(code):
        responses.append(code)

    def send_header(k, v):
        headers[k] = v

    def end_headers():
        pass

    handler.send_response = send_response
    handler.send_header = send_header
    handler.end_headers = end_headers

    handler.do_GET()

    assert responses == [503]
    payload = json.loads(handler.wfile.getvalue().decode("utf-8"))
    assert payload["status"] == "degraded"
    assert "error" in payload["checks"]["redis"]
