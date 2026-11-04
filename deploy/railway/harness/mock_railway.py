#!/usr/bin/env python3
"""Mock Railway GraphQL API for the openbox-deploy-railway workflow harness.

State lives in the JSON file named by RW_MOCK_STATE so that mutations and
later queries agree, exactly like the real service. Behaviour is chosen by
RW_MOCK_PROFILE. Every request's Authorization header is appended to
RW_MOCK_LOG so the harness can prove the bearer was sent and never leaked.
"""
import json
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

STATE = os.environ["RW_MOCK_STATE"]
PROFILE = os.environ.get("RW_MOCK_PROFILE", "existing")
LOG = os.environ.get("RW_MOCK_LOG", "/tmp/rwh/requests.log")


def load():
    with open(STATE) as fh:
        return json.load(fh)


def save(st):
    with open(STATE, "w") as fh:
        json.dump(st, fh, indent=2)


def err(msg):
    return {"errors": [{"message": msg}]}


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

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(n)
        auth = self.headers.get("Authorization", "<missing>")
        with open(LOG, "a") as fh:
            fh.write(f"{auth}\n")
        try:
            req = json.loads(raw)
        except Exception:
            return self._send(err("request body was not valid JSON"))
        q = req.get("query", "")
        v = req.get("variables", {})
        st = load()

        # ---- queries -------------------------------------------------------
        if re.search(r"project\(id:\$id\)\{id name\}", q):
            if PROFILE == "bad_project":
                return self._send({"data": {"project": {"id": v["id"], "name": "someone-elses-app"}}})
            if v.get("id") != st["project_id"]:
                return self._send(err("Project not found"))
            return self._send({"data": {"project": {"id": st["project_id"], "name": st["project_name"]}}})

        if "environments(first:" in q:
            return self._send({"data": {"project": {"environments": {
                "edges": [{"node": {"id": e["id"], "name": e["name"]}} for e in st["environments"]]}}}})

        if "services(first:" in q:
            return self._send({"data": {"project": {"services": {
                "edges": [{"node": {"id": s["id"], "name": s["name"]}} for s in st["services"]]}}}})

        if q.startswith("query($s:ID!,$e:ID!){serviceInstance") and "latestDeployment" in q:
            svc = st["services"][0] if st["services"] else None
            if svc is None:
                return self._send(err("Service not found"))
            node = {
                "latestDeployment": {"id": svc["latest_deployment"],
                                     "status": svc["status"],
                                     "message": svc.get("message", ""),
                                     "createdAt": "2026-11-04T00:00:00Z"},
                "healthcheckPath": svc.get("healthcheckPath"),
                "volumeCount": svc.get("volumeCount", 0),
                "source": {"image": svc["image"]},
            }
            return self._send({"data": {"serviceInstance": node}})

        if "serviceDomains(" in q:
            if PROFILE in ("domains_single", "no_domain"):
                return self._send(err("Cannot query field 'serviceDomains' on type 'Query'"))
            doms = st["services"][0]["domains"] if st["services"] else []
            return self._send({"data": {"serviceDomains": {"edges": [{"node": {"domain": d}} for d in doms]}}})

        if "serviceDomain(" in q:
            if PROFILE == "no_domain":
                return self._send(err("Cannot query field 'serviceDomain' on type 'Query'"))
            doms = st["services"][0]["domains"] if st["services"] else []
            return self._send({"data": {"serviceDomain": {"domain": doms[0] if doms else None}}})

        if "deployment(id:$id)" in q:
            if PROFILE in ("no_deployment_query", "deployment_fallback"):
                return self._send(err("Cannot query field 'deployment' on type 'Query'"))
            dep = st["deployments_by_id"].get(v["id"])
            if dep is None:
                return self._send({"data": {"deployment": None}})
            return self._send({"data": {"deployment": {"status": dep["status"], "message": dep.get("message", "")}}})

        # ---- mutations -----------------------------------------------------
        if "serviceCreate(" in q:
            st["services"].append({"id": "svc-new", "name": v["input"]["name"],
                                   "image": v["input"]["source"]["image"],
                                   "latest_deployment": "dep-first", "status": "BUILDING",
                                   "healthcheckPath": None, "volumeCount": 0, "domains": []})
            save(st)
            return self._send({"data": {"serviceCreate": {"id": "svc-new", "name": v["input"]["name"]}}})

        if "variableCollectionUpsert(" in q:
            st["variables"] = v["input"]["variables"]
            save(st)
            return self._send({"data": {"variableCollectionUpsert": True}})

        if "volumeCreate(" in q:
            if PROFILE == "volume_rejected":
                return self._send(err("Volume creation is not permitted for this plan"))
            st["services"][0]["volumeCount"] = 1
            st["services"][0]["volume_mount"] = v["input"]["mountPath"]
            save(st)
            return self._send({"data": {"volumeCreate": {"id": "vol-1", "mountPath": v["input"]["mountPath"]}}})

        if "serviceInstanceUpdate(" in q:
            if PROFILE == "config_rejected":
                return self._send(err("Unknown type ServiceInstanceUpdateConfigInput"))
            st["services"][0]["healthcheckPath"] = v["config"]["healthcheckPath"]
            save(st)
            return self._send({"data": {"serviceInstanceUpdate": True}})

        if "serviceDomainCreate(" in q:
            d = "open-box-production.up.railway.app"
            st["services"][0]["domains"] = [d]
            save(st)
            return self._send({"data": {"serviceDomainCreate": {"domain": d}}})

        if "serviceInstanceRedeploy(" in q:
            svc = st["services"][0]
            if PROFILE == "stale":
                # accepted, but the latest deployment never changes
                svc["status"] = "SUCCESS"
            else:
                svc["latest_deployment"] = "dep-new"
                svc["status"] = "BUILDING"
                st["deployments_by_id"]["dep-new"] = {"status": "BUILDING", "message": "Building"}
            save(st)
            return self._send({"data": {"serviceInstanceRedeploy": True}})

        return self._send(err("unhandled operation: " + q[:80]))


HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
