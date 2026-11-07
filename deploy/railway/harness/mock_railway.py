#!/usr/bin/env python3
"""Mock Railway GraphQL API for the openbox-deploy-railway workflow harness.

State lives in the JSON file named by RW_MOCK_STATE so that mutations and
later queries agree, exactly like the real service. Behaviour is chosen by
RW_MOCK_PROFILE. Every request's Authorization header is appended to
RW_MOCK_LOG so the harness can prove the bearer was sent and never leaked.

The shapes here are transcribed from Railway's live introspection schema
(`railway api schema`, read 2026-11-07) rather than from the client's own
assumptions:

  * every id-ish argument is String!, never ID!
  * the public domain hangs off ServiceInstance.domains, split into
    serviceDomains and customDomains; Query has no serviceDomains/serviceDomain
  * a volume's mount lives on a VolumeInstance, not on Volume, and
    ServiceInstance has no volumeCount
  * serviceInstanceUpdate takes `input`, not `config`
  * a deployment carries `diagnosis`, not `message`

The mock also rejects the two request defects the real API rejects before it
runs anything, so a regression fails here instead of in production: a variable
declared ID! where the schema wants String!, and a declared variable the
document never uses.
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


def err(msg, code="GRAPHQL_VALIDATION_FAILED"):
    return {"errors": [{"message": msg, "extensions": {"code": code}}]}


def operation_defects(q):
    """Return the schema-level mistake Railway would refuse before running."""
    head = re.match(r"\s*(?:query|mutation)\s*\(([^)]*)\)", q)
    declared = re.findall(r"\$(\w+)\s*:\s*([^,)]+)", head.group(1)) if head else []
    body = q[head.end():] if head else q
    for name, vtype in declared:
        vtype = vtype.strip()
        if vtype.startswith("ID"):
            return err('Variable "$%s" of type "%s" used in position expecting type "String!".'
                       % (name, vtype))
        if not re.search(r"\$" + re.escape(name) + r"\b", body):
            return err('Variable "$%s" is never used.' % name)
    return None


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

        bad = operation_defects(q)
        if bad is not None:
            return self._send(bad)

        st = load()
        services = st["services"]
        svc = services[0] if services else None

        def domains_of(s):
            d = s.get("domains") or {}
            return d.get("service", []), d.get("custom", [])

        # ---- queries -------------------------------------------------------
        # Exact form, not a substring: the environments and services documents
        # also start with project(id:$id) and contain "id name" inside node{...}.
        if re.search(r"project\(id:\$id\)\{id name\}", q):
            if PROFILE == "bad_project":
                return self._send({"data": {"project": {"id": v["id"], "name": "someone-elses-app"}}})
            if v.get("id") != st["project_id"]:
                return self._send(err("Project not found", "INTERNAL_SERVER_ERROR"))
            return self._send({"data": {"project": {"id": st["project_id"], "name": st["project_name"]}}})

        if "environments(first:" in q:
            return self._send({"data": {"project": {"environments": {
                "edges": [{"node": {"id": e["id"], "name": e["name"]}} for e in st["environments"]]}}}})

        if "services(first:" in q:
            return self._send({"data": {"project": {"services": {
                "edges": [{"node": {"id": s["id"], "name": s["name"]}} for s in services]}}}})

        if "volumes(first:" in q:
            return self._send({"data": {"project": {"volumes": {
                "edges": [{"node": {"id": vol["id"], "volumeInstances": {"edges": [
                    {"node": inst} for inst in vol.get("instances", [])]}}}
                    for vol in st.get("volumes", [])]}}}})

        if "serviceInstance(serviceId:$s" in q:
            if svc is None:
                # The real API answers a missing service with an authorization
                # error, because the service id resolves to nothing it may read.
                return self._send(err("Not Authorized", "INTERNAL_SERVER_ERROR"))
            sd, cd = domains_of(svc)
            dep = {"id": svc["latest_deployment"], "status": svc["status"],
                   "createdAt": "2026-11-04T00:00:00Z",
                   "diagnosis": svc.get("diagnosis")}
            return self._send({"data": {"serviceInstance": {
                "latestDeployment": dep,
                "healthcheckPath": svc.get("healthcheckPath"),
                "source": {"image": svc["image"]},
                "domains": {
                    "serviceDomains": [{"domain": d} for d in sd],
                    "customDomains": [{"domain": d} for d in cd],
                },
            }}})

        if "deployment(id:$id)" in q:
            if PROFILE == "deployment_fallback":
                return self._send(err("Cannot query field 'deployment' on type 'Query'"))
            dep = st["deployments_by_id"].get(v["id"])
            if dep is None:
                return self._send(err("Deployment not found", "INTERNAL_SERVER_ERROR"))
            return self._send({"data": {"deployment": {"status": dep["status"],
                                                       "diagnosis": dep.get("diagnosis")}}})

        if "serviceDomains(" in q or "serviceDomain(" in q:
            # No such root field exists. Going back to the guessed shape must
            # fail here, not in production.
            return self._send(err("Cannot query field on type 'Query' (serviceDomain does not exist)"))

        # ---- mutations -----------------------------------------------------
        if "serviceCreate(" in q:
            services.append({"id": "svc-new", "name": v["input"]["name"],
                             "image": v["input"]["source"]["image"],
                             "latest_deployment": "dep-first", "status": "BUILDING",
                             "healthcheckPath": None,
                             "domains": {"service": ["open-box-production.up.railway.app"], "custom": []}})
            save(st)
            return self._send({"data": {"serviceCreate": {"id": "svc-new", "name": v["input"]["name"]}}})

        if "variableCollectionUpsert(" in q:
            st["variables"] = v["input"]["variables"]
            save(st)
            return self._send({"data": {"variableCollectionUpsert": True}})

        if "volumeCreate(" in q:
            if PROFILE == "volume_rejected":
                return self._send(err("Volume creation is not permitted for this plan", "INTERNAL_SERVER_ERROR"))
            st.setdefault("volumes", []).append({"id": "vol-1", "instances": [{
                "serviceId": svc["id"], "environmentId": v["input"]["environmentId"],
                "mountPath": v["input"]["mountPath"]}]})
            save(st)
            return self._send({"data": {"volumeCreate": {"id": "vol-1"}}})

        if "serviceInstanceUpdate(" in q:
            if PROFILE == "config_rejected":
                return self._send(err("Not Authorized", "INTERNAL_SERVER_ERROR"))
            svc["healthcheckPath"] = v["input"]["healthcheckPath"]
            save(st)
            return self._send({"data": {"serviceInstanceUpdate": True}})

        if "serviceDomainCreate(" in q:
            d = "open-box-production.up.railway.app"
            svc.setdefault("domains", {}).setdefault("service", [])
            if d not in svc["domains"]["service"]:
                svc["domains"]["service"].append(d)
            save(st)
            return self._send({"data": {"serviceDomainCreate": {"domain": d}}})

        if "serviceInstanceRedeploy(" in q:
            if PROFILE == "stale":
                # accepted, but the latest deployment never changes
                svc["status"] = "SUCCESS"
            else:
                svc["latest_deployment"] = "dep-new"
                svc["status"] = "BUILDING"
                st["deployments_by_id"]["dep-new"] = {"status": "BUILDING", "diagnosis": None}
            save(st)
            return self._send({"data": {"serviceInstanceRedeploy": True}})

        return self._send(err("unhandled operation: " + q[:80]))


HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
