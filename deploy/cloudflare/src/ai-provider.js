const CONFIG_KEY = "provider:default";
const WORKERS_AI_TEXT_MODEL = "@cf/meta/llama-3.2-3b-instruct";
const MAX_BASE_URL = 300;
const MAX_MODEL = 128;
const MAX_API_KEY = 2048;
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$/;
const PRIVATE_HOST =
  /^(?:localhost|127\.|0\.0\.0\.0$|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/;
// URL normalization rewrites mapped addresses such as [::ffff:127.0.0.1], so
// every IPv6 literal is rejected instead of classifying them one by one.
const IPV6_LITERAL = /^\[/;

const MESSAGES = {
  invalid_request: "The request could not be read.",
  ai_unavailable: "AI is not configured for this deployment.",
  ai_settings_storage_unavailable:
    "AI settings storage is not available on this gateway.",
  ai_settings_encryption_unavailable:
    "AI settings encryption is not configured on this gateway.",
  provider_config_invalid:
    "Stored AI provider settings could not be read. An administrator must save them again.",
  invalid_provider: "Choose Workers AI or an OpenAI-compatible provider.",
  invalid_base_url:
    "Enter an https base URL without credentials, query, or fragment.",
  invalid_model: "Enter a valid model name.",
  invalid_api_key: "Enter a valid API key.",
  api_key_required:
    "An API key is required the first time you configure a custom provider.",
  provider_unreachable:
    "The AI provider could not be reached. Check the base URL and network access.",
  provider_request_failed:
    "The AI provider rejected the request. Check the model name and API key, then try again.",
  provider_rate_limited:
    "The AI provider is rate limiting requests. Try again later.",
  provider_invalid_response: "The AI provider returned an unexpected response.",
};

export class ProviderError extends Error {
  constructor(code, status = 502) {
    super(MESSAGES[code] || "The AI provider request failed.");
    this.name = "ProviderError";
    this.code = code;
    this.status = status;
  }
}

export function providerMessage(code) {
  return MESSAGES[code] || "The AI provider request failed.";
}

function base64Encode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Decode(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function encryptionKey(env, usage) {
  const secret = env.AI_CONFIG_KEY;
  if (typeof secret !== "string" || secret.length < 32)
    throw new ProviderError("ai_settings_encryption_unavailable", 503);
  const material = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, [usage]);
}

async function seal(env, plain) {
  const key = await encryptionKey(env, "encrypt");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plain),
  );
  return {
    v: 1,
    iv: base64Encode(iv),
    ct: base64Encode(new Uint8Array(ciphertext)),
  };
}

async function unseal(env, sealed) {
  if (!sealed || sealed.v !== 1) throw new ProviderError("provider_config_invalid", 503);
  const key = await encryptionKey(env, "decrypt");
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64Decode(sealed.iv) },
      key,
      base64Decode(sealed.ct),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new ProviderError("provider_config_invalid", 503);
  }
}

export function validateBaseUrl(value) {
  if (typeof value !== "string" || value.length > MAX_BASE_URL)
    throw new ProviderError("invalid_base_url", 400);
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ProviderError("invalid_base_url", 400);
  }
  if (url.protocol !== "https:") throw new ProviderError("invalid_base_url", 400);
  if (url.username || url.password || url.search || url.hash)
    throw new ProviderError("invalid_base_url", 400);
  const host = url.hostname.toLowerCase();
  if (
    !host ||
    PRIVATE_HOST.test(host) ||
    IPV6_LITERAL.test(host) ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    (!host.includes(".") && !host.startsWith("[")) ||
    /^\d+$/.test(host)
  )
    throw new ProviderError("invalid_base_url", 400);
  const path = url.pathname.replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
  return `${url.origin}${path}`;
}

export function validateModel(value) {
  if (typeof value !== "string") throw new ProviderError("invalid_model", 400);
  const model = value.trim();
  if (model.length > MAX_MODEL || !MODEL_PATTERN.test(model))
    throw new ProviderError("invalid_model", 400);
  return model;
}

export function validateApiKey(value) {
  if (typeof value !== "string") throw new ProviderError("invalid_api_key", 400);
  const apiKey = value.trim();
  if (
    apiKey.length < 8 ||
    apiKey.length > MAX_API_KEY ||
    /[\s\x00-\x1f\x7f]/.test(apiKey)
  )
    throw new ProviderError("invalid_api_key", 400);
  return apiKey;
}

export async function readRequestJson(request, limit = 16384) {
  const reader = request.body?.getReader();
  if (!reader) throw new ProviderError("invalid_request", 400);
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new ProviderError("invalid_request", 400);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ProviderError("invalid_request", 400);
  }
}

function store(env) {
  const kv = env.AI_CONFIG;
  return kv && typeof kv.get === "function" && typeof kv.put === "function"
    ? kv
    : null;
}

function encryptionReady(env) {
  return typeof env.AI_CONFIG_KEY === "string" && env.AI_CONFIG_KEY.length >= 32;
}

async function readStoredConfig(env) {
  const kv = store(env);
  if (!kv) return null;
  const raw = await kv.get(CONFIG_KEY, "text");
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProviderError("provider_config_invalid", 503);
  }
  if (!parsed || parsed.provider !== "openai-compatible") return null;
  return parsed;
}

