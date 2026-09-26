# MOSS

Suzy's one-person operations hub.
Simpler than MOS: one user, 8 sections, data in the cloud.

**Sections:** Dashboard · Apps & Websites · Appointments · To-do · Notes · Roadmap · Accounting · Profile

**Built with:** plain HTML, CSS and JavaScript (no framework), Supabase (free tier), GitHub Pages.

---

## Setup (about 30 minutes, one time)

### 1. Supabase project

1. Go to [supabase.com](https://supabase.com) and create a free account.
2. Click **New project**. Name it `moss`. Pick the **Canada (Central)** region.
3. Open **SQL Editor**, then **New query**.
4. Open `supabase/schema.sql` from this repo.
5. Replace `YOUR_EMAIL@gmail.com` with your Google email.
6. Paste the whole file and click **Run**.

### 2. Google login

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a project called `MOSS`.
2. **APIs & Services → Library**: turn on **Google Calendar API**.
3. **OAuth consent screen**: choose External and fill in the app name and your email.
   - Add the scope `.../auth/calendar.events`.
   - Set the publishing status to **In production**. If you leave it on "Testing", Google logs you out every 7 days.
4. **Credentials → Create credentials → OAuth client ID**, type **Web application**.
   - Authorized redirect URI: `https://YOUR-PROJECT.supabase.co/auth/v1/callback`
5. Copy the **Client ID** and **Client secret**.
6. In Supabase, go to **Authentication → Sign In / Providers → Google**: turn it on and paste both.
7. Then **Authentication → URL Configuration**:
   - Site URL: `https://sussy0603.github.io/MOSS/`
   - Redirect URLs: add `https://sussy0603.github.io/MOSS/` and `http://localhost:8000/`

### 3. Connect the app

1. In Supabase, go to **Project Settings → API** and copy the **Project URL** and the **anon public** key.
2. Paste them, plus your email, into `js/config.js`.

The anon key is meant to be public. Your data is protected by the Row Level Security rules in `schema.sql`.

### 4. First login, then lock the door

1. Open MOSS and click **Sign in with Google**.
2. Once you're in, go to Supabase **Authentication → Sign In / Providers** and turn **off** "Allow new users to sign up".

Even if you forget step 2, the database only answers to your email.

### 5. Publish on GitHub Pages

1. Push this repo to GitHub.
2. Go to **Settings → Pages → Deploy from branch → main / (root)**.
3. After a minute, MOSS is live at `https://sussy0603.github.io/MOSS/`.

### 6. Google Calendar sync (phase 7, optional)

This needs the [Supabase CLI](https://supabase.com/docs/guides/cli), which is free.

```bash
supabase login
supabase link --project-ref YOUR-PROJECT-REF
supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... OWNER_EMAIL=you@gmail.com
supabase functions deploy google-calendar-sync
```

Then log out of MOSS and back in once, so Google gives MOSS a calendar key. After that, the **Sync with Google** button in Appointments works.

What it can't do:

- Only weekly and monthly repeats carry over between Google and MOSS.
- A change to just one date of a repeating Google event is skipped.

---

## Run it on your laptop

```bash
python -m http.server 8000
```

Then open `http://localhost:8000/`. Opening `index.html` by double-clicking won't work, because JS modules need a server.

## Updating the app

- Edit files, then bump `VERSION` in `sw.js` (`moss-v1` → `moss-v2`) so browsers download the new files.
- Every label lives in `js/lang.js`. Add each new key in **both** `en` and `fr`.

## Where things are

| File | What it does |
| --- | --- |
| `index.html` | The page shell |
| `css/styles.css` | All the styling. Colors are at the top in `:root` |
| `js/config.js` | Your Supabase keys and email |
| `js/app.js` | Login, sidebar, which section to show |
| `js/db.js` | `list`, `add`, `save`, `remove`, plus the offline copy |
| `js/ui.js` | Shared helpers: `esc()`, forms, dates, money |
| `js/lang.js` | English + French labels |
| `js/pdf.js` | Invoice PDF |
| `js/sync.js` | Talks to the Google sync function |
| `js/sections/*.js` | One file per section. **Start with `todos.js`**, it's the simplest |
| `supabase/schema.sql` | Tables and security rules |
| `supabase/functions/google-calendar-sync/` | Google Calendar sync (runs on Supabase) |
| `vendor/` | Libraries: Supabase, Quill, DOMPurify, jsPDF |

## Good to know

- **Free projects pause after 1 week with no activity.** Your data stays safe. Go to the Supabase dashboard and click **Resume**.
- **Offline, you can view but not edit.** MOSS shows your last-loaded data and a "view only" badge.
- **Back up once a month:** Profile → **Export everything**.
- **Taxes are OFF** until you register for GST/QST. Turn them on in Profile, and add your numbers.
