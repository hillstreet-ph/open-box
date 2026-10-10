import { handleAssistant } from "./assistant.js";
import { ASSISTANT_WIDGET } from "./assistant-widget.js";

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
      workspace: [
        "drive.readonly",
        "documents.readonly",
        "spreadsheets.readonly",
      ],
      workspaceWithGmail: [
        "drive.readonly",
        "documents.readonly",
        "spreadsheets.readonly",
        "gmail.readonly",
      ],
    },
    note: "Docs, Sheets, and Slides files are collected through Drive. Gmail access is optional and requires a separately approved Gmail scope.",
    authorizationUrl: "/settings/integrations/google-drive",
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
    authorizationUrl: "/settings/integrations/dropbox",
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
    authorizationUrl: "/settings/integrations/onedrive",
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

// Exact presentation literals only; protocol identifiers and driver keys remain stable.
const FRONTEND_BRAND_LABELS = {
  "Manage and configure OpenList extensions with ZIP file upload and third-party URL installation":
    "Manage and configure Open-Box extensions with ZIP file upload and third-party URL installation",
  "Initialize OpenList": "Initialize Open-Box",
  "Your OpenList instance is ready to use.":
    "Your Open-Box instance is ready to use.",
  "OpenList Management": "Open-Box Management",
  "Fill this only after OpenList reports that a 139 Mail SMS verification code was sent, then save the storage again.":
    "Fill this only after Open-Box reports that a 139 Mail SMS verification code was sent, then save the storage again.",
  "Allow uploading directly to OneDrive without going through OpenList":
    "Allow uploading directly to OneDrive without going through Open-Box",
  "Powered by OpenList": "Powered by Open-Box",
};
const OPEN_BOX_ABOUT = `# Open-Box

![Open-Box](/open-box-brand.svg)

Your clouds. One Open-Box.

Open-Box is HillStreet's multi-cloud file manager. Connect each storage account using its own authorization and mount path.

- [Connect storage](/settings/integrations)
- [Administration](/@manage/storages)
- [Source code](https://github.com/hillstreet-ph/open-box)
- [MCP setup](https://github.com/hillstreet-ph/open-box/blob/main/docs/platform/CHATGPT_MCP.md)

## Open-source attribution

Open-Box is derived from OpenList and AList under AGPL-3.0. Upstream contributors, copyright notices, source history and license terms are retained in the repository.

- [Upstream source](https://github.com/OpenListTeam/OpenList)
- [License](https://github.com/hillstreet-ph/open-box/blob/main/LICENSE)
`;

