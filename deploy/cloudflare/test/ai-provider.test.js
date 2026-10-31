import test from "node:test";
import assert from "node:assert/strict";
import {
  ProviderError,
  chatCompletion,
  clearProviderConfig,
  loadProviderConfig,
  providerStatus,
  publicProviderConfig,
  saveProviderConfig,
  testProvider,
  validateApiKey,
  validateBaseUrl,
  validateModel,
} from "../src/ai-provider.js";

const CONFIG_KEY = "provider:default";
const SECRET = "test-encryption-secret-0123456789abcdefghijklmnop";
const API_KEY = "sk-test-1234567890abcdef";

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

function customEnv() {
  return {
    AI_CONFIG_KEY: SECRET,
    AI_CONFIG: memoryKv(),
    AI: {
      run: async () => ({ response: "workers-ai-text" }),
    },
  };
}

async function saveCustom(env, overrides = {}) {
  return saveProviderConfig(
    env,
    {
      provider: "openai-compatible",
      base_url: "https://gateway.example.com/v1",
      model: "gpt-4o-mini",
      api_key: API_KEY,
      ...overrides,
    },
    { id: 7 },
  );
}

test("base URL validation accepts OpenAI-compatible HTTPS bases", () => {
  assert.equal(
    validateBaseUrl(" https://Gateway.Example.com/v1/ "),
    "https://gateway.example.com/v1",
  );
  assert.equal(
    validateBaseUrl("https://gateway.example.com/v1/chat/completions"),
    "https://gateway.example.com/v1",
  );
  assert.equal(
    validateBaseUrl("https://gateway.example.com/open-connect/v1"),
    "https://gateway.example.com/open-connect/v1",
  );
});

test("base URL validation rejects non-HTTPS, credentials, and private targets", () => {
  for (const value of [
    "http://gateway.example.com/v1",
    "https://user:pass@gateway.example.com/v1",
    "https://gateway.example.com/v1?key=1",
    "https://gateway.example.com/v1#frag",
    "https://localhost:8787/v1",
    "https://127.0.0.1/v1",
    "https://127.1/v1",
    "https://10.2.3.4/v1",
    "https://192.168.1.2/v1",
    "https://172.20.0.1/v1",
    "https://169.254.169.254/v1",
    "https://[::1]/v1",
    "https://[::ffff:127.0.0.1]/v1",
    "https://[::ffff:169.254.169.254]/v1",
    "https://[::]/v1",
    "https://[fe80::1]/v1",
    "https://[fc00::1]/v1",
    "https://[2001:4860:4860::8888]/v1",
    "https://metadata.internal/v1",
    "https://2130706433/v1",
    "https://0x7f000001/v1",
    "not-a-url",
    "",
  ])
    assert.throws(() => validateBaseUrl(value), ProviderError, String(value));
});

test("model and API key validation reject unsafe values", () => {
  assert.equal(validateModel(" gpt-4o-mini "), "gpt-4o-mini");
  assert.equal(
    validateModel("meta-llama/llama-3.1-70b-instruct"),
    "meta-llama/llama-3.1-70b-instruct",
  );
  assert.throws(() => validateModel("model with spaces"), ProviderError);
  assert.throws(() => validateModel("x".repeat(129)), ProviderError);
  assert.throws(() => validateApiKey("short"), ProviderError);
  assert.throws(() => validateApiKey("sk-valid-but has-space"), ProviderError);
});

test("provider keys are stored encrypted and never returned", async () => {
  const env = customEnv();
  const saved = await saveCustom(env);
  assert.equal(saved.provider, "openai-compatible");
  assert.equal(saved.api_key_set, true);
  assert.equal(saved.api_key, undefined);
  assert.match(saved.api_key_hint, /^••••cdef$/);
  const record = env.AI_CONFIG.raw(CONFIG_KEY);
  assert.equal(record.includes(API_KEY), false);
  assert.equal(JSON.stringify(saved).includes(API_KEY), false);
  const parsed = JSON.parse(record);
  assert.equal(parsed.api_key.v, 1);
  assert.equal(typeof parsed.api_key.ct, "string");
  assert.equal(parsed.api_key.ct.includes(API_KEY), false);
  assert.equal(parsed.updated_by, 7);
});

test("stored provider keys decrypt for server-side calls only", async () => {
  const env = customEnv();
  await saveCustom(env);
  assert.deepEqual(await loadProviderConfig(env), {
    provider: "openai-compatible",
    baseUrl: "https://gateway.example.com/v1",
    model: "gpt-4o-mini",
    apiKey: API_KEY,
  });
});

test("updating without a key keeps the stored credential", async () => {
  const env = customEnv();
  await saveCustom(env);
  const before = env.AI_CONFIG.raw(CONFIG_KEY);
  const saved = await saveProviderConfig(
    env,
    {
      provider: "openai-compatible",
      base_url: "https://gateway.example.com/v2",
      model: "gpt-4.1-mini",
    },
    { id: 7 },
  );
  assert.equal(saved.api_key_set, true);
  const after = JSON.parse(env.AI_CONFIG.raw(CONFIG_KEY));
  assert.equal(after.base_url, "https://gateway.example.com/v2");
  assert.equal(after.model, "gpt-4.1-mini");
  assert.equal(after.api_key_hint, JSON.parse(before).api_key_hint);
});

test("a first custom configuration requires an API key", async () => {
  const env = customEnv();
  await assert.rejects(
    () =>
      saveProviderConfig(
        env,
        {
          provider: "openai-compatible",
          base_url: "https://gateway.example.com/v1",
          model: "gpt-4o-mini",
        },
        { id: 7 },
      ),
    (error) => error instanceof ProviderError && error.status === 400,
  );
});

