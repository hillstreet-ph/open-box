const ACCESS_COOKIE = "open_box_access";
const REFRESH_COOKIE = "open_box_refresh";
const AI_TEXT_MODEL = "@cf/meta/llama-3.2-3b-instruct";
const AI_EMBED_MODEL = "@cf/baai/bge-m3";

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
