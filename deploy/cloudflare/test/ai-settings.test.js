import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";
import { saveProviderConfig } from "../src/ai-provider.js";

const SECRET = "gateway-encryption-secret-0123456789abcdefghijklmnop";
const API_KEY = "sk-live-1234567890abcdef";
const BASE = "https://gateway.example.com/v1";
const CONFIG_KEY = "provider:default";

function memoryKv() {
  const data = new Map();
  return {
    async get(key) {
      return data.get(key) ?? null;
    },
    async put(key, value) {
      data.set(key, value);
    },
    async delete(key) {
      data.delete(key);
    },
    raw(key) {
      return data.get(key);
    },
  };
}

function stagingEnv() {
  return {
    APP_NAME: "Open-Box",
    ORIGIN_URL: "https://origin.example",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
    AI_CONFIG_KEY: SECRET,
    AI_CONFIG: memoryKv(),
    AI: { run: async () => ({ response: "workers-ai" }) },
  };
}

function me(role = 2) {
  return Response.json({
    code: 200,
    data: { id: 1, username: "admin", role },
  });
}

function stub(t, handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  t.after(() => {
    globalThis.fetch = original;
  });
}

const auth = { Authorization: "native-session-token" };
const endpoint = (path, init = {}) =>
  new Request(`https://open-box.space${path}`, init);

async function save(env, overrides = {}) {
  return saveProviderConfig(
    env,
    {
      provider: "openai-compatible",
      base_url: BASE,
      model: "gpt-4o-mini",
      api_key: API_KEY,
      ...overrides,
    },
    { id: 1 },
  );
}

test("provider settings require a native administrator session", async (t) => {
  const env = stagingEnv();
  let originCalls = 0;
  stub(t, async (url) => {
    originCalls += 1;
    const path = new URL(String(url)).pathname;
    assert.equal(path, "/api/me");
    return me(0);
  });

  const anonymous = await worker.fetch(
    endpoint("/api/open-box/ai/provider"),
    env,
  );
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, "sign_in_required");

  const member = await worker.fetch(
    endpoint("/api/open-box/ai/provider", { headers: auth }),
    env,
  );
  assert.equal(member.status, 403);
  assert.equal((await member.json()).error, "admin_required");
  assert.equal(originCalls, 1);
});

test("administrators can read, save, and reset the provider without seeing the key", async (t) => {
  const env = stagingEnv();
  stub(t, async () => me(2));

  const initial = await worker.fetch(
    endpoint("/api/open-box/ai/provider", { headers: auth }),
    env,
  );
  assert.equal(initial.status, 200);
  assert.equal((await initial.json()).provider, "workers-ai");

  const saved = await worker.fetch(
    endpoint("/api/open-box/ai/provider", {
      method: "PUT",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        provider: "openai-compatible",
        base_url: BASE,
        model: "gpt-4o-mini",
        api_key: API_KEY,
      }),
    }),
    env,
  );
  assert.equal(saved.status, 200);
  const publicView = await saved.json();
  assert.equal(publicView.provider, "openai-compatible");
  assert.equal(publicView.api_key_set, true);
  assert.equal(publicView.api_key, undefined);
  assert.match(publicView.api_key_hint, /cdef$/);
  assert.equal(JSON.stringify(publicView).includes(API_KEY), false);
  assert.equal(env.AI_CONFIG.raw(CONFIG_KEY).includes(API_KEY), false);

  const reset = await worker.fetch(
    endpoint("/api/open-box/ai/provider", { method: "DELETE", headers: auth }),
    env,
  );
  assert.equal(reset.status, 200);
  assert.equal((await reset.json()).provider, "workers-ai");
  assert.equal(env.AI_CONFIG.raw(CONFIG_KEY), undefined);
});

