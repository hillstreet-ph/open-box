const ACCESS_COOKIE = "open_box_access";
const REFRESH_COOKIE = "open_box_refresh";
const AI_TEXT_MODEL = "@cf/meta/llama-3.2-3b-instruct";
const AI_EMBED_MODEL = "@cf/baai/bge-m3";
const OPEN_BOX_BRAND_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-labelledby="title"><title id="title">Open-Box</title><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#a78bfa"/><stop offset="1" stop-color="#6d28d9"/></linearGradient></defs><rect width="256" height="256" rx="56" fill="#09090b"/><path d="M43 82 128 38l85 44-85 44-85-44Zm0 23 73 38v76l-73-40v-74Zm170 0v74l-73 40v-76l73-38Z" fill="url(#g)"/><path d="m82 82 46-24 46 24-46 24-46-24Z" fill="#ede9fe" fill-opacity=".92"/></svg>`;

const STORAGE_PROVIDERS = [
  {
    id: "google-drive",
    name: "Google Workspace & Drive",
    mode: "native",
    driver: "GoogleDrive",
    mount: "/google-drive/<account>",
    supportsMultipleAccounts: true,
    accountTypes: ["personal", "workspace", "shared-drive"],
    services: ["Drive", "Docs", "Sheets", "Slides", "Gmail"],
    scopeProfiles: {
      files: ["drive.readonly"],
      workspace: ["drive.readonly", "documents.readonly", "spreadsheets.readonly"],
      workspaceWithGmail: ["drive.readonly", "documents.readonly", "spreadsheets.readonly", "gmail.readonly"],
    },
    note: "Docs, Sheets, and Slides files are collected through Drive. Gmail access is optional and requires a separately approved Gmail scope.",
    authorizationUrl: "https://api.oplist.org/",
  },
  {
    id: "dropbox",
    name: "Dropbox",
    mode: "native",
    driver: "Dropbox",
    mount: "/dropbox/<account>",
    supportsMultipleAccounts: true,
    accountTypes: ["personal", "business"],
    services: ["Files", "Paper exports"],
    authorizationUrl: "https://api.oplist.org/",
  },
  {
    id: "onedrive",
    name: "OneDrive",
    mode: "native",
    driver: "Onedrive",
    mount: "/onedrive/<account>",
    supportsMultipleAccounts: true,
    accountTypes: ["personal", "microsoft-365", "sharepoint"],
    services: ["OneDrive", "Office files", "SharePoint document libraries"],
    authorizationUrl: "https://api.oplist.org/",
  },
  {
    id: "box",
    name: "Box",
    mode: "collector",
    driver: "rclone",
    mount: "/box/<account>",
    supportsMultipleAccounts: true,
    accountTypes: ["personal", "business", "enterprise"],
    services: ["Files"],
    authorizationUrl: "https://rclone.org/box/",
  },
  {
    id: "terabox",
    name: "TeraBox",
    mode: "collector",
    driver: "rclone-compatible adapter",
    mount: "/terabox/<account>",
    supportsMultipleAccounts: true,
    accountTypes: ["personal"],
    services: ["Files"],
    note: "Use an approved runtime adapter. Never paste browser cookies into the Open-Box website or repository.",
    authorizationUrl: "https://rclone.org/",
  },
  {
    id: "mega",
    name: "MEGA",
    mode: "collector",
    driver: "rclone",
    mount: "/mega/<account>",
    supportsMultipleAccounts: true,
    accountTypes: ["personal", "business"],
    services: ["Files"],
    authorizationUrl: "https://rclone.org/mega/",
  },
];

export function safeNext(value) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/";
}

function cookieValue(request, name) {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

function sessionCookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearCookie(name) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function storageProviderManifest() {
  return {
    status: "ready_for_account_authorization",
    credentialPolicy: "provider tokens are stored server-side only",
    accountPolicy: "multiple accounts are supported; every account must use a unique label and mount path",
    sourcePolicy: "read and copy; never synchronize deletions to source accounts",
    managerPath: "/@manage",
    providers: STORAGE_PROVIDERS,
  };
}

async function probe(url, init = {}) {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(5000) });
    return { ok: response.ok, status: response.status, response };
  } catch (error) {
    return { ok: false, status: 0, error: String(error?.message || error) };
  }
}

