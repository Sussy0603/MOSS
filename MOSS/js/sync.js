// ============================================================
// Google Calendar sync (phase 7).
// The browser never talks to Google directly: it asks the
// "google-calendar-sync" Edge Function, which holds your
// Google refresh token safely on the server.
// ============================================================

import { sb } from './db.js';
import { t } from './lang.js';

const FN = 'google-calendar-sync';

async function call(body) {
  const { data, error } = await sb.functions.invoke(FN, { body });
  if (error) {
    // Function not deployed yet → friendly message
    const status = error.context?.status;
    if (status === 404 || /not found|Failed to send/i.test(error.message)) throw new Error(t('appt.syncNotSetUp'));
    let detail = '';
    try { detail = (await error.context.json()).error; } catch { /* no body */ }
    if (detail === 'no_token') throw new Error(t('appt.syncNeedsLogin'));
    throw new Error(detail || error.message);
  }
  return data;
}

// Called right after a Google login. Throws if the key couldn't be saved.
export async function storeGoogleToken(refreshToken) {
  await call({ action: 'store_token', refresh_token: refreshToken });
}

// Two-way sync. Returns { pushed, pulled, removed }
// If the server has no calendar key yet, try the one saved in this browser once.
export async function syncNow() {
  try {
    return await call({ action: 'sync' });
  } catch (err) {
    if (err.message !== t('appt.syncNeedsLogin')) throw err;
    const { data } = await sb.auth.getSession();
    const key = data.session?.provider_refresh_token;
    if (!key) throw err;
    await storeGoogleToken(key);
    return call({ action: 'sync' });
  }
}

// Called before deleting an appointment that came from / went to Google
export async function deleteGoogleEvent(eventId) {
  if (!eventId) return;
  try { await call({ action: 'delete_event', event_id: eventId }); }
  catch (err) { console.warn('Google delete failed', err.message); }
}
