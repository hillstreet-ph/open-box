export const ASSISTANT_WIDGET = String.raw`(() => {
  if (document.getElementById('open-box-agent-assistant')) return;
  const host = document.createElement('div');
  host.id = 'open-box-agent-assistant';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<style>' +
    ':host{position:fixed;left:16px;bottom:calc(20px + env(safe-area-inset-bottom));z-index:1000;font:14px/1.5 system-ui,sans-serif;color:#fafafa}*{box-sizing:border-box}[hidden]{display:none!important}button,a,textarea{font:inherit}button,a{min-height:44px;border:0;border-radius:22px;cursor:pointer;padding:10px 16px}button{background:#7c3aed;color:#fff}button:disabled{opacity:.5;cursor:wait}a{display:inline-flex;align-items:center;background:#18181b;color:#ddd6fe;text-decoration:none;border:1px solid #52525b}.dock{display:flex;align-items:center;gap:8px}.launcher{display:flex;align-items:center;gap:8px;box-shadow:0 4px 20px #0004}.launcher svg{width:22px;height:22px}.panel{position:absolute;left:0;bottom:58px;width:min(380px,calc(100vw - 32px));height:min(570px,calc(100dvh - 110px));border:1px solid #52525b;border-radius:20px;background:#18181b;box-shadow:0 8px 40px #0006;display:flex;flex-direction:column;overflow:hidden}header{background:#2e1065;padding:14px 16px;display:flex;justify-content:space-between;align-items:center}h2{font-size:16px;margin:0}header small{color:#ddd6fe}header button{background:transparent;padding:6px 12px;min-height:36px;font-size:22px}.messages{padding:16px;overflow:auto;flex:1;white-space:pre-wrap;overflow-wrap:anywhere}.message{padding:10px 12px;border-radius:12px;background:#27272a;margin-bottom:10px}.user{background:#3b2070}.label{display:block;font-weight:700;font-size:12px;margin-bottom:4px;color:#c4b5fd}.review{padding:12px;background:#24143d;border-top:1px solid #52525b}.review pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0}.review button{margin-right:8px}form{padding:12px;border-top:1px solid #3f3f46}label{display:block;font-weight:600;margin-bottom:5px}textarea{resize:vertical;width:100%;min-height:64px;max-height:150px;border:1px solid #71717a;border-radius:12px;background:#09090b;color:#fafafa;padding:10px}form button{margin-top:8px;width:100%}.note{font-size:11px;color:#a1a1aa;margin:6px 0 0}:focus-visible{outline:3px solid #c4b5fd;outline-offset:3px}@media(max-width:420px){.launcher{padding:10px 12px}.dock a{padding:10px 12px}}' +
    '</style><section class="panel" role="dialog" aria-modal="false" aria-label="Agent Assistant" hidden><header><div><h2>Agent Assistant</h2><small>Open-Box internal helper</small></div><button type="button" aria-label="Close Agent Assistant">×</button></header><div class="messages" role="log" aria-live="polite"></div><div class="review" hidden><strong>Review file change</strong><pre></pre><button type="button" class="confirm">Execute change</button><button type="button" class="cancel">Cancel</button></div><form><label for="prompt">What would you like to do?</label><textarea id="prompt" maxlength="4000" placeholder="List /Workspace, or create /Workspace/Reports" required></textarea><button type="submit">Send</button><p class="note">Uses your Open-Box permissions. Never enter passwords or tokens.</p></form></section><nav class="dock" aria-label="Open-Box helpers"><button class="launcher" type="button" aria-expanded="false" aria-label="Open Agent Assistant"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-1 2v-9.5a8.5 8.5 0 0 1 17-1Z"/><path d="M7 11h8M7 15h5"/></svg>Agent Assistant</button><a href="/settings/integrations">Integrations</a></nav>';
  document.body.append(host);
  document.querySelectorAll('nav[aria-label="Open-Box integrations"]').forEach(node => node.remove());
  const panel = root.querySelector('.panel');
  const launcher = root.querySelector('.launcher');
  const prompt = root.querySelector('textarea');
  const messages = root.querySelector('.messages');
  const review = root.querySelector('.review');
  const send = root.querySelector('form button');
  const confirm = root.querySelector('.confirm');
  let pending = null;
  let pendingToken = null;
  let busy = false;
  function token() { return localStorage.getItem('token') || ''; }
  let conversationToken = token();
  function syncSession() {
    if (conversationToken !== token()) {
      conversationToken = token(); clearPlan(); messages.replaceChildren();
    }
  }
  function add(label, text, user = false) {
    const node = document.createElement('div');
    node.className = user ? 'message user' : 'message';
    const title = document.createElement('span'); title.className = 'label'; title.textContent = label;
    node.append(title, document.createTextNode(text)); messages.append(node); messages.scrollTop = messages.scrollHeight;
  }
  function clearPlan() { pending = null; pendingToken = null; review.hidden = true; }
  function setBusy(value) { busy = value; send.disabled = value; confirm.disabled = value; }
  async function api(route, body, expectedToken) {
    syncSession();
    const current = token();
    if (!current || (expectedToken && current !== expectedToken)) { clearPlan(); throw new Error('Sign in to Open-Box before using Agent Assistant.'); }
    const response = await fetch('/api/open-box/assistant/' + route, {
      method: body ? 'POST' : 'GET', headers: { Authorization: current, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin', cache: 'no-store',
    });
    const result = await response.json().catch(() => null);
    if (token() !== current) { clearPlan(); throw new Error('Your sign-in changed. Please submit the request again.'); }
    if (!response.ok) {
      if (response.status === 401) { clearPlan(); throw new Error('Sign in to Open-Box before using Agent Assistant.'); }
      throw new Error(result?.message || 'This request could not be completed. Please check your permissions or try again later.');
    }
    return result;
  }
  function renderResult(result) {
    if (result.files) {
      add('Open-Box result', result.path + '\n' + result.files.map(file => (file.is_dir ? 'Folder: ' : 'File: ') + file.name).join('\n') + '\nShowing ' + result.files.length + ' of ' + result.total + ' entries.');
    } else if (result.file) add('Open-Box result', JSON.stringify(result.file, null, 2));
    else add('Open-Box result', result.message || JSON.stringify(result, null, 2));
  }
  launcher.addEventListener('click', async () => {
    syncSession();
    panel.hidden = !panel.hidden; launcher.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) {
      prompt.focus();
      if (!messages.childElementCount) {
        try { const session = await api('session'); add('Agent Assistant', 'Hello ' + session.user.username + '. I can inspect folders and file details, create folders, rename files and copy files. File changes appear for review before execution.' + (session.ai_available ? '' : ' AI is currently unavailable.')); }
        catch (error) { add('Agent Assistant', error.message); }
      }
    }
  });
  root.querySelector('header button').addEventListener('click', () => { panel.hidden = true; launcher.setAttribute('aria-expanded', 'false'); launcher.focus(); });
  root.addEventListener('keydown', event => { if (event.key === 'Escape') { panel.hidden = true; launcher.setAttribute('aria-expanded', 'false'); launcher.focus(); } });
  root.querySelector('.cancel').addEventListener('click', () => { clearPlan(); add('Agent Assistant', 'Cancelled. No file change was submitted.'); });
  root.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy || !prompt.value.trim()) return;
    clearPlan(); setBusy(true);
    const text = prompt.value.trim(); const sessionToken = token(); prompt.value = ''; add('You', text, true);
    try {
      const path = location.pathname.startsWith('/@') || location.pathname.startsWith('/settings/integrations') ? '/' : decodeURIComponent(location.pathname);
      const result = await api('chat', { prompt: text, path }, sessionToken);
      add('Agent Assistant · proposal', result.message);
      if (result.action) {
        if (result.requires_confirmation) { pending = result.action; pendingToken = sessionToken; review.querySelector('pre').textContent = JSON.stringify(pending, null, 2); review.hidden = false; }
        else renderResult(await api('execute', { action: result.action }, sessionToken));
      }
    } catch (error) { add('Agent Assistant', error.message); }
    finally { setBusy(false); prompt.focus(); }
  });
  confirm.addEventListener('click', async () => {
    if (busy || !pending) return;
    const action = pending; const sessionToken = pendingToken; clearPlan(); setBusy(true);
    try { renderResult(await api('execute', { action, confirmed: true }, sessionToken)); }
    catch (error) { add('Agent Assistant', error.message + ' The operation was not retried. Check the folder or Tasks before submitting it again.'); }
    finally { setBusy(false); }
  });
  window.addEventListener('storage', event => { if (event.key === 'token' || event.key === null) syncSession(); });
  window.addEventListener('focus', syncSession);
})();`;
