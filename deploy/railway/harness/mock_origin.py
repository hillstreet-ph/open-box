#!/usr/bin/env python3
"""Mock Open-Box origin for the production-gate harness.

Answers the exact routes the gate probes so the shipped shell can be executed
unchanged against a known-good and a known-bad runtime.
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

SITE_NAME = os.environ.get("RW_ORIGIN_SITE_NAME", "Open-Box")
ASSET = os.environ.get("RW_ORIGIN_ASSET", "index-DXZYoYrc.js")
VERSION = os.environ.get("RW_ORIGIN_VERSION", "v4.2.11")
PAT = os.environ.get("RW_ORIGIN_PAT", "scoped")          # scoped | legacy
TOKEN_LIST = os.environ.get("RW_ORIGIN_TOKEN", "json")   # json | spa
LIST_CODE = int(os.environ.get("RW_ORIGIN_LIST", "200"))
DOWN = os.environ.get("RW_ORIGIN_DOWN") == "1"


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json"):
        b = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if DOWN:
            return self._send(502, "bad gateway", "text/plain")
        if self.path == "/ping":
            return self._send(200, "pong", "text/plain")
        if self.path == "/":
            return self._send(200, f"<html><script src='/assets/{ASSET}'></script></html>", "text/html")
        if self.path.startswith("/api/public/settings"):
            return self._send(200, json.dumps({"code": 200, "data": {
                "site_name": SITE_NAME, "version": VERSION, "allow_mounted": True}}))
        if self.path.startswith("/api/me/token/list"):
            if TOKEN_LIST == "spa":
                return self._send(200, "<!DOCTYPE html><html>SPA</html>", "text/html")
            return self._send(200, json.dumps({"code": 401, "message": "Invalid or expired access token"}))
        return self._send(404, json.dumps({"code": 404, "message": "not found"}))

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        self.rfile.read(n)
        if DOWN:
            return self._send(502, "bad gateway", "text/plain")
        if self.path == "/api/fs/list":
            auth = self.headers.get("Authorization", "")
            if auth:
                if PAT == "legacy":
                    return self._send(200, json.dumps({"code": 401, "message": "token is invalidated"}))
                return self._send(200, json.dumps({"code": 401, "message": "Invalid or expired access token"}))
            return self._send(200, json.dumps({"code": LIST_CODE, "data": {"content": []}}))
        return self._send(404, json.dumps({"code": 404}))


HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
