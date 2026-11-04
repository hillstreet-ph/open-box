#!/usr/bin/env python3
"""Mock Cloudflare Workers API for the openbox-deploy-railway workflow harness.

It models the one endpoint the cutover step uses — the Worker *settings* PATCH
that rewrites the ORIGIN_URL binding — with the semantics that were measured
against the real API on a scratch Worker:

  * the PATCH body is multipart/form-data with a single part named "settings"
    holding {"bindings": [...]} as application/json;
  * bindings that the payload omits because they are secret_text survive on the
    server (the API has no way to restate a secret it cannot read back);
  * the zone routes are a separate resource and a settings PATCH does not touch
    them.

State lives in the JSON file named by CF_MOCK_STATE so a PATCH and the later
read agree, exactly like the real service. Behaviour is chosen by
CF_MOCK_PROFILE. Every request's Authorization header is appended to CF_MOCK_LOG
so the harness can prove the bearer was sent and never leaked.
"""
import json
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

STATE = os.environ["CF_MOCK_STATE"]
PROFILE = os.environ.get("CF_MOCK_PROFILE", "existing")
LOG = os.environ.get("CF_MOCK_LOG", "/tmp/cfh/requests.log")


def load():
    with open(STATE) as fh:
        return json.load(fh)


def save(st):
    with open(STATE, "w") as fh:
        json.dump(st, fh, indent=2)


def envelope(result, code=200):
    return {"success": True, "errors": [], "messages": [], "result": result}, code


def failure(code, msg, http=400):
    return {"success": False, "errors": [{"code": code, "message": msg}], "messages": [], "result": None}, http


def form_part(raw, ctype, want):
    """Return the body of the multipart part whose name is `want`, or None."""
    m = re.search(r'boundary="?([^";]+)"?', ctype or "")
    if not m:
        return None
    boundary = ("--" + m.group(1)).encode()
    for chunk in raw.split(boundary):
        if b"\r\n\r\n" not in chunk:
            continue
        head, body = chunk.split(b"\r\n\r\n", 1)
        if ('name="%s"' % want) in head.decode("utf-8", "replace"):
            return body.decode("utf-8", "replace").strip("\r\n")
    return None


def view_bindings(st, worker):
    """Return the worker's bindings after the profile's read-time distortion."""
    w = next(x for x in st["workers"] if x["name"] == worker)
    binds = [dict(b) for b in w["bindings"]]
    if PROFILE == "no_origin_binding":
        binds = [b for b in binds if b["name"] != "ORIGIN_URL"]
    elif PROFILE == "already_railway":
        for b in binds:
            if b["name"] == "ORIGIN_URL":
                b["text"] = "https://open-box-production.up.railway.app"
    elif PROFILE == "origin_is_secret":
        for b in binds:
            if b["name"] == "ORIGIN_URL":
                b.clear()
                b.update({"type": "secret_text", "name": "ORIGIN_URL"})
    return binds


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        st = load()
        path = self.path.split("?", 1)[0]
        query = self.path.split("?", 1)[1] if "?" in self.path else ""
        with open(LOG, "a") as fh:
            fh.write("GET %s %s\n" % (path, self.headers.get("Authorization", "<missing>")))

        # ---- accounts ------------------------------------------------------
        if path == "/client/v4/accounts":
            return self._send(*envelope(st["accounts"]))

        # ---- zone lookup (route verification) ------------------------------
        if path == "/client/v4/zones":
            if PROFILE == "zone_unreadable":
                return self._send(*failure(7002, "Could not read the zone list", 403))
            name = ""
            m = re.search(r"(?:^|&)name=([^&]*)", "&" + query)
            if m:
                name = m.group(1)
            zones = [z for z in st["zones"] if not name or z["name"] == name]
            return self._send(*envelope(zones))

        m = re.match(r"^/client/v4/zones/([^/]+)/routes$", path)
        if m:
            routes = [r for r in st["routes"] if r["zone_id"] == m.group(1)]
            if PROFILE == "route_detached":
                routes = []
            return self._send(*envelope(routes))

        # ---- worker ownership + settings -----------------------------------
        m = re.match(r"^/client/v4/accounts/([^/]+)/workers/scripts/([^/]+)(/settings)?$", path)
        if not m:
            return self._send(*failure(7000, "unknown path " + path, 404))
        acct, worker, is_settings = m.group(1), m.group(2), bool(m.group(3))
        known = [w["name"] for w in st["workers"]]
        owns = acct in st["worker_accounts"].get(worker, [])
        if worker not in known or not owns:
            return self._send(*failure(10007, "The Worker you are trying to access does not exist", 404))
        w = next(x for x in st["workers"] if x["name"] == worker)
        if not is_settings:
            return self._send(*envelope({"id": worker, "tag": w["tag"], "last_deployed_from": "api"}))
        return self._send(*envelope({"bindings": view_bindings(st, worker)}))

    def do_PATCH(self):
        st = load()
        with open(LOG, "a") as fh:
            fh.write("PATCH %s %s\n" % (self.path, self.headers.get("Authorization", "<missing>")))
        m = re.match(r"^/client/v4/accounts/([^/]+)/workers/scripts/([^/]+)/settings$", self.path)
        if not m:
            return self._send(*failure(7000, "unknown path " + self.path, 404))
        acct, worker = m.group(1), m.group(2)
        if worker not in [w["name"] for w in st["workers"]] or acct not in st["worker_accounts"].get(worker, []):
            return self._send(*failure(10007, "The Worker you are trying to access does not exist", 404))
        n = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(n)
        if PROFILE == "patch_rejected":
            return self._send(*failure(10000, "Unknown Error", 400))
        # The real API answers 10201 when the settings part is missing and
        # 10001 when the body is not multipart at all.
        if "multipart/form-data" not in (self.headers.get("Content-Type") or ""):
            return self._send(*failure(10001, "Could not parse the request as multipart/form-data", 415))
        part = form_part(raw, self.headers.get("Content-Type"), "settings")
        if part is None:
            return self._send(*failure(10201, "Missing settings part in multipart upload", 400))
        try:
            new = json.loads(part)
        except Exception:
            return self._send(*failure(10001, "settings part was not valid JSON", 400))
        if not isinstance(new.get("bindings"), list) or not new["bindings"]:
            return self._send(*failure(10001, "bindings must be a non-empty array", 400))
        w = next(x for x in st["workers"] if x["name"] == worker)
        # secrets omitted from the payload are preserved, everything else is
        # replaced wholesale — this is the measured real behaviour.
        kept_secrets = [b for b in w["bindings"] if b.get("type") == "secret_text"]
        secret_names = {b["name"] for b in kept_secrets}
        submitted = new["bindings"]
        if any(b.get("type") == "secret_text" for b in submitted):
            return self._send(*failure(10079, "secret_text values cannot be written through the settings endpoint", 400))
        w["bindings"] = sorted(kept_secrets + submitted, key=lambda b: b.get("name", ""))
        save(st)
        return self._send(*envelope({"success": True}))


HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
