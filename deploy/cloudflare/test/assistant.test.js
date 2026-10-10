import test from "node:test";
import assert from "node:assert/strict";
import { handleAssistant, validateAction, filePath } from "../src/assistant.js";
import { ASSISTANT_WIDGET } from "../src/assistant-widget.js";
import worker from "../src/worker.js";

const env = {
  ORIGIN_URL: "https://origin.example",
  SUPABASE_URL: "https://auth.example",
  SUPABASE_PUBLISHABLE_KEY: "test-public",
  AI: {
    run: async () => ({
      response: JSON.stringify({
        message: "Inspect the requested folder.",
        action: { tool: "list", path: "/Workspace" },
      }),
    }),
  },
};
function request(route, body, headers = {}) {
  return new Request(`https://open-box.space/api/open-box/assistant/${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: "test-user-session", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
function stub(t, run) {
  const original = globalThis.fetch;
  globalThis.fetch = run;
  t.after(() => {
    globalThis.fetch = original;
  });
}
function me(user = {}) {
  return Response.json({
    code: 200,
    data: { id: 1, role: 2, username: "admin", disabled: false, ...user },
  });
}

test("native identity redirects are rejected without forwarding the session", async (t) => {
  let calls = 0;
  stub(t, async (_url, options) => {
    calls += 1;
    assert.equal(options.redirect, "manual");
    return new Response(null, {
      status: 302,
      headers: { Location: "https://outside.example" },
    });
  });
  const response = await handleAssistant(request("session"), env);
  assert.equal(response.status, 503);
  assert.equal(calls, 1);
  assert.doesNotMatch(
    await response.text(),
    /outside.example|test-user-session/,
  );
});

test("assistant rejects a null body rather than treating it as an outage", async (t) => {
  stub(t, async () => me());
  assert.equal(
    (await handleAssistant(request("execute", null), env)).status,
    400,
  );
});

test("a failed file request is contained and never automatically retried", async (t) => {
  let operations = 0;
  stub(t, async (url) => {
    if (new URL(url).pathname === "/api/me") return me();
    operations += 1;
    throw new Error("upstream connection closed");
  });
  const response = await handleAssistant(
    request("execute", {
      action: { tool: "mkdir", path: "/Workspace/Test" },
      confirmed: true,
    }),
    env,
  );
  assert.equal(response.status, 503);
  assert.equal(operations, 1);
  assert.equal((await response.json()).error, "assistant_unavailable");
});

test("assistant requires a native session before model or backend execution", async (t) => {
  stub(t, () => {
    throw new Error("must not fetch");
  });
  const response = await worker.fetch(
    new Request("https://open-box.space/api/open-box/assistant/chat", {
      method: "POST",
      body: "{}",
    }),
    env,
  );
  assert.equal(response.status, 401);
});

test("assistant rejects foreign origins before backend access", async (t) => {
  stub(t, () => {
    throw new Error("must not fetch");
  });
  assert.equal(
    (
      await handleAssistant(
        request(
          "chat",
          { prompt: "List files" },
          { Origin: "https://attacker.example" },
        ),
        env,
      )
    ).status,
    403,
  );
});

test("assistant rejects expired, guest, disabled and malformed identities", async (t) => {
  for (const response of [
    Response.json({ code: 401 }),
    me({ role: 1 }),
    me({ disabled: true }),
    me({ id: "1" }),
    me({ role: undefined }),
  ]) {
    stub(t, async () => response);
    assert.equal((await handleAssistant(request("session"), env)).status, 401);
  }
});

test("assistant session returns capabilities without secret identity fields", async (t) => {
  stub(t, async () =>
    me({ password: "must-not-return", sso_id: "private-link" }),
  );
  const response = await handleAssistant(request("session"), env);
  const body = await response.json();
  assert.equal(body.assistant, "Agent Assistant");
  assert.deepEqual(body.user, { id: 1, username: "admin" });
  assert.equal(body.writes_require_confirmation, true);
});

test("path and action validation reject traversal, encoded separators, URLs and admin operations", () => {
  for (const path of [
    "https://outside.example",
    "/../secret",
    "/a/./b",
    "/a//b",
    "/a\\b",
    "/%2e%2e/secret",
    "/a\u0000b",
  ])
    assert.throws(() => filePath(path));
  for (const tool of ["remove", "shell", "fetch", "admin", "move"])
    assert.throws(() => validateAction({ tool, path: "/Workspace" }));
  assert.throws(() =>
    validateAction({
      tool: "copy",
      src_dir: "/Workspace",
      dst_dir: "/Workspace/Documents",
      names: ["../secret"],
    }),
  );
  assert.deepEqual(
    validateAction({
      tool: "rename",
      path: "/Workspace/A.txt",
      name: "B.txt",
      overwrite: true,
      url: "https://outside.example",
    }),
    {
      tool: "rename",
      path: "/Workspace/A.txt",
      name: "B.txt",
      overwrite: false,
    },
  );
});

test("chat plans do not execute file writes", async (t) => {
  let calls = 0;
  stub(t, async () => {
    calls++;
    return me();
  });
  const ai = {
    run: async () => ({
      response: JSON.stringify({
        message: "Create the requested folder after review.",
        action: { tool: "mkdir", path: "/Workspace/Reports" },
      }),
    }),
  };
  const result = await (
    await handleAssistant(
      request("chat", { prompt: "Create Reports", path: "/Workspace" }),
      { ...env, AI: ai },
    )
  ).json();
  assert.equal(result.requires_confirmation, true);
  assert.equal(calls, 1);
});

test("untrusted model plans cannot introduce new endpoints or traversal", async (t) => {
  stub(t, async () => me());
  for (const action of [
    { tool: "shell", command: "whoami" },
    { tool: "list", path: "/../secret" },
  ]) {
    const ai = {
      run: async () => ({
        response: JSON.stringify({ message: "proposal", action }),
      }),
    };
    assert.equal(
      (
        await handleAssistant(request("chat", { prompt: "Help", path: "/" }), {
          ...env,
          AI: ai,
        })
      ).status,
      422,
    );
  }
});

test("oversized authenticated request bodies are rejected", async (t) => {
  stub(t, async () => me());
  assert.equal(
    (await handleAssistant(request("chat", { prompt: "x".repeat(20000) }), env))
      .status,
    400,
  );
});

test("writes without confirmation do not call the file endpoint", async (t) => {
  let calls = 0;
  stub(t, async () => {
    calls++;
    return me();
  });
  assert.equal(
    (
      await handleAssistant(
        request("execute", {
          action: { tool: "mkdir", path: "/Workspace/Reports" },
        }),
        env,
      )
    ).status,
    409,
  );
  assert.equal(calls, 1);
});

test("confirmed file changes forward only the user's authorization and validated arguments", async (t) => {
  const calls = [];
  stub(t, async (url, init) => {
    calls.push({ url: String(url), init });
    return calls.length === 1 ? me() : Response.json({ code: 200 });
  });
  const response = await handleAssistant(
    request("execute", {
      confirmed: true,
      action: {
        tool: "rename",
        path: "/Workspace/A.txt",
        name: "B.txt",
        overwrite: true,
        admin: true,
      },
    }),
    env,
  );
  assert.equal(response.status, 200);
  assert.equal(calls[1].url, "https://origin.example/api/fs/rename");
  assert.equal(calls[1].init.headers.Authorization, "test-user-session");
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    path: "/Workspace/A.txt",
    name: "B.txt",
    overwrite: false,
  });
});

test("backend permission denial remains denied", async (t) => {
  let count = 0;
  stub(t, async () =>
    ++count === 1
      ? me({ role: 0 })
      : Response.json({ code: 403, message: "denied" }),
  );
  assert.equal(
    (
      await handleAssistant(
        request("execute", {
          confirmed: true,
          action: { tool: "mkdir", path: "/Workspace/Reports" },
        }),
        env,
      )
    ).status,
    403,
  );
});

test("file inspection strips provider URLs and bearer-like fields", async (t) => {
  let count = 0;
  stub(t, async () =>
    ++count === 1
      ? me()
      : Response.json({
          code: 200,
          data: {
            name: "A.txt",
            size: 12,
            is_dir: false,
            modified: "today",
            raw_url: "https://private.example/?token=secret",
            sign: "secret",
            header: "secret",
          },
        }),
  );
  const response = await handleAssistant(
    request("execute", { action: { tool: "get", path: "/Workspace/A.txt" } }),
    env,
  );
  const text = await response.text();
  assert.match(text, /A.txt/);
  assert.doesNotMatch(text, /secret|raw_url|private.example/);
});

test("queued copy tasks are reported as queued rather than completed", async (t) => {
  let count = 0;
  stub(t, async () =>
    ++count === 1
      ? me()
      : Response.json({
          code: 200,
          data: {
            tasks: [{ id: "task-1", name: "copy", state: 0, secret: "hidden" }],
          },
        }),
  );
  const result = await (
    await handleAssistant(
      request("execute", {
        confirmed: true,
        action: {
          tool: "copy",
          src_dir: "/Workspace",
          dst_dir: "/Workspace/Documents",
          names: ["A.txt"],
        },
      }),
      env,
    )
  ).json();
  assert.equal(result.status, "queued");
  assert.equal(result.tasks[0].secret, undefined);
});

test("native provider guides stay in Open-Box and clearly require authorization", async () => {
  for (const provider of ["google-drive", "dropbox", "onedrive"]) {
    const response = await worker.fetch(
      new Request(`https://open-box.space/settings/integrations/${provider}`),
      env,
    );
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.match(text, /Authorization required/);
    assert.match(text, /Open-Box/);
    assert.doesNotMatch(text, /api.oplist.org|OpenList Token/);
  }
});

test("widget source is valid JavaScript and uses safe text rendering", () => {
  assert.doesNotThrow(() => new Function(ASSISTANT_WIDGET));
  assert.match(ASSISTANT_WIDGET, /Agent Assistant/);
  assert.match(ASSISTANT_WIDGET, /left:16px/);
  assert.match(ASSISTANT_WIDGET, /textContent = JSON.stringify/);
  assert.doesNotMatch(ASSISTANT_WIDGET, /eval\(|new Function|admin-token/);
});
