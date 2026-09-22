"""
Unit tests for image worker loop and process_job.
"""
from __future__ import annotations

import io
import json
import sys
from unittest.mock import MagicMock, patch

try:
    import redis
except ImportError:
    sys.modules['redis'] = MagicMock()

try:
    import structlog
except ImportError:
    sys.modules['structlog'] = MagicMock()

from PIL import Image

from src.worker import process_job


def make_test_png(width=100, height=100, color=(255, 0, 0)) -> bytes:
    img = Image.new("RGB", (width, height), color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_process_job_converts_and_uploads():
    job_id = "test-job-456"
    job_data = {
        "jobId": job_id,
        "sourceFileId": "uploads/source.png",
        "sourceFormat": "png",
        "targetFormat": "jpg",
        "options": {"quality": 85},
        "sourceBucket": "fileconverter-uploads",
        "resultBucket": "fileconverter-results",
        "callbackUrl": f"http://orchestrator-service:3003/internal/conversions/{job_id}/status",
    }

    mock_redis = MagicMock()
    mock_src_storage = MagicMock()
    mock_src_storage.download.return_value = make_test_png()

    mock_res_storage = MagicMock()

    status_posts = []

    def fake_post_status(url, payload):
        status_posts.append((url, payload))

    with patch("src.worker._make_storage") as mock_make_storage, \
         patch("src.worker._post_status", side_effect=fake_post_status):

        def storage_factory(bucket):
            if bucket == "fileconverter-uploads":
                return mock_src_storage
            return mock_res_storage

        mock_make_storage.side_effect = storage_factory

        process_job(job_data, mock_redis)

    # 1. Source was downloaded
    mock_src_storage.download.assert_called_once_with("uploads/source.png")

    # 2. Result was uploaded to result bucket
    mock_res_storage.upload.assert_called_once()
    call_args = mock_res_storage.upload.call_args
    result_key = call_args[0][0]
    result_bytes = call_args[0][1]
    content_type = call_args[1].get("content_type")

    assert result_key.startswith(f"results/{job_id}/")
    assert result_key.endswith(".jpg")
    assert content_type == "image/jpeg"

    # Verify uploaded bytes are a valid JPEG
    out_img = Image.open(io.BytesIO(result_bytes))
    assert out_img.format == "JPEG"

    # 3. Status callbacks: processing at multiple steps and completed
    assert len(status_posts) >= 2
    final_url, final_payload = status_posts[-1]
    assert final_url == job_data["callbackUrl"]
    assert final_payload["status"] == "completed"
    assert final_payload["progress"] == 100
    assert final_payload["resultFileId"] == result_key
