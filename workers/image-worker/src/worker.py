"""Image worker entry point — minimal skeleton for testability."""
from __future__ import annotations
import signal
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import structlog

log = structlog.get_logger()
_shutdown = False


# ── Health HTTP server (required by Docker HEALTHCHECK) ───────────────────────

class _HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            body = b'{"status":"ok"}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, *args):  # silence access logs
        pass


def _start_health_server(port: int = 9090):
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

# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    log.info("worker_started", service="image-worker")
    _start_health_server(9090)
    log.info("health_server_started", port=9090)

    while not _shutdown:
        time.sleep(1)

    log.info("worker_stopped", service="image-worker")
