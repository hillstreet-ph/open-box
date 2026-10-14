import test from "node:test";
import assert from "node:assert/strict";
import worker, {
  brandFrontendAsset,
  integrationStatus,
  safeNext,
  storageProviderManifest,
} from "../src/worker.js";

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
  assert.deepEqual(
    manifest.providers.map(({ id }) => id),
    ["google-drive", "dropbox", "onedrive", "box", "terabox", "mega"],
  );
  assert.equal(
    manifest.providers.every(
      ({ supportsMultipleAccounts }) => supportsMultipleAccounts,
    ),
    true,
  );
  const google = manifest.providers.find(({ id }) => id === "google-drive");
  assert.deepEqual(google.services, [
    "Drive",
    "Docs",
    "Sheets",
    "Slides",
    "Gmail",
  ]);
  assert.equal(
    google.scopeProfiles.workspaceWithGmail.includes("gmail.readonly"),
    true,
  );
  assert.equal(JSON.stringify(manifest).includes("secret"), false);
  assert.equal(JSON.stringify(manifest).includes("token"), true);
});

test("storage onboarding routes are served at the edge", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.endsWith("/ping")) return new Response("pong");
    if (url.endsWith("/api/public/settings"))
      return Response.json({
        data: {
          site_title: "Open-Box",
          sso_login_enabled: "true",
          sso_login_platform: "Github",
        },
      });
    if (url.endsWith("/auth/v1/health"))
      return Response.json({ version: "test" });
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
    const api = await worker.fetch(
      new Request("https://open-box.space/api/open-box/storage-providers"),
      env,
    );
    assert.equal(api.status, 200);
    assert.equal((await api.json()).providers.length, 6);

    const brand = await worker.fetch(
      new Request("https://open-box.space/open-box-brand.svg"),
      env,
    );
    assert.equal(brand.status, 200);
    assert.equal(
      brand.headers.get("content-type"),
      "image/svg+xml; charset=utf-8",
    );
    assert.match(await brand.text(), /<title id="title">Open-Box<\/title>/);

    const brandHead = await worker.fetch(
      new Request("https://open-box.space/open-box-brand.svg", {
        method: "HEAD",
      }),
      env,
    );
    assert.equal(brandHead.status, 200);
    assert.equal(
      brandHead.headers.get("content-type"),
      "image/svg+xml; charset=utf-8",
    );
    assert.equal(await brandHead.text(), "");

    const status = await integrationStatus(env);
    assert.equal(status.status, "action_required");
    assert.equal(status.application.githubSso, true);
    assert.equal(
      status.services.every(
        ({ state }) => state === "operational" || state === "configured",
      ),
      true,
    );
    assert.equal(
      status.services.find(({ id }) => id === "github").state,
      "configured",
    );
    assert.equal(
      status.services.find(({ id }) => id === "workers-ai").state,
      "configured",
    );

    const statusApi = await worker.fetch(
      new Request("https://open-box.space/api/open-box/integrations/status"),
      env,
    );
    assert.equal(statusApi.status, 200);
    assert.equal((await statusApi.json()).services.length, 6);

    const settings = await worker.fetch(
      new Request("https://open-box.space/api/public/settings"),
      env,
    );
    const settingsPayload = await settings.json();
    assert.equal(settingsPayload.data.site_title, "Open-Box");
    assert.equal(
      settingsPayload.data.logo,
      "https://open-box.space/open-box-brand.svg",
    );
    assert.equal(
      settingsPayload.data.favicon,
      "https://open-box.space/open-box-brand.svg",
    );
    assert.equal(settingsPayload.data.main_color, "#7c3aed");

    const page = await worker.fetch(
      new Request("https://open-box.space/settings/integrations"),
      env,
    );
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Your clouds\. One Open‑Box\./);
    assert.match(html, /TeraBox/);
    assert.match(html, /MEGA/);
    assert.match(html, /System action required/);
    assert.match(html, /callback and account login still require verification/);
    assert.equal(page.headers.get("cache-control"), "no-store");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("branding replaces presentation strings without changing protocol identifiers", () => {
  const source =
    'window.OPENLIST_CONFIG={};const driver="OpenList";const other="AList V3";const labels={title:"OpenList Management",powered_by:"Powered by OpenList"};const readme="https://raw.githubusercontent.com/OpenListTeam/OpenList/main/README.md";';
  const output = brandFrontendAsset(source, "javascript");
  assert.match(output, /title:"Open-Box Management"/);
  assert.match(output, /powered_by:"Powered by Open-Box"/);
  assert.match(output, /window.OPENLIST_CONFIG/);
  assert.match(output, /driver="OpenList"/);
  assert.match(output, /other="AList V3"/);
  assert.match(output, /\/open-box-about.md/);
  const html = brandFrontendAsset(
    '<meta name="generator" content="OpenList" ><meta name="apple-mobile-web-app-title" content="OpenList">',
    "html",
  );
  assert.equal(html.includes('content="OpenList"'), false);
  const manifest = JSON.parse(
    brandFrontendAsset(
      '{"start_url":"/","name":"OpenList","icons":[]}',
      "manifest",
    ),
  );
  assert.equal(manifest.name, "Open-Box");
  assert.equal(manifest.icons[0].type, "image/svg+xml");
  assert.equal(manifest.start_url, "/");
  assert.equal(brandFrontendAsset("invalid json", "manifest"), "invalid json");
});

