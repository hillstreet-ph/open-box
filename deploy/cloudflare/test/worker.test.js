import test from "node:test";
import assert from "node:assert/strict";
import worker, { integrationStatus, safeNext, storageProviderManifest } from "../src/worker.js";

test("safeNext accepts local paths", () => {
  assert.equal(safeNext("/files?dir=%2F"), "/files?dir=%2F");
});

test("safeNext rejects external and protocol-relative redirects", () => {
  assert.equal(safeNext("https://example.com"), "/");
  assert.equal(safeNext("//example.com"), "/");
  assert.equal(safeNext(null), "/");
});

test("storage manifest exposes supported providers without credentials", () => {
  const manifest = storageProviderManifest();
  assert.equal(manifest.status, "ready_for_account_authorization");
  assert.deepEqual(manifest.providers.map(({ id }) => id), ["google-drive", "dropbox", "onedrive", "box", "terabox", "mega"]);
  assert.equal(manifest.providers.every(({ supportsMultipleAccounts }) => supportsMultipleAccounts), true);
  const google = manifest.providers.find(({ id }) => id === "google-drive");
  assert.deepEqual(google.services, ["Drive", "Docs", "Sheets", "Slides", "Gmail"]);
  assert.equal(google.scopeProfiles.workspaceWithGmail.includes("gmail.readonly"), true);
  assert.equal(JSON.stringify(manifest).includes("secret"), false);
  assert.equal(JSON.stringify(manifest).includes("token"), true);
});

test("storage onboarding routes are served at the edge", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.endsWith("/ping")) return new Response("pong");
    if (url.endsWith("/api/public/settings")) return Response.json({ data: { site_title: "Open-Box", sso_login_enabled: "true", sso_login_platform: "Github" } });
    if (url.endsWith("/auth/v1/health")) return Response.json({ version: "test" });
    throw new Error(`unexpected request: ${url}`);
  };
  const env = {
    APP_NAME: "Open-Box",
    ORIGIN_URL: "https://origin.example",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "public-test-key",
    AI: {},
  };
  try {
    const api = await worker.fetch(new Request("https://open-box.space/api/open-box/storage-providers"), env);
    assert.equal(api.status, 200);
    assert.equal((await api.json()).providers.length, 6);

    const brand = await worker.fetch(new Request("https://open-box.space/open-box-brand.svg"), env);
    assert.equal(brand.status, 200);
    assert.equal(brand.headers.get("content-type"), "image/svg+xml; charset=utf-8");
    assert.match(await brand.text(), /<title id="title">Open-Box<\/title>/);

    const brandHead = await worker.fetch(new Request("https://open-box.space/open-box-brand.svg", { method: "HEAD" }), env);
    assert.equal(brandHead.status, 200);
    assert.equal(brandHead.headers.get("content-type"), "image/svg+xml; charset=utf-8");
    assert.equal(await brandHead.text(), "");

    const status = await integrationStatus(env);
    assert.equal(status.status, "operational");
    assert.equal(status.application.githubSso, true);
    assert.equal(status.services.every(({ state }) => state === "operational" || state === "configured"), true);

    const statusApi = await worker.fetch(new Request("https://open-box.space/api/open-box/integrations/status"), env);
    assert.equal(statusApi.status, 200);
    assert.equal((await statusApi.json()).services.length, 6);

    const settings = await worker.fetch(new Request("https://open-box.space/api/public/settings"), env);
    const settingsPayload = await settings.json();
    assert.equal(settingsPayload.data.site_title, "Open-Box");
    assert.equal(settingsPayload.data.logo, "https://open-box.space/open-box-brand.svg");
    assert.equal(settingsPayload.data.favicon, "https://open-box.space/open-box-brand.svg");
    assert.equal(settingsPayload.data.main_color, "#7c3aed");

    const page = await worker.fetch(new Request("https://open-box.space/settings/integrations"), env);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Your clouds\. One Open‑Box\./);
    assert.match(html, /TeraBox/);
    assert.match(html, /MEGA/);
    assert.equal(page.headers.get("cache-control"), "no-store");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OAuth consent route validates requests and returns a no-store consent page", async () => {
  const env = {
    APP_NAME: "Open-Box",
    ORIGIN_URL: "https://origin.example",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "public-test-key",
  };
  const invalid = await worker.fetch(new Request("https://open-box.space/oauth/consent?authorization_id=bad%20id"), env);
  assert.equal(invalid.status, 400);

  const response = await worker.fetch(new Request("https://open-box.space/oauth/consent?authorization_id=auth_123"), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("content-security-policy"), /https:\/\/project\.supabase\.co/);
  const html = await response.text();
  assert.match(html, /Review access request/);
  assert.match(html, /getAuthorizationDetails/);
  assert.match(html, /approveAuthorization/);
  assert.match(html, /denyAuthorization/);
});

test("MCP requests bypass the browser cookie gate and preserve the backend OAuth challenge", async () => {
  const originalFetch = globalThis.fetch;
  let forwarded;
  globalThis.fetch = async (input, init) => {
    forwarded = { url: typeof input === "string" ? input : input.url, headers: new Headers(init?.headers || input.headers) };
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json", "www-authenticate": 'Bearer resource_metadata="https://open-box.space/.well-known/oauth-protected-resource/mcp"' },
    });
  };
  try {
    const response = await worker.fetch(new Request("https://open-box.space/mcp", {
      method: "GET",
      headers: { authorization: "Bearer test-token" },
    }), {
      ORIGIN_URL: "https://origin.example",
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "public-test-key",
      AUTH_REQUIRED: "true",
    });
    assert.equal(forwarded.url, "https://origin.example/mcp");
    assert.equal(forwarded.headers.get("authorization"), "Bearer test-token");
    assert.equal(response.status, 401);
    assert.match(response.headers.get("www-authenticate"), /oauth-protected-resource/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
