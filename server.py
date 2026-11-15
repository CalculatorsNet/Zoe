"""Small stdlib web server for the Zoe prototype."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
import json
import mimetypes
import sys

from models import analyze_field, load_demo

ROOT = Path(__file__).resolve().parent
mimetypes.add_type("font/ttf", ".ttf")


class Handler(BaseHTTPRequestHandler):
    def _json(self, payload, status=200):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/health":
            return self._json({"status": "ready", "service": "Zoe", "live_source": "NASA POWER daily point API"})
        if path == "/api/demo":
            return self._json(load_demo())
        target = ROOT / ("index.html" if path == "/" else path.lstrip("/"))
        try:
            target.resolve().relative_to(ROOT.resolve())
            body = target.read_bytes()
        except (ValueError, FileNotFoundError, IsADirectoryError):
            return self._json({"error": "Not found"}, 404)
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(str(target))[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if urlparse(self.path).path != "/api/analyze":
            return self._json({"error": "Not found"}, 404)
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size > 100_000:
                return self._json({"error": "Request too large"}, 413)
            request = json.loads(self.rfile.read(size))
            polygon = request.get("polygon")
            priorities = request.get("priorities", {})
            if not polygon or not isinstance(polygon, dict):
                return self._json({"error": "Draw a field boundary before running the analysis."}, 400)
            return self._json(analyze_field(polygon, priorities))
        except (ValueError, KeyError, TypeError) as exc:
            return self._json({"error": str(exc)}, 400)
        except Exception as exc:
            return self._json({"error": "Analysis could not complete. Try the saved field or check your connection.", "detail": str(exc)}, 502)

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))


if __name__ == "__main__":
    try:
        port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
        if not 1 <= port <= 65535:
            raise ValueError
    except ValueError:
        raise SystemExit("Usage: python server.py [port] (port must be 1–65535)")
    address = ("127.0.0.1", port)
    print(f"Zoe listening at http://{address[0]}:{address[1]}")
    ThreadingHTTPServer(address, Handler).serve_forever()
