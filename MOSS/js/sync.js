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

// Called right after a Google login
export async function storeGoogleToken(refreshToken) {
  try { await call({ action: 'store_token', refresh_token: refreshToken }); }
  catch (err) { console.info('Google token not stored (sync not set up yet?)', err.message); }
}

// Two-way sync. Returns { pushed, pulled, removed }
export function syncNow() { return call({ action: 'sync' }); }

// Called before deleting an appointment that came from / went to Google
export async function deleteGoogleEvent(eventId) {
  if (!eventId) return;
  try { await call({ action: 'delete_event', event_id: eventId }); }
  catch (err) { console.warn('Google delete failed', err.message); }
}
