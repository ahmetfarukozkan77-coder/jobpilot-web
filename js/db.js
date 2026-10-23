// Supabase client and small DOM helpers shared by every page.
// js/vendor/supabase.js (pinned @supabase/supabase-js UMD build) must be
// loaded first; it defines the global `supabase`.
import { SUPABASE_URL, SUPABASE_ANON } from './config.js';

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
});

// The app page's address: OAuth returns here, Stripe returns here.
export function appUrl(hash = '') {
  return new URL(`app.html${hash}`, location.href).href;
}

export async function currentUser() {
  const { data } = await sb.auth.getSession();
  return data.session?.user || null;
}

export function signIn() {
  return sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: appUrl() } });
}

// Calls a backend Edge Function with the signed-in user's token.
export async function callFunction(name, body) {
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Please sign in again.');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || json.error || `Request failed (${res.status})`);
  return json;
}

// Throws the PostgREST error so callers can show it.
export function must({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

// ── DOM helpers ──────────────────────────────────────────────────────────────

export const $ = (sel, root = document) => root.querySelector(sel);

// h('div.card', { onclick }, 'text', child, …) — text children never become HTML.
export function h(tag, attrs = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value' || (k in el && typeof v !== 'string')) el[k] = v; // a select's value: set after its options
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

let toastTimer = null;
export function toast(text, kind = 'ok') {
  let t = $('#toast');
  if (!t) { t = h('div', { id: 'toast', role: 'status' }); document.body.append(t); }
  t.textContent = text;
  t.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 3500);
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Runs an async action with the button disabled; reports errors as a toast.
export async function busy(button, fn) {
  const label = button?.textContent;
  if (button) { button.disabled = true; button.textContent = 'Working…'; }
  try { return await fn(); }
  catch (e) { toast(e.message || String(e), 'error'); }
  finally { if (button) { button.disabled = false; button.textContent = label; } }
}
