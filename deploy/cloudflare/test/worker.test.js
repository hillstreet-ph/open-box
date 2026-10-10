import test from "node:test";
import assert from "node:assert/strict";
import worker, { brandFrontendAsset, integrationStatus, safeNext, storageProviderManifest } from "../src/worker.js";

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


test("branding replaces presentation strings without changing protocol identifiers", () => {
 const source = 'window.OPENLIST_CONFIG={};const driver="OpenList";const other="AList V3";const labels={title:"OpenList Management",powered_by:"Powered by OpenList"};const readme="https://raw.githubusercontent.com/OpenListTeam/OpenList/main/README.md";';
 const output = brandFrontendAsset(source,"javascript");
 assert.match(output,/title:"Open-Box Management"/);
 assert.match(output,/powered_by:"Powered by Open-Box"/);
 assert.match(output,/window.OPENLIST_CONFIG/);
 assert.match(output,/driver="OpenList"/);
 assert.match(output,/other="AList V3"/);
 assert.match(output,/\/open-box-about.md/);
 const html=brandFrontendAsset('<meta name="generator" content="OpenList" ><meta name="apple-mobile-web-app-title" content="OpenList">',"html");
 assert.equal(html.includes('content="OpenList"'),false);
 const manifest=JSON.parse(brandFrontendAsset('{"start_url":"/","name":"OpenList","icons":[]}',"manifest"));
 assert.equal(manifest.name,"Open-Box");
 assert.equal(manifest.icons[0].type,"image/svg+xml");
 assert.equal(manifest.start_url,"/");
 assert.equal(brandFrontendAsset('invalid json',"manifest"),'invalid json');
});

test("proxied branded assets drop stale validators and encoded-body headers", async () => {
 const original=globalThis.fetch;
 globalThis.fetch=async request=>{
  assert.equal(request.headers.has("If-None-Match"),false);
  return new Response('const title="OpenList Management";',{headers:{"content-type":"application/javascript","etag":"old","content-length":"33","content-encoding":"gzip"}});
 };
 try {
  const response=await worker.fetch(new Request("https://open-box.space/assets/en-test.js",{headers:{"If-None-Match":"old"}}),{ORIGIN_URL:"https://origin.example",SUPABASE_URL:"https://project.example",SUPABASE_PUBLISHABLE_KEY:"public"});
  assert.match(await response.text(),/Open-Box Management/);
  for(const header of ["etag","content-length","content-encoding"]) assert.equal(response.headers.has(header),false);
 } finally {globalThis.fetch=original;}
});


test("stored HTML and partial responses preserve file bytes and headers", async () => {
 const original=globalThis.fetch;
 const body='<meta name="generator" content="OpenList">';
 const env={ORIGIN_URL:"https://origin.example",SUPABASE_URL:"https://project.example",SUPABASE_PUBLISHABLE_KEY:"public"};
 try {
  for(const [path,status,type] of [["/d/files/document.html",200,"text/html"],["/dav/document.html",200,"text/html"],["/assets/en-test.js",206,"application/javascript"],["/",206,"text/html"]]) {
   globalThis.fetch=async()=>new Response(body,{status,headers:{"content-type":type,"etag":"file-etag","content-range":"bytes 0-42/100"}});
   const response=await worker.fetch(new Request("https://open-box.space"+path),env);
   assert.equal(await response.text(),body);
   assert.equal(response.status,status);
   assert.equal(response.headers.get("etag"),"file-etag");
   assert.equal(response.headers.get("content-range"),"bytes 0-42/100");
  }
 } finally {globalThis.fetch=original;}
});

test("branding handles compiled template literals",()=>{
 assert.equal(brandFrontendAsset('title:`OpenList Management`,powered_by:`Powered by OpenList`',"javascript"),'title:`Open-Box Management`,powered_by:`Powered by Open-Box`');
});


test("branding versions entry and transitive chunk URLs for existing browser caches",()=>{
 const html=brandFrontendAsset('<script src="/assets/index-abc.js"></script>',"html");
 assert.match(html,/index-abc.js\?open-box-brand=20261010/);
 const js=brandFrontendAsset('import "./About-abc.js";const deps=["/assets/home-abc.js"];',"javascript");
 assert.match(js,/About-abc.js\?open-box-brand=20261010/);
 assert.match(js,/home-abc.js\?open-box-brand=20261010/);
 assert.equal(brandFrontendAsset(js,"javascript"),js);
});
