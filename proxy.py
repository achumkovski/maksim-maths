#!/usr/bin/env python3
"""Local proxy that forwards requests to the Salesforce internal Claude gateway,
adding the required auth headers. The browser app talks to localhost (no CORS issues),
and this proxy handles all authentication transparently."""
import os
import json
import urllib.request
import urllib.error
from http.server import HTTPServer, BaseHTTPRequestHandler

# Read from env first; fall back to config file written by Claude Code's Bash environment
_cfg = {}
_cfg_path = os.path.join(os.path.dirname(__file__), '.proxy-config.json')
try:
    with open(_cfg_path) as _f:
        _cfg = json.load(_f)
except Exception:
    pass

BASE_URL   = (os.environ.get('ANTHROPIC_BASE_URL') or _cfg.get('base_url', '')).rstrip('/')
TOKEN      = os.environ.get('ANTHROPIC_AUTH_TOKEN') or _cfg.get('token', '')
CUSTOM_HDR = os.environ.get('ANTHROPIC_CUSTOM_HEADERS') or _cfg.get('custom_headers', '')
PORT       = int(os.environ.get('PORT', 8770))

# Parse extra headers from "Name: Value\nName2: Value2" format
EXTRA_HEADERS = {}
for line in CUSTOM_HDR.splitlines():
    if ':' in line:
        k, _, v = line.partition(':')
        EXTRA_HEADERS[k.strip()] = v.strip()


class ProxyHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_POST(self):
        target = BASE_URL + self.path   # /v1/messages stays as-is
        length = int(self.headers.get('Content-Length', 0))
        body   = self.rfile.read(length)

        req = urllib.request.Request(target, data=body, method='POST')
        req.add_header('Content-Type', 'application/json')
        req.add_header('anthropic-version', '2023-06-01')
        if TOKEN:
            req.add_header('Authorization', f'Bearer {TOKEN}')
        for k, v in EXTRA_HEADERS.items():
            req.add_header(k, v)

        try:
            with urllib.request.urlopen(req) as resp:
                data = resp.read()
                self.send_response(200)
                self._cors()
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            data = e.read()
            self.send_response(e.code)
            self._cors()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(data)

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, anthropic-version, anthropic-dangerous-direct-browser-calls')

    def log_message(self, fmt, *args):
        pass  # quiet


if __name__ == '__main__':
    if not BASE_URL:
        print('ERROR: ANTHROPIC_BASE_URL not set')
    elif not TOKEN:
        print('WARNING: ANTHROPIC_AUTH_TOKEN not set')
    else:
        print(f'Gateway: {BASE_URL}')
        print(f'Token:   {len(TOKEN)} chars, extra headers: {list(EXTRA_HEADERS.keys())}')
    print(f'Proxy running on http://0.0.0.0:{PORT}  (LAN-accessible)')
    HTTPServer(('0.0.0.0', PORT), ProxyHandler).serve_forever()
