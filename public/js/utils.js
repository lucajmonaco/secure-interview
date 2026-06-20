// utils.js - Secure Interview
const $ = id => document.getElementById(id);

async function get(url) {
  const r = await fetch(url, { method: 'GET' });
  return r.json();
}
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
async function patch(url, body) {
  const r = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}

function showModal(id) {
  const el = document.getElementById(id);
  if (el) { el.style.display = 'flex'; el.style.position = 'fixed'; el.style.inset = '0'; el.style.background = 'rgba(0,0,0,0.8)'; el.style.alignItems = 'center'; el.style.justifyContent = 'center'; el.style.zIndex = '1000'; }
}
function hideModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

function toast(msg, type) {
  let c = document.getElementById('toast-container');
  if (!c) { c = document.createElement('div'); c.id = 'toast-container'; c.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px'; document.body.appendChild(c); }
  const t = document.createElement('div');
  const colors = { green: '#3fb950', red: '#f85149', amber: '#e3b341' };
  t.style.cssText = 'background:#161b22;border:1px solid ' + (colors[type] || '#30363d') + ';border-radius:6px;padding:10px 16px;font-size:13px;color:' + (colors[type] || '#e6edf3') + ';min-width:200px';
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function fmtDate(ts) {
  if (!ts) return '-';
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

async function requireLogin(back) {
  const me = await get('/api/auth/me');
  if (!me || !me.loggedIn) { window.location.href = back || '/'; return null; }
  return me;
}

function trustClass(score) {
  return score >= 80 ? 'trust-hi' : score >= 60 ? 'trust-mid' : 'trust-lo';
}