export async function integrationStatus(env) {
  const [origin, settings, supabase] = await Promise.all([
    probe(`${env.ORIGIN_URL}/ping`),
    probe(`${env.ORIGIN_URL}/api/public/settings`),
    probe(`${env.SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY },
    }),
  ]);
  let openList = { title: "Open-Box", githubSso: false };
  if (settings.ok) {
    const payload = await settings.response.json().catch(() => ({}));
    openList = {
      title: payload?.data?.site_title || "Open-Box",
      githubSso: payload?.data?.sso_login_enabled === "true" && payload?.data?.sso_login_platform === "Github",
    };
  }
  const services = [
    { id: "cloudflare", name: "Cloudflare Gateway", state: "operational", detail: "Edge, TLS, routing, and settings UI" },
    { id: "zeabur", name: "Zeabur Runtime", state: origin.ok ? "operational" : "degraded", detail: "Open-Box application origin" },
    { id: "supabase", name: "Supabase", state: supabase.ok ? "operational" : "degraded", detail: "Postgres, Auth, Storage, and backups" },
    { id: "github", name: "GitHub SSO", state: openList.githubSso ? "operational" : "action_required", detail: "Administrator authentication" },
    { id: "workers-ai", name: "Workers AI", state: env.AI ? "operational" : "action_required", detail: "Edge AI chat and embeddings" },
    { id: "docker", name: "Docker Delivery", state: "configured", detail: "GitHub Actions image build and release" },
  ];
  return {
    status: services.some(({ state }) => state === "degraded") ? "degraded" : "operational",
    checkedAt: new Date().toISOString(),
    application: openList,
    services,
    storage: storageProviderManifest(),
  };
}

function statusBadge(state) {
  const label = state === "operational" ? "Operational" : state === "configured" ? "Configured" : state === "degraded" ? "Degraded" : "Action required";
  return `<span class="badge ${state}">${label}</span>`;
}

function integrationSettingsPage(appName, status) {
  const escapedName = String(appName || "Open-Box").replace(/[<>&"']/g, "");
  const services = status.services.map((service) => `<article class="service">
    <div><h3>${service.name}</h3><p>${service.detail}</p></div>${statusBadge(service.state)}
  </article>`).join("");
  const cards = STORAGE_PROVIDERS.map((provider) => {
    const kind = provider.mode === "native" ? "Native Open-Box storage driver" : "Open-Box collector";
    const services = provider.services.map((service) => `<span class="chip">${service}</span>`).join("");
    const accountTypes = provider.accountTypes.join(", ");
    return `<article class="card">
      <div class="row"><h2>${provider.name}</h2><span>Connect later</span></div>
      <p>${kind} · Multiple accounts supported</p>
      <div class="chips">${services}</div>
      <dl><div><dt>Account types</dt><dd>${accountTypes}</dd></div><div><dt>Driver</dt><dd>${provider.driver}</dd></div><div><dt>Mount</dt><dd><code>${provider.mount}</code></dd></div></dl>
      ${provider.note ? `<p class="note">${provider.note}</p>` : ""}
      <a class="secondary" href="${provider.authorizationUrl}" target="_blank" rel="noreferrer">Open authorization guide</a>
    </article>`;
  }).join("");
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Integration settings · ${escapedName}</title>
<style>
:root{color-scheme:dark;--bg:#09090b;--panel:#18181b;--line:#3f3f46;--text:#fafafa;--muted:#a1a1aa;--brand:#8b5cf6}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#24143d 0,var(--bg) 38%);color:var(--text);font:16px/1.5 system-ui,sans-serif}main{max-width:1080px;margin:auto;padding:64px 24px}header{max-width:780px;margin-bottom:32px}.eyebrow{color:#c4b5fd;font-weight:700;letter-spacing:.08em;text-transform:uppercase}h1{font-size:clamp(2rem,6vw,4rem);line-height:1.05;margin:.25em 0}h2{margin-top:38px}header p,.card p,.service p{color:var(--muted)}.notice{border:1px solid #166534;background:#052e16;padding:14px 16px;border-radius:14px;margin:24px 0}.notice strong{color:#86efac}.services,.grid{display:grid;gap:16px}.services{grid-template-columns:repeat(3,minmax(0,1fr))}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.card,.service{background:color-mix(in srgb,var(--panel) 92%,transparent);border:1px solid var(--line);border-radius:18px;padding:22px}.service{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.service h3,.service p{margin:0}.service p{margin-top:4px;font-size:.88rem}.row{display:flex;align-items:center;justify-content:space-between;gap:12px}.row h2{margin:0}.badge,.row>span,.chip{white-space:nowrap;border-radius:999px;padding:4px 9px;font-size:.76rem;font-weight:700}.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}.chip{color:#ddd6fe;background:#2e1065;border:1px solid #6d28d9}.note{font-size:.87rem}.operational{color:#86efac;background:#052e16;border:1px solid #166534}.configured{color:#bfdbfe;background:#172554;border:1px solid #1d4ed8}.degraded,.action_required,.row>span{color:#fde68a;background:#422006;border:1px solid #854d0e}dl{margin:18px 0}dl div{display:flex;justify-content:space-between;gap:16px;padding:8px 0;border-bottom:1px solid #27272a}dt{color:var(--muted)}dd{margin:0;text-align:right}code{color:#ddd6fe}.actions{display:flex;flex-wrap:wrap;gap:12px;margin:28px 0}a{display:inline-block;color:white;text-decoration:none;border-radius:10px;padding:11px 15px;font-weight:700}.primary{background:var(--brand)}.secondary{border:1px solid var(--line);padding:8px 11px;font-size:.9rem}.steps{color:var(--muted);padding-left:20px}.steps strong{color:var(--text)}footer{color:var(--muted);margin-top:36px;font-size:.9rem}@media(max-width:820px){.services{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:620px){main{padding:36px 18px}.grid,.services{grid-template-columns:1fr}.row{align-items:flex-start}dd{max-width:58%}}
</style></head><body><main>
<header><div class="eyebrow">${escapedName} settings</div><h1>Your clouds. One Open‑Box.</h1><p>Connect multiple personal and workspace accounts without mixing their identities. Every source keeps a unique mount and is collected read-only into master storage.</p></header>
<div class="notice"><strong>System ${status.status}.</strong> Last checked ${status.checkedAt.replace(/[TZ]/g, " ").slice(0, 19)} UTC. Cloudflare R2, Supabase S3, and the persistent application volume remain active.</div>
<h2>Core services</h2><section class="services">${services}</section>
<h2>Storage account connections</h2>
<section class="grid">${cards}</section>
<div class="actions"><a class="primary" href="/@manage">Open administrator settings</a><a class="secondary" href="/api/open-box/integrations/status">View status API</a><a class="secondary" href="/">Return to files</a></div>
<ol class="steps"><li>Sign in with the configured GitHub SSO administrator.</li><li>Authorize one provider account at a time.</li><li>Give every account a unique slug, such as <strong>personal-01</strong> or <strong>workspace-01</strong>.</li><li>Choose only the services and read-only scopes that account needs.</li><li>Verify listing and read access before enabling collection.</li><li>Use <strong>copy</strong>, never sync, when collecting into master storage.</li></ol>
<footer>No credentials are accepted or retained by this page. OAuth secrets and refresh tokens belong only in the server-side storage configuration.</footer>
</main></body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" } });
}

function authHeaders(env, accessToken) {
  return {
    apikey: env.SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${accessToken}`,
  };
}

async function getUser(env, accessToken) {
  if (!accessToken) return null;
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: authHeaders(env, accessToken),
  });
  return response.ok ? response.json() : null;
}

