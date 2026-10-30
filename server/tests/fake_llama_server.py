"""Stand-in for llama-server in process tests: takes the same flags, scripted by FAKE_LLAMA_MODE.

ok: /health answers 503 (loading) briefly, then 200. crash: prints a CUDA error and exits 1.
hang: becomes ready, then stops answering /health.
"""

import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

port = int(sys.argv[sys.argv.index("--port") + 1])
mode = os.environ.get("FAKE_LLAMA_MODE", "ok")
print(f"fake llama-server args: {' '.join(sys.argv[1:])}", flush=True)
print(f"api key from env: {'yes' if os.environ.get('LLAMA_API_KEY') else 'no'}", flush=True)
if mode == "crash":
    print("CUDA error: out of memory", flush=True)
    sys.exit(1)
started = time.monotonic()


class Health(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        age = time.monotonic() - started
        if mode == "hang" and age > 1.0:
            time.sleep(30)
        code = 503 if age < 0.3 else 200
        body = b'{"status":"ok"}' if code == 200 else b'{"error":{"message":"Loading model"}}'
        self.send_response(code if self.path == "/health" else 404)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        pass


class Server(ThreadingHTTPServer):
    # Like llama-server: fail if the port is taken instead of sharing it.
    allow_reuse_address = False


server = Server(("127.0.0.1", port), Health)
print(f"listening on http://127.0.0.1:{port}", flush=True)
server.serve_forever()
