// ============================================================
// MOSS — the starting point.
// 1. Checks you're logged in (with Google, and the right account)
// 2. Builds the sidebar
// 3. Shows the section that matches the URL (#/todos, #/notes…)
// ============================================================

import { sb, isOffline, onOfflineChange, clearCache, getSettings, saveSettings, forgetSettings } from './db.js';
import { OWNER_EMAIL, GOOGLE_CALENDAR_SYNC } from './config.js';
import { t, setLang, lang, applyStatic } from './lang.js';
import { esc, toast, toastError } from './ui.js';
import { storeGoogleToken } from './sync.js';

import dashboard from './sections/dashboard.js';
import sites from './sections/sites.js';
import appointments from './sections/appointments.js';
import todos from './sections/todos.js';
import notes from './sections/notes.js';
import roadmap from './sections/roadmap.js';
import accounting from './sections/accounting.js';
import profile from './sections/profile.js';

// Sidebar order
const SECTIONS = [dashboard, sites, appointments, todos, notes, roadmap, accounting, profile];

// Simple line icons (inline SVG paths)
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  sites: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>',
  appointments: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  todos: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="m8 12 3 3 5-6"/>',
  notes: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>',
  roadmap: '<path d="M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v6h-4z"/>',
  accounting: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
};
export const icon = name => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

const $ = id => document.getElementById(id);
let user = null;

// ---------- screens ----------
function show(which) {
  $('boot').hidden = true;
  $('login').hidden = which !== 'login';
  $('app').hidden = which !== 'app';
}

function buildNav() {
  $('nav').innerHTML = SECTIONS.map(s =>
    `<a href="#/${s.id}" data-id="${s.id}">${icon(s.id)}<span>${esc(t('nav.' + s.id))}</span></a>`).join('');
}

// ---------- router ----------
async function route() {
  if (!user) return;
  const id = location.hash.replace(/^#\//, '').split('/')[0] || 'dashboard';
  const section = SECTIONS.find(s => s.id === id) || dashboard;
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.id === section.id));
  $('page-title').textContent = t('nav.' + section.id);
  document.title = `${t('nav.' + section.id)} · MOSS`;
  $('sidebar').classList.remove('open');
  const view = $('view');
  view.innerHTML = '<div class="loading"></div>';
  try {
    await section.render(view, { user, rerender: route });
  } catch (err) {
    view.innerHTML = `<div class="empty error">${esc(err.message || t('error.generic'))}</div>`;
    toastError(err);
  }
}

// ---------- login ----------
export async function loginWithGoogle() {
  const options = { redirectTo: location.origin + location.pathname };
  if (GOOGLE_CALENDAR_SYNC) {
    options.scopes = 'https://www.googleapis.com/auth/calendar.events';
    // Ask Google for a refresh token so sync keeps working after 1 hour
    options.queryParams = { access_type: 'offline', prompt: 'consent' };
  }
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options });
  if (error) showLoginError(error.message);
}

function showLoginError(msg) {
  $('login-error').textContent = msg;
  $('login-error').hidden = false;
}

async function onSignedIn(session) {
  const email = (session.user.email || '').toLowerCase();
  if (email !== OWNER_EMAIL.toLowerCase()) {
    await sb.auth.signOut();
    show('login');
    showLoginError(t('login.notOwner'));
    return;
  }
  const firstTime = !user;
  user = session.user;

  // provider_token only exists right after a real Google login
  if (session.provider_token) {
    try {
      const s = await getSettings(true);
      const logins = [{ at: new Date().toISOString(), device: deviceName() }, ...(s.recent_logins || [])].slice(0, 10);
      await saveSettings({ recent_logins: logins });
      if (s.language && s.language !== lang()) setLang(s.language);
    } catch (err) { console.warn('Could not log login', err); }
    // Clean the ?code=… or #access_token=… out of the address bar
    const keepHash = location.hash.startsWith('#/') ? location.hash : '';
    history.replaceState(null, '', location.pathname + keepHash);
  }

  // Hand the Google calendar key to the server (once per key)
  if (GOOGLE_CALENDAR_SYNC) connectCalendar(session);
  if (firstTime) {
    buildNav();
    show('app');
    route();
  }
}

// Result is kept so Profile can show it (a toast is easy to miss during login)
export function calendarStatus() {
  try { return JSON.parse(localStorage.getItem('moss_cal_status')) || null; } catch { return null; }
}
function setCalendarStatus(ok, detail = '') {
  try { localStorage.setItem('moss_cal_status', JSON.stringify({ ok, detail, at: new Date().toISOString() })); } catch { /* ignore */ }
}
async function connectCalendar(session) {
  const key = session.provider_refresh_token;
  if (!key) {
    if (session.provider_token) setCalendarStatus(false, 'Google sent no calendar key');
    return;
  }
  let sent = '';
  try { sent = sessionStorage.getItem('moss_cal_sent') || ''; } catch { /* ignore */ }
  if (sent === key) return;
  try {
    await storeGoogleToken(key);
    try { sessionStorage.setItem('moss_cal_sent', key); } catch { /* ignore */ }
    setCalendarStatus(true);
    toast(t('appt.calendarConnected'));
  } catch (err) {
    setCalendarStatus(false, err.message);
    toast(`${t('appt.calendarNotConnected')} (${err.message})`, 'err');
  }
}

function deviceName() {
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac/.test(ua) ? 'Mac' : 'Linux';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox/.test(ua) ? 'Firefox' : /Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Browser';
  return `${br} · ${os}`;
}

export async function logout() {
  await sb.auth.signOut();
  clearCache();
  forgetSettings();
  user = null;
  location.hash = '';
  show('login');
}

// ---------- start ----------
function wireStatic() {
  applyStatic();
  $('login-google').onclick = loginWithGoogle;
  document.querySelectorAll('.lang-switch').forEach(b => {
    b.onclick = async () => {
      setLang(lang() === 'en' ? 'fr' : 'en');
      if (user) {
        buildNav();
        route();
        saveSettings({ language: lang() }).catch(() => { /* offline: it's saved on this device anyway */ });
      }
    };
  });
  $('menu-btn').onclick = () => $('sidebar').classList.toggle('open');
  document.addEventListener('click', e => {
    const sb = $('sidebar');
    if (sb.classList.contains('open') && !sb.contains(e.target) && e.target !== $('menu-btn')) sb.classList.remove('open');
  });
  const setBadge = off => { $('offline-badge').hidden = !off; };
  onOfflineChange(setBadge);
  setBadge(isOffline());
  window.addEventListener('hashchange', route);
}

async function start() {
  wireStatic();
  setLang(lang());

  sb.auth.onAuthStateChange((event, session) => {
    // Run outside the callback (Supabase recommends not awaiting inside it)
    setTimeout(() => {
      if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) onSignedIn(session);
      if (event === 'SIGNED_OUT') { user = null; show('login'); }
    }, 0);
  });

  const { data } = await sb.auth.getSession();
  if (!data.session) show('login');
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW', err));
}

start();
