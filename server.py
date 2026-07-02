#!/usr/bin/env python3
"""Static file server with REST API for cross-device data sync.
Binds to 0.0.0.0 so any device on the same WiFi can reach it.

Endpoints:
  GET  /api/sync   → returns data.json (all topics/subtopics/questions/submissions)
  POST /api/sync   → saves data.json
  Everything else → serves static files from this directory
"""
import os
import json
import socket
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(ROOT, 'data.json')
PORT = int(os.environ.get('PORT', 8768))

os.chdir(ROOT)


class AppHandler(SimpleHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == '/api/sync':
            self._serve_json(self._load_data())
        else:
            super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)

        if path == '/api/sync':
            try:
                data = json.loads(body)
                with open(DATA_FILE, 'w') as f:
                    json.dump(data, f)
                self._serve_json({'ok': True})
            except Exception as e:
                self._serve_json({'error': str(e)}, 500)
        else:
            self.send_response(404)
            self._cors()
            self.end_headers()

    def _load_data(self):
        try:
            with open(DATA_FILE) as f:
                return json.load(f)
        except Exception:
            return {}

    def _serve_json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(body))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def log_message(self, fmt, *args):
        pass  # quiet


def _local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return 'unknown'


if __name__ == '__main__':
    ip = _local_ip()
    print(f'Desktop: http://localhost:{PORT}')
    print(f'Phone:   http://{ip}:{PORT}  (same WiFi)')
    HTTPServer(('0.0.0.0', PORT), AppHandler).serve_forever()
