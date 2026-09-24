"""
Unit tests for shared reliable queue consumer.
Requirements: 8.1, 8.5 — Reliable queue pattern with BRPOPLPUSH & ACK (MAJ-05).
"""
import sys
import json
import pytest
from unittest.mock import MagicMock, patch

for mod in ["redis", "structlog"]:
    if mod not in sys.modules:
        sys.modules[mod] = MagicMock()

import queue_consumer


class TestReliableQueueConsumer:
    def test_run_consumer_brpoplpush_and_ack(self):
        mock_redis = MagicMock()

        # Simulate one job in queue, then shutdown
        job_envelope = json.dumps({"data": {"jobId": "test-job-1"}})
        mock_redis.rpoplpush.return_value = None  # No orphans on startup
        mock_redis.brpoplpush.side_effect = [job_envelope, None]

        processed_jobs = []

        def sample_processor(data):
            processed_jobs.append(data["jobId"])
            # Stop consumer after processing
            queue_consumer._shutdown = True

        queue_consumer._shutdown = False
        queue_consumer.run_consumer("test:queue:wait", sample_processor, mock_redis)

        # Verify brpoplpush moved from wait to active
        assert mock_redis.brpoplpush.called
        assert mock_redis.brpoplpush.call_args[0][0] == "test:queue:wait"
        assert mock_redis.brpoplpush.call_args[0][1] == "test:queue:active"

        # Verify job was processed
        assert processed_jobs == ["test-job-1"]

        # Verify job was acknowledged via lrem
        assert mock_redis.lrem.called
        assert mock_redis.lrem.call_args[0][0] == "test:queue:active"
        assert mock_redis.lrem.call_args[0][2] == job_envelope

    def test_run_consumer_recovers_orphans_on_startup(self):
        mock_redis = MagicMock()

        # Simulate 2 orphaned jobs in active queue, then none
        mock_redis.rpoplpush.side_effect = ["job-orphan-1", "job-orphan-2", None]
        mock_redis.brpoplpush.return_value = None

        queue_consumer._shutdown = True  # Stop immediately after startup
        queue_consumer.run_consumer("test:queue:wait", lambda x: None, mock_redis)

        # Verify rpoplpush was called 3 times to drain active queue back to wait queue
        assert mock_redis.rpoplpush.call_count == 3
        assert mock_redis.rpoplpush.call_args[0][0] == "test:queue:active"
        assert mock_redis.rpoplpush.call_args[0][1] == "test:queue:wait"