export async function loadProviderConfig(env) {
  const stored = await readStoredConfig(env);
  if (!stored)
    return { provider: "workers-ai", model: WORKERS_AI_TEXT_MODEL };
  return {
    provider: "openai-compatible",
    baseUrl: stored.base_url,
    model: stored.model,
    apiKey: await unseal(env, stored.api_key),
  };
}

export async function providerStatus(env) {
  try {
    const config = await loadProviderConfig(env);
    return {
      available:
        config.provider === "openai-compatible" || Boolean(env.AI),
      provider: config.provider,
      model: config.model,
    };
  } catch (error) {
    return {
      available: false,
      provider: "unavailable",
      model: "",
      error: error instanceof ProviderError ? error.code : "provider_config_invalid",
    };
  }
}

export async function publicProviderConfig(env) {
  const stored = await readStoredConfig(env);
  const base = {
    storage_configured: Boolean(store(env)),
    encryption_configured: encryptionReady(env),
    workers_ai_bound: Boolean(env.AI),
    embed_model: "@cf/baai/bge-m3",
  };
  if (!stored)
    return {
      ...base,
      provider: "workers-ai",
      base_url: "",
      model: WORKERS_AI_TEXT_MODEL,
      api_key_set: false,
      api_key_hint: "",
      updated_at: null,
      available: Boolean(env.AI),
    };
  return {
    ...base,
    provider: "openai-compatible",
    base_url: stored.base_url,
    model: stored.model,
    api_key_set: Boolean(stored.api_key),
    api_key_hint: stored.api_key_hint || "",
    updated_at: stored.updated_at || null,
    available: true,
  };
}

export async function saveProviderConfig(env, input, actor) {
  const kv = store(env);
  if (!kv) throw new ProviderError("ai_settings_storage_unavailable", 503);
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ProviderError("invalid_request", 400);
  if (input.provider === "workers-ai") {
    await kv.delete(CONFIG_KEY);
    return publicProviderConfig(env);
  }
  if (input.provider !== "openai-compatible")
    throw new ProviderError("invalid_provider", 400);
  if (!encryptionReady(env))
    throw new ProviderError("ai_settings_encryption_unavailable", 503);
  const baseUrl = validateBaseUrl(input.base_url);
  const model = validateModel(input.model);
  const existing = await readStoredConfig(env);
  let apiKey;
  let hint;
  if (typeof input.api_key === "string" && input.api_key.trim()) {
    apiKey = validateApiKey(input.api_key);
    hint = `••••${apiKey.slice(-4)}`;
  } else if (existing?.api_key) {
    apiKey = null;
    hint = existing.api_key_hint || "";
  } else {
    throw new ProviderError("api_key_required", 400);
  }
  const record = {
    v: 1,
    provider: "openai-compatible",
    base_url: baseUrl,
    model,
    api_key: apiKey === null ? existing.api_key : await seal(env, apiKey),
    api_key_hint: hint,
    updated_at: new Date().toISOString(),
    updated_by: Number.isInteger(actor?.id) ? actor.id : null,
  };
  await kv.put(CONFIG_KEY, JSON.stringify(record));
  return publicProviderConfig(env);
}

export async function clearProviderConfig(env) {
  const kv = store(env);
  if (!kv) throw new ProviderError("ai_settings_storage_unavailable", 503);
  await kv.delete(CONFIG_KEY);
  return publicProviderConfig(env);
}

function limits(options) {
  return {
    maxTokens: Math.min(Math.max(Number(options?.maxTokens) || 512, 1), 4096),
    temperature: Math.min(Math.max(Number(options?.temperature) || 0, 0), 2),
  };
}

function completionText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (Array.isArray(content))
    return content
      .map((part) => (typeof part === "string" ? part : part?.text || ""))
      .join("");
  return content;
}

export async function chatCompletion(env, options) {
  const config = await loadProviderConfig(env);
  const { maxTokens, temperature } = limits(options);
  if (config.provider === "openai-compatible") {
    let response;
    try {
      response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          messages: options.messages,
          max_tokens: maxTokens,
          temperature,
        }),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new ProviderError("provider_unreachable", 502);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if (response.status === 429)
        throw new ProviderError("provider_rate_limited", 429);
      throw new ProviderError("provider_request_failed", 502);
    }
    const payload = await response.json().catch(() => null);
    const text = completionText(payload);
    if (typeof text !== "string" || !text.trim())
      throw new ProviderError("provider_invalid_response", 502);
    return {
      provider: "openai-compatible",
      model: typeof payload?.model === "string" ? payload.model : config.model,
      text,
    };
  }
  if (!env.AI) throw new ProviderError("ai_unavailable", 503);
  const workersAiModel = options.workersAiModel || config.model;
  const result = await env.AI.run(workersAiModel, {
    messages: options.messages,
    max_tokens: maxTokens,
    temperature,
    ...(options.responseSchema
      ? {
          response_format: {
            type: "json_schema",
            json_schema: options.responseSchema,
          },
        }
      : {}),
  });
  return {
    provider: "workers-ai",
    model: workersAiModel,
    text: result?.response ?? result?.result ?? result,
    raw: typeof result === "object" ? result : undefined,
  };
}

export async function testProvider(env) {
  const started = Date.now();
  const result = await chatCompletion(env, {
    messages: [{ role: "user", content: "Reply with the single word: ok" }],
    maxTokens: 16,
    temperature: 0,
  });
  return {
    provider: result.provider,
    model: result.model,
    latency_ms: Date.now() - started,
    reply: String(result.text).slice(0, 120),
  };
}
