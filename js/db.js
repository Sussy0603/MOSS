// ============================================================
// Talking to Supabase.
// Every section uses these 4 helpers: list, add, save, remove.
// Lists are also copied into localStorage so you can VIEW
// your data offline (saving still needs internet).
// ============================================================

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { t } from './lang.js';

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const CACHE = 'moss_cache_';
const listeners = new Set();
let offline = !navigator.onLine;

export function isOffline() { return offline; }
export function onOfflineChange(fn) { listeners.add(fn); }
function setOffline(v) {
  if (v === offline) return;
  offline = v;
  listeners.forEach(fn => fn(v));
}
window.addEventListener('online', () => setOffline(false));
window.addEventListener('offline', () => setOffline(true));

function readCache(table) {
  try { return JSON.parse(localStorage.getItem(CACHE + table)) ?? []; }
  catch { return []; }
}
function writeCache(table, rows) {
  try { localStorage.setItem(CACHE + table, JSON.stringify(rows)); }
  catch { /* storage full or blocked: offline copy is a bonus, not required */ }
}
export function clearCache() {
  try {
    Object.keys(localStorage).filter(k => k.startsWith(CACHE)).forEach(k => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

// A network failure (not a "you're not allowed" error)
function isNetworkError(err) {
  return !navigator.onLine || /fetch|network|Failed to fetch|Load failed/i.test(err?.message ?? '');
}

function guardOnline() {
  if (offline || !navigator.onLine) throw new Error(t('offline.noSave'));
}

// Get all rows of a table, sorted. Falls back to the offline copy.
export async function list(table, orderBy = 'created_at', ascending = false) {
  try {
    const { data, error } = await sb.from(table).select('*').order(orderBy, { ascending });
    if (error) throw error;
    writeCache(table, data);
    setOffline(false);
    return data;
  } catch (err) {
    if (isNetworkError(err)) { setOffline(true); return readCache(table); }
    throw err;
  }
}

// Insert a row, get it back (with its id)
export async function add(table, row) {
  guardOnline();
  const { data, error } = await sb.from(table).insert(row).select().single();
  if (error) throw error;
  return data;
}

// Update a row by id, get it back
export async function save(table, id, changes) {
  guardOnline();
  const { data, error } = await sb.from(table).update(changes).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

// Delete a row by id
export async function remove(table, id) {
  guardOnline();
  const { error } = await sb.from(table).delete().eq('id', id);
  if (error) throw error;
}

// ---------- settings (one row per user, made on first use) ----------
let settingsCache = null;
export async function getSettings(force = false) {
  if (settingsCache && !force) return settingsCache;
  const rows = await list('settings');
  if (rows.length) return (settingsCache = rows[0]);
  if (offline) return (settingsCache = { business_name: 'MOS', taxes_on: false, gst_rate: 5, qst_rate: 9.975, recent_logins: [] });
  settingsCache = await add('settings', {});
  return settingsCache;
}
export async function saveSettings(changes) {
  const s = await getSettings();
  settingsCache = await save('settings', s.id, changes);
  return settingsCache;
}
export function forgetSettings() { settingsCache = null; }

// ---------- receipts (private storage bucket) ----------
export async function uploadReceipt(file, userId) {
  guardOnline();
  const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(-80);
  const path = `${userId}/${Date.now()}-${safeName}`;
  const { error } = await sb.storage.from('receipts').upload(path, file, { upsert: false });
  if (error) throw error;
  return path;
}
export async function receiptUrl(path) {
  const { data, error } = await sb.storage.from('receipts').createSignedUrl(path, 60 * 10);
  if (error) throw error;
  return data.signedUrl;
}
export async function deleteReceipt(path) {
  if (!path) return;
  await sb.storage.from('receipts').remove([path]);
}

// ---------- backup ----------
export const ALL_TABLES = ['settings', 'clients', 'sites', 'appointments', 'todos', 'notes', 'roadmap', 'invoices', 'transactions'];
export async function exportAll() {
  const out = { app: 'MOSS', exported_at: new Date().toISOString(), tables: {} };
  for (const tbl of ALL_TABLES) out.tables[tbl] = await list(tbl);
  return out;
}
