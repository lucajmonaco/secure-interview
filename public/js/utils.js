// Secure Interview shared utilities

// ── TOAST ──
function toast(msg, type = '') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' toast-' + type : '');
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// ── API ──
async function api(method, url, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  return res.json();
}
const get = url => api('GET', url);
const post = (url, body) => api('POST', url, body);
const patch = (url, body) => api('PATCH', url, body);
const del = url => api('DELETE', url);

// ── FORMAT ──
function fmtTime(secs) {
  return String(Math.floor(secs / 60)).padStart(2, '0') + ':' + String(secs % 60).padStart(2, '0');
}
function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtDuration(startTs, endTs) {
  if (!startTs || !endTs) return '—';
  return fmtTime(endTs - startTs);
}

// ── AUTH GUARD ──
async function requireLogin(redirectTo = '/') {
  const me = await get('/api/auth/me');
  if (!me.loggedIn) { window.location.href = redirectTo; return null; }
  return me;
}

// ── TRUST COLOR ──
function trustClass(score) {
  return score >= 80 ? 'trust-hi' : score >= 60 ? 'trust-mid' : 'trust-lo';
}

// ── MODAL HELPERS ──
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
function closeAllModals() { document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.add('hidden')); }

// ── $ SHORTHAND ──
const $ = id => document.getElementById(id);
const $q = sel => document.querySelector(sel);
