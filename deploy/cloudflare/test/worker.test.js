import test from "node:test";
import assert from "node:assert/strict";
import worker, { safeNext, storageProviderManifest } from "../src/worker.js";

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
  assert.deepEqual(manifest.providers.map(({ id }) => id), ["google-drive", "dropbox", "onedrive", "box"]);
  assert.equal(JSON.stringify(manifest).includes("secret"), false);
  assert.equal(JSON.stringify(manifest).includes("token"), true);
});

test("storage onboarding routes are served at the edge", async () => {
  const env = {
    APP_NAME: "Open-Box",
    ORIGIN_URL: "https://origin.example",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "public-test-key",
  };
  const api = await worker.fetch(new Request("https://open-box.space/api/open-box/storage-providers"), env);
  assert.equal(api.status, 200);
  assert.equal((await api.json()).providers.length, 4);

  const page = await worker.fetch(new Request("https://open-box.space/connect-storage"), env);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Connect your storage accounts when ready/);
  assert.equal(page.headers.get("cache-control"), "no-store");
});
