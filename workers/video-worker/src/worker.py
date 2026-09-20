"""Video worker entry point skeleton."""
from __future__ import annotations
import signal
import structlog

log = structlog.get_logger()
_shutdown = False

def handle_shutdown(signum, frame):
    global _shutdown
    _shutdown = True
    log.info("shutdown_signal_received", signal=signum)

signal.signal(signal.SIGTERM, handle_shutdown)
signal.signal(signal.SIGINT, handle_shutdown)
