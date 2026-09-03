const ACCESS_COOKIE = "open_box_access";
const REFRESH_COOKIE = "open_box_refresh";
const AI_TEXT_MODEL = "@cf/meta/llama-3.2-3b-instruct";
const AI_EMBED_MODEL = "@cf/baai/bge-m3";

const STORAGE_PROVIDERS = [
  {
    id: "google-drive",
    name: "Google Drive",
    mode: "native",
    driver: "GoogleDrive",
    mount: "/google-drive/<account>",
    authorizationUrl: "https://api.oplist.org/",
  },
  {
    id: "dropbox",
    name: "Dropbox",
    mode: "native",
    driver: "Dropbox",
    mount: "/dropbox/<account>",
    authorizationUrl: "https://api.oplist.org/",
  },
  {
    id: "onedrive",
    name: "OneDrive",
    mode: "native",
    driver: "Onedrive",
    mount: "/onedrive/<account>",
    authorizationUrl: "https://api.oplist.org/",
  },
  {
    id: "box",
    name: "Box",
    mode: "collector",
    driver: "rclone",
    mount: "/box/<account>",
    authorizationUrl: "https://rclone.org/box/",
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
    sourcePolicy: "read and copy; never synchronize deletions to source accounts",
    managerPath: "/@manage",
    providers: STORAGE_PROVIDERS,
  };
}

function storageConnectionsPage(appName) {
  const escapedName = String(appName || "Open-Box").replace(/[<>&"']/g, "");
  const cards = STORAGE_PROVIDERS.map((provider) => {
    const kind = provider.mode === "native" ? "Native OpenList driver" : "rclone collector";
    return `<article class="card">
      <div class="row"><h2>${provider.name}</h2><span>Connect later</span></div>
      <p>${kind}</p>
      <dl><div><dt>Driver</dt><dd>${provider.driver}</dd></div><div><dt>Mount</dt><dd><code>${provider.mount}</code></dd></div></dl>
      <a class="secondary" href="${provider.authorizationUrl}" target="_blank" rel="noreferrer">Open authorization guide</a>
    </article>`;
  }).join("");
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect storage · ${escapedName}</title>
<style>
:root{color-scheme:dark;--bg:#09090b;--panel:#18181b;--line:#3f3f46;--text:#fafafa;--muted:#a1a1aa;--brand:#8b5cf6;--ok:#22c55e}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#24143d 0,var(--bg) 38%);color:var(--text);font:16px/1.5 system-ui,sans-serif}main{max-width:1080px;margin:auto;padding:64px 24px}header{max-width:760px;margin-bottom:32px}.eyebrow{color:#c4b5fd;font-weight:700;letter-spacing:.08em;text-transform:uppercase}h1{font-size:clamp(2rem,6vw,4rem);line-height:1.05;margin:.25em 0}header p,.card p{color:var(--muted)}.notice{border:1px solid #166534;background:#052e16;padding:14px 16px;border-radius:14px;margin:24px 0}.notice strong{color:#86efac}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.card{background:color-mix(in srgb,var(--panel) 92%,transparent);border:1px solid var(--line);border-radius:18px;padding:22px}.row{display:flex;align-items:center;justify-content:space-between;gap:12px}.row h2{margin:0}.row span{white-space:nowrap;color:#fde68a;background:#422006;border:1px solid #854d0e;border-radius:999px;padding:4px 9px;font-size:.78rem}dl{margin:18px 0}dl div{display:flex;justify-content:space-between;gap:16px;padding:8px 0;border-bottom:1px solid #27272a}dt{color:var(--muted)}dd{margin:0;text-align:right}code{color:#ddd6fe}.actions{display:flex;flex-wrap:wrap;gap:12px;margin:28px 0}a{display:inline-block;color:white;text-decoration:none;border-radius:10px;padding:11px 15px;font-weight:700}.primary{background:var(--brand)}.secondary{border:1px solid var(--line);padding:8px 11px;font-size:.9rem}.steps{color:var(--muted);padding-left:20px}.steps strong{color:var(--text)}footer{color:var(--muted);margin-top:36px;font-size:.9rem}@media(max-width:720px){main{padding:36px 18px}.grid{grid-template-columns:1fr}.row{align-items:flex-start}}
</style></head><body><main>
<header><div class="eyebrow">${escapedName} integrations</div><h1>Connect your storage accounts when ready.</h1><p>The backend, master storage, and provider drivers are prepared. Authorize accounts later without rebuilding or exposing OAuth tokens to the frontend.</p></header>
<div class="notice"><strong>Production storage is active.</strong> Cloudflare R2, Supabase S3, and the persistent application volume remain available while source accounts are pending.</div>
<section class="grid">${cards}</section>
<div class="actions"><a class="primary" href="/@manage">Open storage manager</a><a class="secondary" href="/">Return to files</a></div>
<ol class="steps"><li>Sign in with the configured GitHub SSO administrator.</li><li>Authorize one provider account at a time.</li><li>Create a unique mount path using the pattern shown above.</li><li>Verify listing and read access before enabling collection.</li><li>Use <strong>copy</strong>, never sync, when collecting into master storage.</li></ol>
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
    if (url.pathname === "/api/open-box/storage-providers" && request.method === "GET") {
      return json(storageProviderManifest());
    }
    if (url.pathname === "/connect-storage" && request.method === "GET") {
      return storageConnectionsPage(env.APP_NAME);
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