test("resetting switches back to Workers AI", async () => {
  const env = customEnv();
  await saveCustom(env);
  const saved = await clearProviderConfig(env);
  assert.equal(saved.provider, "workers-ai");
  assert.equal(saved.api_key_set, false);
  assert.equal(env.AI_CONFIG.raw(CONFIG_KEY), undefined);
  assert.equal((await providerStatus(env)).provider, "workers-ai");
});

test("provider status fails closed on missing encryption or corrupt storage", async () => {
  const missingSecret = { AI_CONFIG: memoryKv() };
  await saveProviderConfig(
    { ...missingSecret, AI_CONFIG_KEY: SECRET },
    {
      provider: "openai-compatible",
      base_url: "https://gateway.example.com/v1",
      model: "gpt-4o-mini",
      api_key: API_KEY,
    },
    { id: 1 },
  );
  const status = await providerStatus(missingSecret);
  assert.equal(status.available, false);
  assert.equal(status.error, "ai_settings_encryption_unavailable");

  const corrupt = customEnv();
  await corrupt.AI_CONFIG.put(CONFIG_KEY, "not-json");
  assert.equal((await providerStatus(corrupt)).error, "provider_config_invalid");
});

test("provider status reports Workers AI when no custom config exists", async () => {
  const status = await providerStatus({ AI: {} });
  assert.deepEqual(status, {
    available: true,
    provider: "workers-ai",
    model: "@cf/meta/llama-3.2-3b-instruct",
  });
  assert.equal((await providerStatus({})).available, false);
});

test("custom provider requests carry the stored key and parse content", async (t) => {
  const env = customEnv();
  await saveCustom(env);
  let call;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    call = { url: String(url), init };
    return Response.json({
      model: "gpt-4o-mini-2026",
      choices: [
        { message: { content: [{ type: "text", text: "Hello" }, { text: " there" }] } },
      ],
    });
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  const result = await chatCompletion(env, {
    messages: [{ role: "user", content: "Hi" }],
    maxTokens: 32,
    temperature: 0.2,
  });
  assert.equal(call.url, "https://gateway.example.com/v1/chat/completions");
  assert.equal(call.init.headers.authorization, `Bearer ${API_KEY}`);
  const body = JSON.parse(call.init.body);
  assert.equal(body.model, "gpt-4o-mini");
  assert.equal(body.max_tokens, 32);
  assert.equal(body.temperature, 0.2);
  assert.deepEqual(result, {
    provider: "openai-compatible",
    model: "gpt-4o-mini-2026",
    text: "Hello there",
  });
});

test("custom provider failures are sanitized and never leak the key", async (t) => {
  const env = customEnv();
  await saveCustom(env);
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });

  globalThis.fetch = async () =>
    new Response(`upstream rejected ${API_KEY}`, { status: 401 });
  await assert.rejects(
    () => chatCompletion(env, { messages: [], maxTokens: 8 }),
    (error) =>
      error instanceof ProviderError &&
      error.status === 502 &&
      error.code === "provider_request_failed" &&
      !error.message.includes(API_KEY),
  );

  globalThis.fetch = async () => new Response("", { status: 429 });
  await assert.rejects(
    () => chatCompletion(env, { messages: [], maxTokens: 8 }),
    (error) => error instanceof ProviderError && error.status === 429,
  );

  globalThis.fetch = async () => Response.json({ choices: [] });
  await assert.rejects(
    () => chatCompletion(env, { messages: [], maxTokens: 8 }),
    (error) =>
      error instanceof ProviderError && error.code === "provider_invalid_response",
  );

  globalThis.fetch = async () => {
    throw new Error(`network down ${API_KEY}`);
  };
  await assert.rejects(
    () => chatCompletion(env, { messages: [], maxTokens: 8 }),
    (error) =>
      error instanceof ProviderError &&
      error.code === "provider_unreachable" &&
      !error.message.includes(API_KEY),
  );
});

test("Workers AI remains the default path with its schema support", async (t) => {
  let call;
  const env = {
    AI: {
      run: async (model, input) => {
        call = { model, input };
        return { response: '{"message":"ok","action":null}' };
      },
    },
  };
  const result = await chatCompletion(env, {
    messages: [{ role: "user", content: "Hi" }],
    maxTokens: 64,
    temperature: 0,
    workersAiModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    responseSchema: { type: "object" },
  });
  assert.equal(call.model, "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
  assert.equal(call.input.response_format.type, "json_schema");
  assert.equal(result.provider, "workers-ai");
  await assert.rejects(
    () => chatCompletion({}, { messages: [], maxTokens: 8 }),
    (error) => error instanceof ProviderError && error.status === 503,
  );
});

test("connection test reports provider metadata without the key", async (t) => {
  const env = customEnv();
  await saveCustom(env);
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ choices: [{ message: { content: "ok" } }] });
  t.after(() => {
    globalThis.fetch = original;
  });
  const result = await testProvider(env);
  assert.equal(result.provider, "openai-compatible");
  assert.equal(result.reply, "ok");
  assert.equal(typeof result.latency_ms, "number");
  assert.equal(JSON.stringify(result).includes(API_KEY), false);
});

test("public configuration never includes stored secrets", async () => {
  const env = customEnv();
  await saveCustom(env);
  const publicView = await publicProviderConfig(env);
  assert.equal(publicView.api_key_set, true);
  assert.equal(JSON.stringify(publicView).includes(API_KEY), false);
  assert.equal(JSON.stringify(publicView).includes(SECRET), false);
});