async function refreshSession(env, refreshToken) {
  if (!refreshToken) return null;
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  return response.ok ? response.json() : null;
}

function callbackPage(appName, next) {
  const escapedName = String(appName || "Open-Box").replace(/[<>&"']/g, "");
  const escapedNext = JSON.stringify(safeNext(next));
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${escapedName} sign in</title></head><body><p>Finishing secure sign in…</p>
<script>
(async()=>{const p=new URLSearchParams(location.hash.slice(1));if(p.get('error')){document.body.textContent=p.get('error_description')||'Sign in failed';return}
const r=await fetch('/auth/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({access_token:p.get('access_token'),refresh_token:p.get('refresh_token'),expires_in:Number(p.get('expires_in')||3600)})});
if(!r.ok){document.body.textContent='Unable to create a secure session';return} location.replace(${escapedNext});})();
</script></body></html>`, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; style-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
    },
  });
}

async function handleAuth(request, env, url) {
  if (url.pathname === "/auth/login") {
    const next = safeNext(url.searchParams.get("next"));
    const callback = `${url.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const target = new URL(`${env.SUPABASE_URL}/auth/v1/authorize`);
    target.searchParams.set("provider", "github");
    target.searchParams.set("redirect_to", callback);
    return Response.redirect(target, 302);
  }
  if (url.pathname === "/auth/callback") {
    return callbackPage(env.APP_NAME, url.searchParams.get("next"));
  }
  if (url.pathname === "/auth/session" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const user = await getUser(env, body.access_token);
    if (!user || !body.refresh_token) return json({ error: "invalid_session" }, 401);
    const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    headers.append("Set-Cookie", sessionCookie(ACCESS_COOKIE, body.access_token, Math.max(60, Number(body.expires_in) || 3600)));
    headers.append("Set-Cookie", sessionCookie(REFRESH_COOKIE, body.refresh_token, 60 * 60 * 24 * 30));
    return new Response(JSON.stringify({ user: { id: user.id, email: user.email } }), { headers });
  }
  if (url.pathname === "/auth/me") {
    const user = await getUser(env, cookieValue(request, ACCESS_COOKIE));
    return user ? json({ user: { id: user.id, email: user.email } }) : json({ user: null }, 401);
  }
  if (url.pathname === "/auth/logout") {
    const headers = new Headers({ Location: "/", "cache-control": "no-store" });
    headers.append("Set-Cookie", clearCookie(ACCESS_COOKIE));
    headers.append("Set-Cookie", clearCookie(REFRESH_COOKIE));
    return new Response(null, { status: 302, headers });
  }
  return json({ error: "not_found" }, 404);
}

async function handleAi(request, env, url) {
  if (!env.AI) {
    return json({ error: "workers_ai_not_bound", message: "AI binding missing on open-box-gateway" }, 503);
  }

  if (url.pathname === "/ai/health" && request.method === "GET") {
    return json({
      service: "open-box-gateway",
      ai: "ready",
      models: { text: AI_TEXT_MODEL, embed: AI_EMBED_MODEL },
    });
  }

  if (url.pathname === "/ai/chat" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const system = typeof body.system === "string" ? body.system.trim() : "You are a helpful assistant for Open-Box.";
    if (!prompt || prompt.length > 4000) {
      return json({ error: "invalid_prompt", message: "prompt required, max 4000 chars" }, 400);
    }
    const messages = [];
    if (system) messages.push({ role: "system", content: system.slice(0, 1000) });
    if (Array.isArray(body.messages)) {
      for (const m of body.messages.slice(-12)) {
        if (m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string") {
          messages.push({ role: m.role, content: m.content.slice(0, 2000) });
        }
      }
    }
    messages.push({ role: "user", content: prompt });
    try {
      const result = await env.AI.run(AI_TEXT_MODEL, {
        messages,
        max_tokens: Math.min(Number(body.max_tokens) || 512, 1024),
        temperature: Math.min(Math.max(Number(body.temperature) || 0.4, 0), 1),
      });
      const text = result?.response ?? result?.result ?? result;
      return json({ model: AI_TEXT_MODEL, text, raw: typeof result === "object" ? result : undefined });
    } catch (err) {
      return json({ error: "ai_failed", message: String(err?.message || err) }, 502);
    }
  }

  if (url.pathname === "/ai/embed" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text || text.length > 8000) {
      return json({ error: "invalid_text", message: "text required, max 8000 chars" }, 400);
    }
    try {
      const result = await env.AI.run(AI_EMBED_MODEL, { text: [text] });
      const embedding = result?.data?.[0] ?? result?.data ?? result;
      return json({ model: AI_EMBED_MODEL, embedding });
    } catch (err) {
      return json({ error: "ai_failed", message: String(err?.message || err) }, 502);
    }
  }

  return json({ error: "not_found", paths: ["/ai/health", "/ai/chat", "/ai/embed"] }, 404);
}

async function proxy(request, env, url) {
  const origin = new URL(env.ORIGIN_URL);
  const target = new URL(url.pathname + url.search, origin);
  const headers = new Headers(request.headers);
  headers.set("Host", origin.host);
  headers.set("X-Forwarded-Host", url.host);
  headers.set("X-Forwarded-Proto", "https");
  const response = await fetch(new Request(target, { method: request.method, headers, body: request.body, redirect: "manual" }));
  if (request.method === "GET" && url.pathname === "/api/public/settings" && response.ok) {
    const payload = await response.json().catch(() => null);
    if (payload?.data) {
      payload.data.site_title = "Open-Box";
      payload.data.logo = `${url.origin}/open-box-brand.svg`;
      payload.data.favicon = `${url.origin}/open-box-brand.svg`;
      payload.data.main_color = "#7c3aed";
      return json(payload, response.status);
    }
  }
  const output = new Response(response.body, response);
  output.headers.set("X-Content-Type-Options", "nosniff");
  output.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  output.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return output;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!env.ORIGIN_URL || !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
      return json({ error: "gateway_not_configured" }, 503);
    }
    if (url.pathname.startsWith("/auth/")) return handleAuth(request, env, url);
    if (url.pathname.startsWith("/ai/")) return handleAi(request, env, url);
    if (url.pathname === "/open-box-brand.svg" && (request.method === "GET" || request.method === "HEAD")) {
      return new Response(request.method === "HEAD" ? null : OPEN_BOX_BRAND_SVG, {
        headers: {
          "content-type": "image/svg+xml; charset=utf-8",
          "cache-control": "public, max-age=86400",
          "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
          "x-content-type-options": "nosniff",
        },
      });
    }
    if (url.pathname === "/api/open-box/storage-providers" && request.method === "GET") {
      return json(storageProviderManifest());
    }
    if (url.pathname === "/api/open-box/integrations/status" && request.method === "GET") {
      return json(await integrationStatus(env));
    }
    if ((url.pathname === "/connect-storage" || url.pathname === "/settings/integrations") && request.method === "GET") {
      return integrationSettingsPage(env.APP_NAME, await integrationStatus(env));
    }
    if (env.AUTH_REQUIRED === "true" && url.pathname !== "/ping") {
      let access = cookieValue(request, ACCESS_COOKIE);
      let user = await getUser(env, access);
      let refreshed = null;
      if (!user) {
        refreshed = await refreshSession(env, cookieValue(request, REFRESH_COOKIE));
        access = refreshed?.access_token || "";
        user = await getUser(env, access);
      }
      if (!user) {
        const next = safeNext(url.pathname + url.search);
        return Response.redirect(`${url.origin}/auth/login?next=${encodeURIComponent(next)}`, 302);
      }
      const response = await proxy(request, env, url);
      if (refreshed) {
        response.headers.append("Set-Cookie", sessionCookie(ACCESS_COOKIE, refreshed.access_token, refreshed.expires_in || 3600));
        response.headers.append("Set-Cookie", sessionCookie(REFRESH_COOKIE, refreshed.refresh_token, 60 * 60 * 24 * 30));
      }
      return response;
    }
    return proxy(request, env, url);
  },
};
