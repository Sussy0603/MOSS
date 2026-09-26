// ============================================================
// google-calendar-sync — Supabase Edge Function (phase 7)
//
// Two-way sync between MOSS appointments and your main
// Google Calendar. The browser calls this with one of:
//   { action: 'store_token', refresh_token }  right after login
//   { action: 'sync' }                        "Sync with Google"
//   { action: 'delete_event', event_id }      before a delete
//
// Secrets it needs (Supabase → Edge Functions → Secrets):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OWNER_EMAIL
//   TIMEZONE (optional, default America/Toronto)
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY
// are provided automatically.
//
// Honest limits:
//  - Only weekly and monthly repeats map across. A Google event
//    that repeats daily/yearly/every 2 weeks comes in as a
//    single appointment (its first date).
//  - Changes to ONE date of a repeating Google event are skipped.
//  - If you edit the same appointment in both places between
//    syncs, the last one pushed from MOSS wins.
// ============================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const TZ = Deno.env.get('TIMEZONE') ?? 'America/Toronto';
const CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const MARGIN_MS = 10_000; // ignore tiny clock differences between the DB and Google

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    // 1. Who is calling? Must be the owner.
    const authed = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: { user } } = await authed.auth.getUser();
    const owner = (Deno.env.get('OWNER_EMAIL') ?? '').toLowerCase();
    if (!user || (user.email ?? '').toLowerCase() !== owner) return json({ error: 'not_allowed' }, 403);

    // 2. Service-role client: can read the private google_tokens table
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = await req.json().catch(() => ({}));

    if (body.action === 'store_token') {
      if (!body.refresh_token) return json({ error: 'missing_token' }, 400);
      const { error } = await admin.from('google_tokens')
        .upsert({ user_id: user.id, refresh_token: body.refresh_token, updated_at: new Date().toISOString() });
      if (error) throw error;
      return json({ ok: true });
    }

    const token = await accessToken(admin, user.id);
    if (!token) return json({ error: 'no_token' }, 400);
    const google = (path: string, init: RequestInit = {}) =>
      fetch(path, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });

    if (body.action === 'delete_event') {
      const res = await google(`${CAL}/${encodeURIComponent(body.event_id)}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404 && res.status !== 410) throw new Error(`Google delete failed (${res.status})`);
      return json({ ok: true });
    }

    if (body.action === 'sync') return json(await sync(admin, user.id, google));

    return json({ error: 'unknown_action' }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// ---------- Google access token from the stored refresh token ----------
async function accessToken(admin: any, userId: string): Promise<string | null> {
  const { data } = await admin.from('google_tokens').select('refresh_token').eq('user_id', userId).maybeSingle();
  if (!data?.refresh_token) return null;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: data.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    // Revoked or expired → forget it, so the app asks you to log in again
    if (res.status === 400 || res.status === 401) await admin.from('google_tokens').delete().eq('user_id', userId);
    return null;
  }
  return (await res.json()).access_token;
}

// ---------- the sync ----------
type Appt = {
  id: string; title: string; starts_at: string; ends_at: string | null; location: string | null;
  notes: string | null; repeat: 'none' | 'weekly' | 'monthly'; google_event_id: string | null;
  synced_at: string | null; updated_at: string;
};

async function sync(admin: any, userId: string, google: (p: string, i?: RequestInit) => Promise<Response>) {
  let pushed = 0, pulled = 0, removed = 0;
  const { data: appts, error } = await admin.from('appointments').select('*').eq('user_id', userId);
  if (error) throw error;
  const now = () => new Date().toISOString();

  // PUSH: new or changed in MOSS → Google
  for (const a of appts as Appt[]) {
    const changed = !a.synced_at || Date.parse(a.updated_at) - Date.parse(a.synced_at) > MARGIN_MS;
    if (a.google_event_id && !changed) continue;
    const event = toGoogle(a);
    let res: Response;
    if (a.google_event_id) {
      res = await google(`${CAL}/${encodeURIComponent(a.google_event_id)}`, { method: 'PATCH', body: JSON.stringify(event) });
      if (res.status === 404 || res.status === 410) {
        res = await google(CAL, { method: 'POST', body: JSON.stringify(event) }); // deleted in Google → recreate
      }
    } else {
      res = await google(CAL, { method: 'POST', body: JSON.stringify(event) });
    }
    if (!res.ok) { console.warn('push failed', a.id, res.status, await res.text()); continue; }
    const g = await res.json();
    await admin.from('appointments').update({ google_event_id: g.id, synced_at: now() }).eq('id', a.id);
    a.google_event_id = g.id;
    a.synced_at = now();
    pushed++;
  }

  // PULL: Google → MOSS (60 days back, 1 year ahead)
  const byGoogleId = new Map((appts as Appt[]).filter(a => a.google_event_id).map(a => [a.google_event_id!, a]));
  const min = new Date(Date.now() - 60 * 86400_000).toISOString();
  const max = new Date(Date.now() + 365 * 86400_000).toISOString();
  let pageToken = '';
  do {
    const qs = new URLSearchParams({ timeMin: min, timeMax: max, showDeleted: 'true', singleEvents: 'false', maxResults: '250' });
    if (pageToken) qs.set('pageToken', pageToken);
    const res = await google(`${CAL}?${qs}`);
    if (!res.ok) throw new Error(`Google list failed (${res.status})`);
    const page = await res.json();

    for (const ev of page.items ?? []) {
      if (ev.recurringEventId) continue; // a change to one date of a repeating event: skipped
      const local = byGoogleId.get(ev.id);
      if (ev.status === 'cancelled') {
        if (local) { await admin.from('appointments').delete().eq('id', local.id); removed++; }
        continue;
      }
      const row = fromGoogle(ev);
      if (!row) continue;
      if (!local) {
        const { error: e } = await admin.from('appointments').insert({ ...row, user_id: userId, google_event_id: ev.id, synced_at: now() });
        if (!e) pulled++;
      } else if (!local.synced_at || Date.parse(ev.updated) - Date.parse(local.synced_at) > MARGIN_MS) {
        await admin.from('appointments').update({ ...row, synced_at: now() }).eq('id', local.id);
        pulled++;
      }
    }
    pageToken = page.nextPageToken ?? '';
  } while (pageToken);

  return { pushed, pulled, removed };
}

function toGoogle(a: Appt) {
  const start = new Date(a.starts_at);
  const end = a.ends_at ? new Date(a.ends_at) : new Date(start.getTime() + 3600_000);
  const event: Record<string, unknown> = {
    summary: a.title,
    location: a.location ?? '',
    description: a.notes ?? '',
    start: { dateTime: start.toISOString(), timeZone: TZ },
    end: { dateTime: end.toISOString(), timeZone: TZ },
    recurrence: a.repeat === 'weekly' ? ['RRULE:FREQ=WEEKLY'] : a.repeat === 'monthly' ? ['RRULE:FREQ=MONTHLY'] : [],
  };
  return event;
}

function fromGoogle(ev: any) {
  const start = ev.start?.dateTime ?? (ev.start?.date ? zonedMidnight(ev.start.date) : null);
  if (!start) return null;
  const end = ev.end?.dateTime ?? (ev.end?.date ? zonedMidnight(ev.end.date) : null);
  const rule: string = (ev.recurrence ?? []).find((r: string) => r.startsWith('RRULE:')) ?? '';
  const simple = !/INTERVAL=(?!1\b)|BYSETPOS/.test(rule);
  const repeat = simple && /FREQ=WEEKLY/.test(rule) ? 'weekly' : simple && /FREQ=MONTHLY/.test(rule) ? 'monthly' : 'none';
  return {
    title: ev.summary || '(no title)',
    starts_at: new Date(start).toISOString(),
    ends_at: end ? new Date(end).toISOString() : null,
    location: ev.location ?? '',
    notes: ev.description ?? '',
    repeat,
  };
}

// All-day events: 'YYYY-MM-DD' → midnight in your time zone, as UTC
function zonedMidnight(date: string): string {
  const guess = new Date(`${date}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(guess);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value);
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return new Date(guess.getTime() - (asIfUtc - guess.getTime())).toISOString();
}