function versionFrontendImports(source) {
  return source.replace(
    /(["'`])((?:\/?assets\/|\.\.?\/)[^"'`\s?]+\.js)\1/g,
    "$1$2?open-box-brand=20261010$1",
  );
}

function applicationDocumentPath(pathname) {
  let path;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  return !/^\/(?:api|d|p|ad|ap|ae|sd|sad|dav|s3|assets|images|streamer|static|debug|i|mcp|auth|ai|\.well-known)(?:\/|$)/i.test(
    path,
  );
}

export function brandFrontendAsset(source, kind) {
  if (kind === "html") {
    const branded = versionFrontendImports(source).replace(
      /(<meta[^>]+(?:name="generator"|name="apple-mobile-web-app-title")[^>]+content=")OpenList("[^>]*>)/g,
      "$1Open-Box$2",
    );
    return branded.includes("/open-box-assistant.js")
      ? branded
      : branded.replace(
          "</body>",
          '<script defer src="/open-box-assistant.js?v=20261010-43"></script></body>',
        );
  }
  if (kind === "manifest") {
    let manifest;
    try {
      manifest = JSON.parse(source);
    } catch {
      return source;
    }
    manifest.name = "Open-Box";
    manifest.short_name = "Open-Box";
    manifest.icons = [
      {
        src: "/open-box-brand.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ];
    return JSON.stringify(manifest);
  }
  let result = versionFrontendImports(source);
  for (const [original, branded] of Object.entries(FRONTEND_BRAND_LABELS)) {
    result = result
      .split(JSON.stringify(original))
      .join(JSON.stringify(branded));
    // Rolldown emits template and single-quoted literals in modern/legacy chunks.
    for (const quote of ["`", "'"]) {
      const escape = (value) =>
        value
          .replaceAll("\\", "\\\\")
          .replaceAll(quote, "\\" + quote)
          .replaceAll("${", "\\${")
          .replaceAll("\n", "\\n")
          .replaceAll("\r", "\\r");
      result = result
        .split(quote + escape(original) + quote)
        .join(quote + escape(branded) + quote);
    }
  }
  return result
    .replaceAll(
      "https://raw.githubusercontent.com/OpenListTeam/OpenList/main/README.md",
      "/open-box-about.md",
    )
    .replaceAll(
      'href:"https://github.com/OpenListTeam/OpenList"',
      'href:"https://github.com/hillstreet-ph/open-box"',
    )
    .replaceAll(
      "href:`https://github.com/OpenListTeam/OpenList`",
      "href:`https://github.com/hillstreet-ph/open-box`",
    );
}

export function safeNext(value) {
  return typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//")
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
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export function storageProviderManifest() {
  return {
    status: "ready_for_account_authorization",
    credentialPolicy: "provider tokens are stored server-side only",
    accountPolicy:
      "multiple accounts are supported; every account must use a unique label and mount path",
    sourcePolicy:
      "read and copy; never synchronize deletions to source accounts",
    managerPath: "/@manage",
    providers: STORAGE_PROVIDERS,
  };
}

async function probe(url, init = {}) {
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(5000),
    });
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
      githubSso:
        payload?.data?.sso_login_enabled === "true" &&
        payload?.data?.sso_login_platform === "Github",
    };
  }
  const services = [
    {
      id: "cloudflare",
      name: "Cloudflare Gateway",
      state: "operational",
      detail: "Edge, TLS, routing, and settings UI",
    },
    {
      id: "zeabur",
      name: "Zeabur Runtime",
      state: origin.ok ? "operational" : "degraded",
      detail: "Open-Box application origin",
    },
    {
      id: "supabase",
      name: "Supabase",
      state: supabase.ok ? "operational" : "degraded",
      detail:
        "Auth endpoint health; database, storage, and backups require separate verification",
    },
    {
      id: "github",
      name: "GitHub SSO",
      state: openList.githubSso ? "operational" : "action_required",
      detail: "Administrator authentication",
    },
    {
      id: "workers-ai",
      name: "Workers AI",
      state: env.AI ? "operational" : "action_required",
      detail: "Edge AI chat and embeddings",
    },
    {
      id: "docker",
      name: "Docker Delivery",
      state: "configured",
      detail: "GitHub Actions image build and release",
    },
  ];
  return {
    status: services.some(({ state }) => state === "degraded")
      ? "degraded"
      : services.some(({ state }) => state === "action_required")
        ? "action_required"
        : "operational",
    checkedAt: new Date().toISOString(),
    application: openList,
    services,
    storage: storageProviderManifest(),
  };
}

function statusBadge(state) {
  const label =
    state === "operational"
      ? "Operational"
      : state === "configured"
        ? "Configured"
        : state === "degraded"
          ? "Degraded"
          : "Action required";
  return `<span class="badge ${state}">${label}</span>`;
}

function integrationSettingsPage(appName, status) {
  const escapedName = String(appName || "Open-Box").replace(/[<>&"']/g, "");
  const services = status.services
    .map(
      (service) => `<article class="service">
    <div><h3>${service.name}</h3><p>${service.detail}</p></div>${statusBadge(service.state)}
  </article>`,
    )
    .join("");
  const cards = STORAGE_PROVIDERS.map((provider) => {
    const kind =
      provider.mode === "native"
        ? "Native Open-Box storage driver"
        : "Open-Box collector";
    const services = provider.services
      .map((service) => `<span class="chip">${service}</span>`)
      .join("");
    const accountTypes = provider.accountTypes.join(", ");
    return `<article class="card">
      <div class="row"><h2>${provider.name}</h2><span>Connect later</span></div>
      <p>${kind} · Multiple accounts supported</p>
      <div class="chips">${services}</div>
      <dl><div><dt>Account types</dt><dd>${accountTypes}</dd></div><div><dt>Driver</dt><dd>${provider.driver}</dd></div><div><dt>Mount</dt><dd><code>${provider.mount.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</code></dd></div></dl>
      ${provider.note ? `<p class="note">${provider.note}</p>` : ""}
      <a class="secondary" href="${provider.authorizationUrl}" target="_blank" rel="noreferrer">Open authorization guide</a>
    </article>`;
  }).join("");
  return new Response(
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Integration settings · ${escapedName}</title>
<style>
:root{color-scheme:dark;--bg:#09090b;--panel:#18181b;--line:#3f3f46;--text:#fafafa;--muted:#a1a1aa;--brand:#8b5cf6}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#24143d 0,var(--bg) 38%);color:var(--text);font:16px/1.5 system-ui,sans-serif}main{max-width:1080px;margin:auto;padding:64px 24px}header{max-width:780px;margin-bottom:32px}.eyebrow{color:#c4b5fd;font-weight:700;letter-spacing:.08em;text-transform:uppercase}h1{font-size:clamp(2rem,6vw,4rem);line-height:1.05;margin:.25em 0}h2{margin-top:38px}header p,.card p,.service p{color:var(--muted)}.notice{border:1px solid #166534;background:#052e16;padding:14px 16px;border-radius:14px;margin:24px 0}.notice strong{color:#86efac}.services,.grid{display:grid;gap:16px}.services{grid-template-columns:repeat(3,minmax(0,1fr))}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.card,.service{background:color-mix(in srgb,var(--panel) 92%,transparent);border:1px solid var(--line);border-radius:18px;padding:22px}.service{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.service h3,.service p{margin:0}.service p{margin-top:4px;font-size:.88rem}.row{display:flex;align-items:center;justify-content:space-between;gap:12px}.row h2{margin:0}.badge,.row>span,.chip{white-space:nowrap;border-radius:999px;padding:4px 9px;font-size:.76rem;font-weight:700}.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}.chip{color:#ddd6fe;background:#2e1065;border:1px solid #6d28d9}.note{font-size:.87rem}.operational{color:#86efac;background:#052e16;border:1px solid #166534}.configured{color:#bfdbfe;background:#172554;border:1px solid #1d4ed8}.degraded,.action_required,.row>span{color:#fde68a;background:#422006;border:1px solid #854d0e}dl{margin:18px 0}dl div{display:flex;justify-content:space-between;gap:16px;padding:8px 0;border-bottom:1px solid #27272a}dt{color:var(--muted)}dd{margin:0;text-align:right}code{color:#ddd6fe}.actions{display:flex;flex-wrap:wrap;gap:12px;margin:28px 0}a{display:inline-block;color:white;text-decoration:none;border-radius:10px;padding:11px 15px;font-weight:700}.primary{background:var(--brand)}.secondary{border:1px solid var(--line);padding:8px 11px;font-size:.9rem}.steps{color:var(--muted);padding-left:20px}.steps strong{color:var(--text)}footer{color:var(--muted);margin-top:36px;font-size:.9rem}@media(max-width:820px){.services{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:620px){main{padding:36px 18px}.grid,.services{grid-template-columns:1fr}.row{align-items:flex-start}dd{max-width:58%}}
</style></head><body><main>
<header><div class="eyebrow">${escapedName} settings</div><h1>Your clouds. One Open‑Box.</h1><p>Connect multiple personal and workspace accounts without mixing their identities. Use a unique mount for every source account. Enable collection after listing and read access have been verified.</p></header>
<div class="notice"><strong>System ${status.status.replaceAll("_", " ")}.</strong> Last checked ${status.checkedAt.replace(/[TZ]/g, " ").slice(0, 19)} UTC. Storage accounts, filesystem mounts, backups, and the persistent application volume require separate verification.</div>
<h2>Core services</h2><section class="services">${services}</section>
<h2>Storage account connections</h2>
<section class="grid">${cards}</section>
<div class="actions"><a class="primary" href="/@manage">Open administrator settings</a><a class="secondary" href="/api/open-box/integrations/status">View status API</a><a class="secondary" href="/">Return to files</a></div>
<ol class="steps"><li>Sign in to the administrator account; enable GitHub SSO only after its configuration is verified.</li><li>Authorize one provider account at a time.</li><li>Give every account a unique slug, such as <strong>personal-01</strong> or <strong>workspace-01</strong>.</li><li>Choose only the services and read-only scopes that account needs.</li><li>Verify listing and read access before enabling collection.</li><li>Use <strong>copy</strong>, never sync, when collecting into master storage.</li></ol>
<footer>No credentials are accepted or retained by this page. OAuth secrets and refresh tokens belong only in the server-side storage configuration.</footer>
</main></body></html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

function authHeaders(env, accessToken) {
  return {
    apikey: env.SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${accessToken}`,
  };
}

function storageSetupPage(provider) {
  const steps = {
    "google-drive":
      "Authorize the intended Google account with the registered Drive OAuth application. Keep its client secret and refresh token in the server-side GoogleDrive storage configuration. Docs, Sheets and Slides files use Drive; Gmail needs separate consent.",
    dropbox:
      "Use the registered Dropbox OAuth application to authorize the intended account. Keep its app secret and refresh token in the server-side Dropbox storage configuration.",
    onedrive:
      "Use the registered Microsoft OAuth application for the intended personal or work account. Register the matching callback and approved permissions, then keep its secret and refresh token in the server-side Onedrive storage configuration. SharePoint may require tenant administrator consent.",
  };
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${provider.name} · Open-Box</title><style>body{margin:0;background:#09090b;color:#fafafa;font:16px/1.6 system-ui}main{max-width:760px;margin:auto;padding:40px 20px}a{color:#c4b5fd}h1{line-height:1.2}.card{padding:20px;border:1px solid #52525b;border-radius:16px;margin:24px 0}.action{display:inline-block;padding:12px 16px;background:#7c3aed;color:white;border-radius:12px;text-decoration:none}code{overflow-wrap:anywhere}</style></head><body><main><p><a href="/settings/integrations">← Integrations</a></p><h1>Connect ${provider.name} to Open-Box</h1><p>Connect each account with its own authorization and mount path.</p><div class="card"><strong>Authorization required</strong><p>${steps[provider.id]}</p><ol><li>Sign in to Open-Box administration.</li><li>Add a storage using the <strong>${provider.driver}</strong> driver.</li><li>Choose one unique account slug for <code>${provider.mount.replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</code>.</li><li>Complete provider consent for that account and enter credentials only in the protected administrator storage configuration.</li><li>Verify folder listing and file reading before enabling collection.</li></ol></div><a class="action" href="/@manage/storages">Open storage administration</a><p>This guide does not accept credentials or claim that an account is connected. Open-Box cannot reuse a Composio grant as a native refresh token without a verified scoped broker.</p><p>Use Agent Assistant for permitted file operations after the account is mounted.</p></main></body></html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
        "x-content-type-options": "nosniff",
      },
    },
  );
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
  const response = await fetch(
    `${env.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
    {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_PUBLISHABLE_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    },
  );
  return response.ok ? response.json() : null;
}

function callbackPage(appName, next) {
  const escapedName = String(appName || "Open-Box").replace(/[<>&"']/g, "");
  const escapedNext = JSON.stringify(safeNext(next));
  return new Response(
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${escapedName} sign in</title></head><body><p>Finishing secure sign in…</p>
<script>
(async()=>{const p=new URLSearchParams(location.hash.slice(1));if(p.get('error')){document.body.textContent=p.get('error_description')||'Sign in failed';return}
const r=await fetch('/auth/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({access_token:p.get('access_token'),refresh_token:p.get('refresh_token'),expires_in:Number(p.get('expires_in')||3600)})});
if(!r.ok){document.body.textContent='Unable to create a secure session';return} location.replace(${escapedNext});})();
</script></body></html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy":
          "default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; style-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        "referrer-policy": "no-referrer",
      },
    },
  );
}

function oauthConsentPage(request, env, url) {
  if (request.method !== "GET") {
    return json({ error: "method_not_allowed" }, 405, { allow: "GET" });
  }
  let supabaseOrigin;
  try {
    supabaseOrigin = new URL(env.SUPABASE_URL).origin;
  } catch {
    return json({ error: "invalid_supabase_url" }, 503);
  }
  const authorizationId = url.searchParams.get("authorization_id") || "";
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(authorizationId)) {
    return json({ error: "invalid_authorization_request" }, 400);
  }
  const script = [
    'import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";',
    "const supabase = createClient(" +
      JSON.stringify(env.SUPABASE_URL) +
      "," +
      JSON.stringify(env.SUPABASE_PUBLISHABLE_KEY) +
      ',{auth:{flowType:"pkce",persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});',
    "const authorizationId = " + JSON.stringify(authorizationId) + ";",
    'const status = document.getElementById("status");',
    'const details = document.getElementById("details");',
    'const login = document.getElementById("login");',
    'const approve = document.getElementById("approve");',
    'const deny = document.getElementById("deny");',
    'const redirect = (value) => { const target = new URL(value); if (target.protocol !== "https:") throw new Error("Unsafe OAuth redirect"); location.replace(target.href); };',
    "async function loadRequest() {",
    "  const sessionResult = await supabase.auth.getSession();",
    '  if (!sessionResult.data.session) { status.textContent = "Sign in to Supabase to review this request."; login.hidden = false; return; }',
    "  const result = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);",
    "  if (result.error) throw result.error;",
    "  const authorization = result.data || {};",
    '  if (!("authorization_id" in authorization)) { redirect(authorization.redirect_url); return; }',
    "  const request = authorization.authorization || authorization;",
    "  const client = request.oauth_client || request.client || {};",
    '  document.getElementById("client").textContent = client.client_name || client.name || request.client_name || "Connected AI app";',
    '  document.getElementById("scopes").textContent = request.scope || request.scopes || "No scopes listed";',
    '  document.getElementById("redirect-uri").textContent = request.redirect_uri || client.redirect_uri || "Verified by Supabase Auth";',
    '  details.hidden = false; status.textContent = "Review the app and requested access before approving."; login.hidden = true;',
    "}",
    'login.addEventListener("click", async () => { status.textContent = "Redirecting to sign in…"; const result = await supabase.auth.signInWithOAuth({provider:"github",options:{redirectTo:location.href}}); if (result.error) status.textContent = result.error.message; });',
    'approve.addEventListener("click", async () => { approve.disabled = true; const result = await supabase.auth.oauth.approveAuthorization(authorizationId,{skipBrowserRedirect:true}); if (result.error) { status.textContent = result.error.message; approve.disabled = false; return; } try { redirect(result.data?.redirect_url || result.redirect_url); } catch (error) { status.textContent = error.message; approve.disabled = false; } });',
    'deny.addEventListener("click", async () => { deny.disabled = true; const result = await supabase.auth.oauth.denyAuthorization(authorizationId,{skipBrowserRedirect:true}); if (result.error) { status.textContent = result.error.message; deny.disabled = false; return; } try { redirect(result.data?.redirect_url || result.redirect_url); } catch (error) { status.textContent = error.message; deny.disabled = false; } });',
    'loadRequest().catch(() => { status.textContent = "Unable to load the authorization request. Return to ChatGPT and try again."; });',
  ].join("\n");
  const html = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    "<title>Connect ChatGPT · Open-Box</title>",
    "<style>body{font:16px/1.5 system-ui,sans-serif;background:#09090b;color:#fafafa;margin:0}main{max-width:640px;margin:10vh auto;padding:28px;background:#18181b;border:1px solid #3f3f46;border-radius:18px}p,dt{color:#a1a1aa}dl div{display:grid;grid-template-columns:130px 1fr;gap:12px;padding:10px 0;border-bottom:1px solid #27272a}dd{margin:0;overflow-wrap:anywhere}button{margin:14px 8px 0 0;padding:12px 16px;border:0;border-radius:10px;background:#7c3aed;color:white;font-weight:700}button.secondary{background:#27272a}button:disabled{opacity:.5}</style>",
    "</head><body><main><p>OPEN-BOX · SECURE CONNECTION</p><h1>Review access request</h1>",
    '<p id="status" role="status">Checking your sign-in…</p>',
    '<section id="details" hidden><dl><div><dt>App</dt><dd id="client"></dd></div><div><dt>Requested access</dt><dd id="scopes"></dd></div><div><dt>Callback</dt><dd id="redirect-uri"></dd></div></dl>',
    "<p>Approving lets this app use the listed access as your linked Open-Box account. You can revoke the connection in Supabase Auth settings.</p>",
    '<button id="approve">Allow access</button><button class="secondary" id="deny">Decline</button></section>',
    '<button id="login" hidden>Sign in with GitHub</button></main><script type="module">' +
      script +
      "</script></body></html>",
  ].join("");
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; script-src 'unsafe-inline' https://esm.sh; connect-src 'self' " +
        supabaseOrigin +
        "; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
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
    if (!user || !body.refresh_token)
      return json({ error: "invalid_session" }, 401);
    const headers = new Headers({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    headers.append(
      "Set-Cookie",
      sessionCookie(
        ACCESS_COOKIE,
        body.access_token,
        Math.max(60, Number(body.expires_in) || 3600),
      ),
    );
    headers.append(
      "Set-Cookie",
      sessionCookie(REFRESH_COOKIE, body.refresh_token, 60 * 60 * 24 * 30),
    );
    return new Response(
      JSON.stringify({ user: { id: user.id, email: user.email } }),
      { headers },
    );
  }
  if (url.pathname === "/auth/me") {
    const user = await getUser(env, cookieValue(request, ACCESS_COOKIE));
    return user
      ? json({ user: { id: user.id, email: user.email } })
      : json({ user: null }, 401);
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
    return json(
      {
        error: "workers_ai_not_bound",
        message: "AI binding missing on open-box-gateway",
      },
      503,
    );
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
    const system =
      typeof body.system === "string"
        ? body.system.trim()
        : "You are a helpful assistant for Open-Box.";
    if (!prompt || prompt.length > 4000) {
      return json(
        { error: "invalid_prompt", message: "prompt required, max 4000 chars" },
        400,
      );
    }
    const messages = [];
    if (system)
      messages.push({ role: "system", content: system.slice(0, 1000) });
    if (Array.isArray(body.messages)) {
      for (const m of body.messages.slice(-12)) {
        if (
          m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string"
        ) {
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
      return json({
        model: AI_TEXT_MODEL,
        text,
        raw: typeof result === "object" ? result : undefined,
      });
    } catch (err) {
      return json(
        { error: "ai_failed", message: String(err?.message || err) },
        502,
      );
    }
  }

  if (url.pathname === "/ai/embed" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text || text.length > 8000) {
      return json(
        { error: "invalid_text", message: "text required, max 8000 chars" },
        400,
      );
    }
    try {
      const result = await env.AI.run(AI_EMBED_MODEL, { text: [text] });
      const embedding = result?.data?.[0] ?? result?.data ?? result;
      return json({ model: AI_EMBED_MODEL, embedding });
    } catch (err) {
      return json(
        { error: "ai_failed", message: String(err?.message || err) },
        502,
      );
    }
  }

  return json(
    { error: "not_found", paths: ["/ai/health", "/ai/chat", "/ai/embed"] },
    404,
  );
}

async function proxy(request, env, url) {
  const origin = new URL(env.ORIGIN_URL);
  const target = new URL(url.pathname + url.search, origin);
  const headers = new Headers(request.headers);
  if (
    request.method === "GET" &&
    (url.pathname.startsWith("/assets/") ||
      url.pathname === "/manifest.json" ||
      url.pathname.startsWith("/@manage") ||
      url.pathname === "/")
  ) {
    headers.delete("If-None-Match");
    headers.delete("If-Modified-Since");
  }
  headers.set("Host", origin.host);
  headers.set("X-Forwarded-Host", url.host);
  headers.set("X-Forwarded-Proto", "https");
  const response = await fetch(
    new Request(target, {
      method: request.method,
      headers,
      body: request.body,
      redirect: "manual",
    }),
  );
  if (
    request.method === "GET" &&
    url.pathname === "/api/public/settings" &&
    response.ok
  ) {
    const payload = await response.json().catch(() => null);
    if (payload?.data) {
      payload.data.site_title = "Open-Box";
      payload.data.logo = `${url.origin}/open-box-brand.svg`;
      payload.data.favicon = `${url.origin}/open-box-brand.svg`;
      payload.data.main_color = "#7c3aed";
      return json(payload, response.status);
    }
  }
  const contentType = response.headers.get("content-type") || "";
  let kind = "";
  if (request.method === "GET" && response.status === 200) {
    const applicationDocument = applicationDocumentPath(url.pathname);
    if (applicationDocument && contentType.includes("text/html")) kind = "html";
    if (
      url.pathname.startsWith("/assets/") &&
      url.pathname.endsWith(".js") &&
      /(?:javascript|ecmascript)/.test(contentType)
    )
      kind = "javascript";
    if (url.pathname === "/manifest.json" && contentType.includes("json"))
      kind = "manifest";
  }
  let output;
  if (kind) {
    const source = await response.clone().text();
    if (
      kind === "html" &&
      !(
        source.includes("window.OPENLIST_CONFIG") &&
        /<div[^>]+id=["']root["']/.test(source)
      )
    )
      kind = "";
    output = kind
      ? new Response(brandFrontendAsset(source, kind), response)
      : new Response(response.body, response);
  } else output = new Response(response.body, response);
  if (kind) {
    for (const header of [
      "content-length",
      "content-encoding",
      "etag",
      "last-modified",
    ])
      output.headers.delete(header);
    output.headers.set(
      "cache-control",
      kind === "html" ? "no-store" : "public, max-age=300, must-revalidate",
    );
  }
  output.headers.set("X-Content-Type-Options", "nosniff");
  output.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  output.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  return output;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!env.ORIGIN_URL || !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
      return json({ error: "gateway_not_configured" }, 503);
    }
    if (url.pathname.startsWith("/api/open-box/assistant/"))
      return handleAssistant(request, env);
    if (url.pathname === "/open-box-assistant.js" && request.method === "GET")
      return new Response(ASSISTANT_WIDGET, {
        headers: {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "public, max-age=300, must-revalidate",
          "x-content-type-options": "nosniff",
        },
      });
    if (url.pathname === "/oauth/consent")
      return oauthConsentPage(request, env, url);
    if (url.pathname === "/open-box-about.md" && request.method === "GET")
      return new Response(OPEN_BOX_ABOUT, {
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "cache-control": "public, max-age=300",
          "x-content-type-options": "nosniff",
        },
      });
    if (url.pathname.startsWith("/auth/")) return handleAuth(request, env, url);
    if (url.pathname.startsWith("/ai/")) return handleAi(request, env, url);
    if (
      url.pathname === "/open-box-brand.svg" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      return new Response(
        request.method === "HEAD" ? null : OPEN_BOX_BRAND_SVG,
        {
          headers: {
            "content-type": "image/svg+xml; charset=utf-8",
            "cache-control": "public, max-age=86400",
            "content-security-policy":
              "default-src 'none'; style-src 'unsafe-inline'",
            "x-content-type-options": "nosniff",
          },
        },
      );
    }
    if (
      url.pathname === "/api/open-box/storage-providers" &&
      request.method === "GET"
    ) {
      return json(storageProviderManifest());
    }
    if (
      url.pathname === "/api/open-box/integrations/status" &&
      request.method === "GET"
    ) {
      return json(await integrationStatus(env));
    }
    if (
      (url.pathname === "/connect-storage" ||
        url.pathname === "/settings/integrations") &&
      request.method === "GET"
    ) {
      return integrationSettingsPage(
        env.APP_NAME,
        await integrationStatus(env),
      );
    }
    if (
      request.method === "GET" &&
      url.pathname.startsWith("/settings/integrations/")
    ) {
      const provider = STORAGE_PROVIDERS.find(
        (item) =>
          item.authorizationUrl === url.pathname && item.mode === "native",
      );
      if (provider) return storageSetupPage(provider);
      return json({ error: "not_found" }, 404);
    }
    const isMcpRoute =
      url.pathname === "/mcp" ||
      url.pathname.startsWith("/mcp/") ||
      url.pathname === "/.well-known/oauth-protected-resource" ||
      url.pathname === "/.well-known/oauth-protected-resource/mcp";
    if (
      env.AUTH_REQUIRED === "true" &&
      url.pathname !== "/ping" &&
      !isMcpRoute
    ) {
      let access = cookieValue(request, ACCESS_COOKIE);
      let user = await getUser(env, access);
      let refreshed = null;
      if (!user) {
        refreshed = await refreshSession(
          env,
          cookieValue(request, REFRESH_COOKIE),
        );
        access = refreshed?.access_token || "";
        user = await getUser(env, access);
      }
      if (!user) {
        const next = safeNext(url.pathname + url.search);
        return Response.redirect(
          `${url.origin}/auth/login?next=${encodeURIComponent(next)}`,
          302,
        );
      }
      const response = await proxy(request, env, url);
      if (refreshed) {
        response.headers.append(
          "Set-Cookie",
          sessionCookie(
            ACCESS_COOKIE,
            refreshed.access_token,
            refreshed.expires_in || 3600,
          ),
        );
        response.headers.append(
          "Set-Cookie",
          sessionCookie(
            REFRESH_COOKIE,
            refreshed.refresh_token,
            60 * 60 * 24 * 30,
          ),
        );
      }
      return response;
    }
    return proxy(request, env, url);
  },
};
