// ============================================================
// MOSS settings — the only file you need to edit to connect.
// Find these in Supabase → Project Settings → API.
// The "anon" key is meant to be public: your data is protected
// by the Row Level Security rules in supabase/schema.sql.
// ============================================================

export const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';

// The only Google account allowed in (same as in schema.sql).
export const OWNER_EMAIL = 'YOUR_EMAIL@gmail.com';

// Ask Google for Calendar access at login (needed for phase 7 sync).
// Set to false if you haven't set up Calendar sync yet.
export const GOOGLE_CALENDAR_SYNC = true;