test("proxied branded assets drop stale validators and encoded-body headers", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (request) => {
    assert.equal(request.headers.has("If-None-Match"), false);
    return new Response('const title="OpenList Management";', {
      headers: {
        "content-type": "application/javascript",
        etag: "old",
        "content-length": "33",
        "content-encoding": "gzip",
      },
    });
  };
  try {
    const response = await worker.fetch(
      new Request("https://open-box.space/assets/en-test.js", {
        headers: { "If-None-Match": "old" },
      }),
      {
        ORIGIN_URL: "https://origin.example",
        SUPABASE_URL: "https://project.example",
        SUPABASE_PUBLISHABLE_KEY: "public",
      },
    );
    assert.match(await response.text(), /Open-Box Management/);
    for (const header of ["etag", "content-length", "content-encoding"])
      assert.equal(response.headers.has(header), false);
  } finally {
    globalThis.fetch = original;
  }
});

test("stored HTML and partial responses preserve file bytes and headers", async () => {
  const original = globalThis.fetch;
  const body = '<meta name="generator" content="OpenList">';
  const env = {
    ORIGIN_URL: "https://origin.example",
    SUPABASE_URL: "https://project.example",
    SUPABASE_PUBLISHABLE_KEY: "public",
  };
  try {
    for (const [path, status, type] of [
      ["/p/document.html", 200, "text/html"],
      ["/api/page", 200, "text/html"],
      ["/static/page.html", 200, "text/html"],
      ["/d/files/document.html", 200, "text/html"],
      ["/dav/document.html", 200, "text/html"],
      ["/assets/en-test.js", 206, "application/javascript"],
      ["/", 206, "text/html"],
    ]) {
      globalThis.fetch = async () =>
        new Response(body, {
          status,
          headers: {
            "content-type": type,
            etag: "file-etag",
            "content-range": "bytes 0-42/100",
          },
        });
      const response = await worker.fetch(
        new Request("https://open-box.space" + path),
        env,
      );
      assert.equal(await response.text(), body);
      assert.equal(response.status, status);
      assert.equal(response.headers.get("etag"), "file-etag");
      assert.equal(response.headers.get("content-range"), "bytes 0-42/100");
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("branding handles compiled template literals", () => {
  assert.equal(
    brandFrontendAsset(
      "title:`OpenList Management`,powered_by:`Powered by OpenList`",
      "javascript",
    ),
    "title:`Open-Box Management`,powered_by:`Powered by Open-Box`",
  );
});

test("branding covers deployed Chinese locales without renaming storage drivers", () => {
  const labels = [
    "OpenList 管理",
    "由 OpenList 驱动",
    "由 OpenList 驅動",
    "允许不经OpenList直接上传到OneDrive",
    "允許不經OpenList直接上傳到OneDrive",
    "允许直接上传到 OneDrive 而不通过 OpenList",
    "允許直接上傳到 OneDrive 而不通過 OpenList",
    "待 OpenList 提示 139 邮箱验证码已发送后，再填写此项，并重新保存配置。",
  ];
  for (const quote of ['"', "'", "`"])
    for (const label of labels) {
      const source = `const label=${quote}${label}${quote};const driver="OpenList";const share="OpenListShare";`;
      const output = brandFrontendAsset(source, "javascript");
      assert.ok(
        output.includes(
          `${quote}${label.replaceAll("OpenList", "Open-Box")}${quote}`,
        ),
      );
      assert.ok(output.includes('driver="OpenList"'));
      assert.ok(output.includes('share="OpenListShare"'));
    }
  const banner =
    "console.log(`%c OpenList %c ${version} %c https://github.com/OpenListTeam/OpenList`);window.OpenListPlugin={};";
  assert.equal(
    brandFrontendAsset(banner, "javascript"),
    "console.log(`%c Open-Box %c ${version} %c https://github.com/hillstreet-ph/open-box`);window.OpenListPlugin={};",
  );
});

test("HTML branding handles alternate metadata order and preserves attribution", () => {
  const source =
    "<title>OpenList</title><meta content='OpenList' name='generator'><meta name='apple-mobile-web-app-title' content='OpenList'><meta name='author' content='OpenList'><p>Derived from OpenList</p>";
  const output = brandFrontendAsset(source, "html");
  assert.ok(output.includes("<title>Open-Box</title>"));
  assert.ok(output.includes("content='Open-Box' name='generator'"));
  assert.ok(
    output.includes("name='apple-mobile-web-app-title' content='Open-Box'"),
  );
  assert.ok(output.includes("name='author' content='OpenList'"));
  assert.ok(output.includes("Derived from OpenList"));
  for (const source of ["null", "[]", '"OpenList"', "false"])
    assert.equal(brandFrontendAsset(source, "manifest"), source);
});

test("branding refreshes old chunk versions and retains query parameters and fragments", () => {
  const source =
    'import "./chunk.js?mode=legacy&open-box-brand=20261010#module";import "https://cdn.example/app.js";';
  const output = brandFrontendAsset(source, "javascript");
  assert.ok(
    output.includes("./chunk.js?mode=legacy&open-box-brand=20261014#module"),
  );
  assert.ok(output.includes('"https://cdn.example/app.js"'));
  assert.equal(brandFrontendAsset(output, "javascript"), output);
  const dynamic = "const url=`./chunk.js?mode=${mode}&value=a%20b`;";
  assert.equal(
    brandFrontendAsset(dynamic, "javascript"),
    "const url=`./chunk.js?mode=${mode}&value=a%20b&open-box-brand=20261014`;",
  );
  const escaped = String.raw`import "./chunk.js?x=1\u0026theme=dark";`;
  assert.equal(
    brandFrontendAsset(escaped, "javascript"),
    String.raw`import "./chunk.js?x=1\u0026theme=dark&open-box-brand=20261014";`,
  );
  const html =
    '<script src="/assets/chunk.js?x=1&amp;theme=dark&amp;open-box-brand=20261010"></script>';
  assert.equal(
    brandFrontendAsset(html, "html"),
    '<script src="/assets/chunk.js?x=1&amp;theme=dark&amp;open-box-brand=20261014"></script>',
  );
});

test("nested pages and public settings cannot reuse unbranded origin validators", async () => {
  const original = globalThis.fetch;
  const env = {
    ORIGIN_URL: "https://origin.example",
    SUPABASE_URL: "https://project.example",
    SUPABASE_PUBLISHABLE_KEY: "public",
  };
  try {
    globalThis.fetch = async (request) => {
      assert.equal(request.headers.has("If-None-Match"), false);
      assert.equal(request.headers.has("If-Modified-Since"), false);
      return request.url.endsWith("/api/public/settings")
        ? Response.json({ data: { site_title: "OpenList" } })
        : new Response(
            '<title>OpenList</title><script>window.OPENLIST_CONFIG={}</script><div id="root"></div>',
            { headers: { "content-type": "text/html" } },
          );
    };
    for (const path of ["/GoogleDrive/Documents", "/api/public/settings"]) {
      const response = await worker.fetch(
        new Request("https://open-box.space" + path, {
          headers: {
            "If-None-Match": "old",
            "If-Modified-Since": "Wed, 01 Oct 2025 00:00:00 GMT",
          },
        }),
        env,
      );
      assert.equal(response.status, 200);
      assert.match(await response.text(), /Open-Box/);
    }
    globalThis.fetch = async (request) => {
      assert.equal(request.headers.get("If-None-Match"), "file-etag");
      return new Response(null, {
        status: 304,
        headers: { etag: "file-etag" },
      });
    };
    const file = await worker.fetch(
      new Request("https://open-box.space/d/file.txt", {
        headers: { "If-None-Match": "file-etag" },
      }),
      env,
    );
    assert.equal(file.status, 304);
    assert.equal(file.headers.get("etag"), "file-etag");
  } finally {
    globalThis.fetch = original;
  }
});

test("unrecognized public settings responses remain readable without invented branding", async () => {
  const original = globalThis.fetch;
  const env = {
    ORIGIN_URL: "https://origin.example",
    SUPABASE_URL: "https://project.example",
    SUPABASE_PUBLISHABLE_KEY: "public",
  };
  try {
    for (const body of [
      "upstream unavailable",
      '{"code":500,"message":"settings unavailable"}',
      '{"data":"unexpected upstream response"}',
    ]) {
      globalThis.fetch = async () =>
        new Response(body, { headers: { "content-type": "application/json" } });
      const response = await worker.fetch(
        new Request("https://open-box.space/api/public/settings"),
        env,
      );
      assert.equal(await response.text(), body);
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("branding versions entry and transitive chunk URLs for existing browser caches", () => {
  const html = brandFrontendAsset(
    '<script src="/assets/index-abc.js"></script>',
    "html",
  );
  assert.match(html, /index-abc.js\?open-box-brand=20261014/);
  const js = brandFrontendAsset(
    'import "./About-abc.js";const deps=["/assets/home-abc.js"];',
    "javascript",
  );
  assert.match(js, /About-abc.js\?open-box-brand=20261014/);
  assert.match(js, /home-abc.js\?open-box-brand=20261014/);
  assert.equal(brandFrontendAsset(js, "javascript"), js);
});

test("nested storage pages receive branded SPA metadata and versioned chunks", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      '<meta name="generator" content="OpenList"><script>window.OPENLIST_CONFIG={}</script><div id="root"></div><script src="/assets/index-a.js"></script>',
      { headers: { "content-type": "text/html" } },
    );
  try {
    const response = await worker.fetch(
      new Request("https://open-box.space/GoogleDrive/Documents"),
      {
        ORIGIN_URL: "https://origin.example",
        SUPABASE_URL: "https://project.example",
        SUPABASE_PUBLISHABLE_KEY: "public",
      },
    );
    const html = await response.text();
    assert.match(html, /content="Open-Box"/);
    assert.match(html, /index-a.js\?open-box-brand=20261014/);
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally {
    globalThis.fetch = original;
  }
});

test("non-SPA HTML fallback preserves binary body and validators", async () => {
  const original = globalThis.fetch;
  const bytes = new Uint8Array([60, 112, 62, 233, 60, 47, 112, 62]);
  globalThis.fetch = async () =>
    new Response(bytes, {
      headers: {
        "content-type": "text/html; charset=iso-8859-1",
        "content-length": "8",
        etag: "original",
      },
    });
  try {
    const response = await worker.fetch(
      new Request("https://open-box.space/custom-page"),
      {
        ORIGIN_URL: "https://origin.example",
        SUPABASE_URL: "https://project.example",
        SUPABASE_PUBLISHABLE_KEY: "public",
      },
    );
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
    assert.equal(response.headers.get("content-length"), "8");
    assert.equal(response.headers.get("etag"), "original");
  } finally {
    globalThis.fetch = original;
  }
});

test("OAuth consent route validates requests and returns a no-store consent page", async () => {
  const env = {
    APP_NAME: "Open-Box",
    ORIGIN_URL: "https://origin.example",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "public-test-key",
  };
  const invalid = await worker.fetch(
    new Request(
      "https://open-box.space/oauth/consent?authorization_id=bad%20id",
    ),
    env,
  );
  assert.equal(invalid.status, 400);

  const response = await worker.fetch(
    new Request(
      "https://open-box.space/oauth/consent?authorization_id=auth_123",
    ),
    env,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(
    response.headers.get("content-security-policy"),
    /https:\/\/project\.supabase\.co/,
  );
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
    forwarded = {
      url: typeof input === "string" ? input : input.url,
      headers: new Headers(init?.headers || input.headers),
    };
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate":
          'Bearer resource_metadata="https://open-box.space/.well-known/oauth-protected-resource/mcp"',
      },
    });
  };
  try {
    const response = await worker.fetch(
      new Request("https://open-box.space/mcp", {
        method: "GET",
        headers: { authorization: "Bearer test-token" },
      }),
      {
        ORIGIN_URL: "https://origin.example",
        SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "public-test-key",
        AUTH_REQUIRED: "true",
      },
    );
    assert.equal(forwarded.url, "https://origin.example/mcp");
    assert.equal(forwarded.headers.get("authorization"), "Bearer test-token");
    assert.equal(response.status, 401);
    assert.match(
      response.headers.get("www-authenticate"),
      /oauth-protected-resource/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("integration page shows incomplete auth and preserves account mount placeholders", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.endsWith("/api/public/settings"))
      return Response.json({ data: { sso_login_enabled: "false" } });
    return Response.json({ status: "ok" });
  };
  try {
    const env = {
      ORIGIN_URL: "https://origin.example",
      SUPABASE_URL: "https://project.example",
      SUPABASE_PUBLISHABLE_KEY: "public",
      AI: {},
    };
    assert.equal((await integrationStatus(env)).status, "action_required");
    const page = await worker.fetch(
      new Request("https://open-box.space/settings/integrations"),
      env,
    );
    const html = await page.text();
    assert.match(html, /System action required/);
    assert.match(html, /google-drive\/&lt;account&gt;/);
    assert.equal(
      html.includes("persistent application volume remain active"),
      false,
    );
  } finally {
    globalThis.fetch = original;
  }
});