test("provider settings reject unsafe URLs and foreign origins", async (t) => {
  const env = stagingEnv();
  stub(t, async () => me(2));

  const unsafe = await worker.fetch(
    endpoint("/api/open-box/ai/provider", {
      method: "PUT",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        provider: "openai-compatible",
        base_url: "https://10.0.0.5/v1",
        model: "gpt-4o-mini",
        api_key: API_KEY,
      }),
    }),
    env,
  );
  assert.equal(unsafe.status, 400);
  assert.equal((await unsafe.json()).error, "invalid_base_url");
  assert.equal(env.AI_CONFIG.raw(CONFIG_KEY), undefined);

  const foreign = await worker.fetch(
    endpoint("/api/open-box/ai/provider", {
      headers: { ...auth, Origin: "https://attacker.example" },
    }),
    env,
  );
  assert.equal(foreign.status, 403);
  assert.equal((await foreign.json()).error, "origin_not_allowed");
});

test("the connection test calls the configured endpoint with the stored key", async (t) => {
  const env = stagingEnv();
  await save(env);
  let providerCall;
  stub(t, async (url, init) => {
    if (new URL(String(url)).pathname === "/api/me") return me(2);
    providerCall = { url: String(url), init };
    return Response.json({
      model: "gpt-4o-mini",
      choices: [{ message: { content: "ok" } }],
    });
  });

  const response = await worker.fetch(
    endpoint("/api/open-box/ai/provider/test", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: "{}",
    }),
    env,
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.provider, "openai-compatible");
  assert.equal(result.reply, "ok");
  assert.equal(providerCall.url, `${BASE}/chat/completions`);
  assert.equal(providerCall.init.headers.authorization, `Bearer ${API_KEY}`);
  assert.equal(JSON.stringify(result).includes(API_KEY), false);
});

test("/ai/health and /ai/chat use the configured provider", async (t) => {
  const env = stagingEnv();
  await save(env);
  stub(t, async (url, init) => {
    if (String(url).endsWith("/api/me")) return me(2);
    assert.equal(String(url), `${BASE}/chat/completions`);
    const body = JSON.parse(init.body);
    assert.deepEqual(body.messages.at(-1), {
      role: "user",
      content: "Where are my reports?",
    });
    return Response.json({
      model: "gpt-4o-mini",
      choices: [{ message: { content: "In /Workspace/Reports." } }],
    });
  });

  const health = await worker.fetch(endpoint("/ai/health"), env);
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.provider, "openai-compatible");
  assert.equal(healthBody.models.text, "gpt-4o-mini");

  const chat = await worker.fetch(
    endpoint("/ai/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Where are my reports?" }),
    }),
    env,
  );
  assert.equal(chat.status, 200);
  const chatBody = await chat.json();
  assert.equal(chatBody.provider, "openai-compatible");
  assert.equal(chatBody.text, "In /Workspace/Reports.");
});

test("the assistant session reports the configured provider", async (t) => {
  const env = stagingEnv();
  await save(env);
  stub(t, async () => me(0));

  const response = await worker.fetch(
    endpoint("/api/open-box/assistant/session", { headers: auth }),
    env,
  );
  assert.equal(response.status, 200);
  const session = await response.json();
  assert.equal(session.ai_available, true);
  assert.equal(session.ai_provider, "openai-compatible");
});

test("the AI settings page is self-contained and never embeds credentials", async (t) => {
  const env = stagingEnv();
  await save(env);
  stub(t, async () => {
    throw new Error("the settings page must not call upstream");
  });

  const response = await worker.fetch(endpoint("/settings/ai"), env);
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-security-policy"),
    /connect-src 'self'/,
  );
  assert.equal(response.headers.get("cache-control"), "no-store");
  const html = await response.text();
  assert.match(html, /id="api-key"/);
  assert.match(html, /Reset to Workers AI/);
  assert.match(html, /settings\/integrations/);
  assert.equal(html.includes(API_KEY), false);
  assert.equal(html.includes(SECRET), false);

  const integrations = await worker.fetch(
    endpoint("/settings/integrations"),
    { ...env, AI: {} },
  );
  assert.match(await integrations.text(), /href="\/settings\/ai"/);
});
