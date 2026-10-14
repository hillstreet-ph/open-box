"""Test a published Open-Box container with an isolated, ephemeral SQLite DB."""

import json
import os
import re
import secrets
import subprocess
import time
import urllib.error
import urllib.request


def docker(*args):
    return subprocess.check_output(["docker", *args], text=True).strip()


image = os.environ["OPENBOX_TEST_IMAGE"]
if not re.fullmatch(r"(?:docker\.io/)?hillstreet/open-box@sha256:[0-9a-f]{64}", image):
    raise SystemExit("Expected an immutable hillstreet/open-box SHA256 digest")

name = "openbox-smoke-" + secrets.token_hex(6)
password = secrets.token_urlsafe(32)
os.environ["OPENLIST_ADMIN_PASSWORD"] = password
base = ""


def request(path, body=None, headers=None, method=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        base + path, data=data,
        headers={"Content-Type": "application/json", **(headers or {})},
        method=method,
    )
    try:
        response = urllib.request.urlopen(req, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        raw = response.read()
        try:
            content = json.loads(raw)
        except ValueError:
            content = raw.decode()
        return response.status, response.headers, content


try:
    docker("pull", image)
    docker(
        "run", "-d", "--name", name, "--log-driver=none",
        "-p", "127.0.0.1::5244", "-e", "OPENLIST_ADMIN_PASSWORD",
        "-e", "DB_TYPE=sqlite3", image,
    )
    port = docker("port", name, "5244/tcp").rsplit(":", 1)[1]
    base = "http://127.0.0.1:" + port
    for attempt in range(60):
        try:
            if request("/ping")[0] == 200:
                break
        except (urllib.error.URLError, TimeoutError):
            pass
        time.sleep(1)
    else:
        raise AssertionError("Container did not become healthy")

    status, _, login = request("/api/auth/login", {"username": "admin", "password": password})
    assert status == 200 and login["code"] == 200, "Isolated admin login failed"
    token = login["data"]["token"]
    headers = {"Authorization": token, "Accept": "application/json, text/event-stream"}
    status, _, user = request("/api/me", headers=headers)
    assert status == 200 and user["code"] == 200, "Authenticated user lookup failed"
    _, _, denied = request("/api/me")
    assert isinstance(denied, dict) and denied["code"] in (401, 403), "Anonymous user not denied"

    def rpc(method, params=None, message_id=1):
        body = {"jsonrpc": "2.0", "method": method}
        if message_id is not None:
            body["id"] = message_id
        if params is not None:
            body["params"] = params
        return request("/mcp", body, headers)

    status, init_headers, init = rpc("initialize", {
        "protocolVersion": "2025-11-25", "capabilities": {},
        "clientInfo": {"name": "openbox-release-smoke", "version": "1"},
    })
    assert status == 200 and init["result"]["serverInfo"]["name"] == "Open-Box MCP", "MCP branding failed"
    headers["MCP-Session-Id"] = init_headers["MCP-Session-Id"]
    headers["MCP-Protocol-Version"] = "2025-11-25"
    assert rpc("notifications/initialized", message_id=None)[0] == 202
    _, _, catalog = rpc("tools/list")
    names = {tool["name"] for tool in catalog["result"]["tools"]}
    assert names == {"openbox.fs.list", "openbox.fs.get", "openbox.fs.link"}, "Unexpected MCP catalog"
    for canonical in sorted(names):
        # Missing required path must take the same validation path for legacy aliases.
        _, _, current = rpc("tools/call", {"name": canonical, "arguments": {}})
        _, _, legacy = rpc("tools/call", {"name": canonical.replace("openbox.", "openlist."), "arguments": {}})
        assert current == legacy and ("error" in current or current.get("result", {}).get("isError")), "Legacy alias mismatch"
    assert request("/mcp", headers=headers, method="DELETE")[0] in (200, 204)
    assert rpc("tools/list")[0] == 404, "Deleted MCP session remained usable"
    docker("stop", "--time", "20", name)
    assert docker("inspect", "--format", "{{.State.ExitCode}}", name) == "0", "Unclean shutdown"
    print("PASS: immutable image, startup, login, anonymous denial, MCP branding/catalog/aliases/session deletion, clean shutdown")
    print("Verified image:", image)
finally:
    subprocess.run(["docker", "rm", "-f", name], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    os.environ.pop("OPENLIST_ADMIN_PASSWORD", None)
