# Forge — Premium focus, study & long-term goal app

Forge helps you stay focused, plan your day, and break big goals (like a WGU bachelor's degree spanning 1+ years) into small daily tasks. It protects your focus with a Chrome extension that blocks distracting sites during study sessions, rewards progress with XP, streaks, and badges, and grows a visual world as you complete work. Single user, no login, works offline.

**Live app:** https://sdfkdweuwpor.github.io/forge-study-app/

## Status

Under active development; see [PLAN.md](PLAN.md) for the phase checklist.

## Development

Node 22 required.

```bash
npm install
npm run dev              # Start dev server on :5173
npm run build            # TypeScript + Vite (production)
npm run preview          # Serve dist/ on :4173 with prod headers
npm run typecheck        # TypeScript check
npm run lint             # ESLint
npm test                 # Vitest (TZ=America/New_York)
npm run e2e              # Playwright (build + preview required)
npm run shoot            # Screenshots to screenshots/ (light/dark × 1440/375)
npm run build:ext        # Build extension (Phase 9)
npm run zip:ext          # Package forge-extension.zip (Phase 9)
npm run format           # Prettier
```

### Sample data

- `?seed=wgu` — realistic WGU coursework (C182, C779, etc.) with scheduled chunks
- `?seed=empty` — blank slate for testing empty states
- Default (no seed) — production mode with no sample data

Seeding replaces the stored data, so it only exists in builds compiled with `VITE_ENABLE_SEED=1`: `npm run dev` and the Playwright web servers set it. A deployed build ignores `?seed=`.

## Hosting

The app is hosted on GitHub Pages at https://sdfkdweuwpor.github.io/forge-study-app/ and deploys on every push to `main` (`.github/workflows/pages.yml`; you can also run it by hand from the Actions tab).

One-time setup: in the repo, **Settings → Pages → Build and deployment → Source: GitHub Actions**. Nothing else is needed, and there are no secrets.

- **Base path:** the Pages build is `vite build --base /forge-study-app/`; the same code built with the default base serves from `/` (Netlify, `npm run preview`). The app keeps paths base-less inside and adds the base only at the URL boundary (`src/app/router/location.ts`).
- **Deep links:** Pages answers an unknown path with `404.html`, so `scripts/pages-postbuild.mjs` makes that file a copy of the app (`/forge-study-app/tasks` loads Tasks). On the very first visit the browser logs a 404 for the page; once the service worker is installed it does not.
- **Headers:** Pages cannot send response headers, so the script puts the Content-Security-Policy from `security-headers.mjs` into a `<meta>` tag. A meta policy cannot carry `frame-ancestors`, and the other headers (`nosniff`, `Referrer-Policy`, …) are not sent on Pages.
- **Netlify fallback:** `netlify.toml` and the optional `.github/workflows/deploy.yml` (repo secrets `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID`) still deploy the same code to https://forge-study-app.netlify.app from the root.

## Install the app on your phone (PWA)

Forge is a progressive web app: it installs like an app (own icon, own window, no browser bars) and, after the first visit, opens and works with no connection at all. Open the live site once while you are online, let it finish loading, then install it:

- **iPhone or iPad (Safari):** tap **Share** → **Add to Home Screen** → **Add**. It has to be done from Safari.
- **Android (Chrome):** tap **⋮** → **Install app** (older versions call it **Add to Home screen**).
- **Desktop (Chrome or Edge):** click the install icon at the right end of the address bar, or **⋮** → **Install Forge**.

Press and hold (Android) or right-click (desktop) the installed icon for the shortcuts: **Today**, **Start focus** and **Quick add**.

**Offline.** A small "Offline" pill appears in the sidebar (at the top of the screen on a phone) and nothing else changes: your tasks, timer, goals and history are stored on the device, so everything keeps working. Two things need to have been used once while online: the site icons on the Blocker page and the PDF reader in the plan import.

**Updates.** When a new version is ready, an "Update ready" toast with a **Reload** button appears. Forge never reloads by itself, and it holds the toast back while a focus session is running.

**Your data lives on each device separately** unless you set up [Sync (optional)](#sync-optional): without it the phone and the laptop do not see each other's tasks. To move data across without sync, export it on one device and import it on the other (see [Backup & restore](#backup--restore)). On iPhone, install the app rather than keeping a Safari tab: Safari can clear a website's stored data after about a week without a visit, and an installed app is exempt.

## Sync (optional)

Forge works fully on its own, with no account and nothing to set up. Sync is for people who use it on more than one device: it keeps your tasks, goals, sessions, rewards and settings the same on your laptop and your phone. Nothing about it runs, loads or contacts a server until you turn it on.

**How it works.** You bring your own free [Supabase](https://supabase.com) project. Forge talks to it straight from your browser: there is no Forge server, nobody else holds your data, and the project's row-level security lets only your signed-in account read it. Your project's address and its public (anon) key are kept on the device, in Forge's own database, and never sync or leave it. Sign-in is by email, with a link or a code: there is no password.

Only projects at `https://<project>.supabase.co` work. Forge's security policy is fixed when the app is built, so a custom domain or a self-hosted Supabase cannot be reached, and Settings says so before anything is saved.

### Set up sync

Steps 1 to 5 and 8 are done once per project, in the Supabase dashboard. Steps 6 and 7 are what each device does.

1. **Create a project.** In the [Supabase dashboard](https://supabase.com/dashboard), choose **New project** (the free plan is enough), pick a region close to you, and wait until it says it is ready.
2. **Copy two values.** Open **Project Settings → API** (called **API Keys** in newer dashboards). Copy the **Project URL** (`https://` followed by 20 letters and numbers, then `.supabase.co`) and the **anon** key (a newer project may call it the **publishable** key). Never use the `service_role` or secret key: it bypasses every access rule, and Forge refuses it.
3. **Create the table.** Open the **SQL editor**, choose **New query**, paste this, and press **Run**. In Forge, **Settings → Sync → Copy setup SQL** puts exactly this text on your clipboard (a test checks that they match). It is safe to run again.

```sql
-- Forge cloud sync: run once in your Supabase project's SQL editor. Safe to run again.
-- One table holds every synced Forge row as JSON. Row-level security keeps each account's rows private.

create table if not exists public.forge_rows (
  user_id        uuid        not null references auth.users (id) on delete cascade,
  tbl            text        not null check (char_length(tbl) between 1 and 64),
  id             text        not null check (char_length(id) between 1 and 200),
  updated_at     bigint      not null,  -- last-write-wins stamp: ms since 1970, from the device that wrote it
  device_id      text        not null check (char_length(device_id) between 1 and 64),
  deleted        boolean     not null default false,  -- a tombstone: the row was deleted
  schema_version integer     not null check (schema_version > 0),
  data           jsonb,                  -- the Forge row; null once deleted
  seq            bigint      not null default 0,  -- change cursor, set by the trigger below
  modified_at    timestamptz not null default now(),  -- server time of the last accepted write
  primary key (user_id, tbl, id),
  constraint forge_rows_data_check check (deleted or data is not null)
);

create sequence if not exists public.forge_rows_seq;

create index if not exists forge_rows_user_seq on public.forge_rows (user_id, seq);

-- Every write goes through here: an older write never replaces a newer one, a clock that runs far
-- ahead cannot win for long, and `seq` follows commit order so a pull never misses a row.
create or replace function public.forge_rows_accept()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- A stamp more than five minutes ahead of the server is capped there.
  new.updated_at := least(
    new.updated_at,
    (extract(epoch from clock_timestamp()) * 1000)::bigint + 300000
  );
  if tg_op = 'UPDATE' then
    -- Last write wins. Equal stamps go to the larger device id, so every device agrees.
    if (new.updated_at, new.device_id) < (old.updated_at, old.device_id) then
      return null;  -- keep the stored row
    end if;
  end if;
  -- One writer per account at a time: `seq` is handed out in commit order.
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
  new.seq := nextval('public.forge_rows_seq');
  new.modified_at := now();
  if new.deleted then
    new.data := null;
  end if;
  return new;
end;
$$;

drop trigger if exists forge_rows_accept on public.forge_rows;
create trigger forge_rows_accept
  before insert or update on public.forge_rows
  for each row execute function public.forge_rows_accept();

-- The server's clock, so Forge can tell you when a device's clock is off.
create or replace function public.forge_now()
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select (extract(epoch from now()) * 1000)::bigint;
$$;

alter table public.forge_rows enable row level security;

drop policy if exists forge_rows_select on public.forge_rows;
create policy forge_rows_select on public.forge_rows
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists forge_rows_insert on public.forge_rows;
create policy forge_rows_insert on public.forge_rows
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists forge_rows_update on public.forge_rows;
create policy forge_rows_update on public.forge_rows
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists forge_rows_delete on public.forge_rows;
create policy forge_rows_delete on public.forge_rows
  for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.forge_rows from anon;
revoke all on sequence public.forge_rows_seq from anon;
revoke all on function public.forge_now() from anon, public;
grant select, insert, update, delete on table public.forge_rows to authenticated;
grant usage on sequence public.forge_rows_seq to authenticated;
grant execute on function public.forge_now() to authenticated;
```

4. **Tell Supabase where Forge lives.** Open **Authentication → URL Configuration**. Set **Site URL** to `https://sdfkdweuwpor.github.io/forge-study-app/` (or the address you open Forge at), and under **Redirect URLs** add each address you use:
   - `https://sdfkdweuwpor.github.io/forge-study-app/settings/sync` (the live app at the top of this page)
   - `https://forge-study-app.netlify.app/settings/sync` (the Netlify fallback, if you use it)
   - `http://localhost:5173/settings/sync` (`npm run dev`)
   - `http://localhost:4173/settings/sync` (`npm run preview`)

   The link in the sign-in email returns to the address Forge was opened at, and Supabase only allows the addresses on this list. A deploy preview is not listed; sign in there with the code instead.
5. **Put the code in the two emails.** Open **Authentication → Email Templates** (under **Emails** in newer dashboards). A sign-in email carries a link, and on an iPhone or iPad a link from Mail opens in Safari, which is not where the installed app keeps its data, so the link cannot sign the app in. A code can. The first time you sign in Supabase sends the **Confirm signup** email; every time after, **Magic Link**. Replace the body of both with the following (`{{ .Token }}` is the code; Forge accepts 6 to 10 digits, so whatever length your project uses works). A subject like `Your Forge sign-in link and code` helps you find it.

   **Magic Link**

   ```html
   <h2>Sign in to Forge</h2>

   <p>Follow this link to sign in on the device where you asked for it:</p>
   <p><a href="{{ .ConfirmationURL }}">Sign in to Forge</a></p>

   <p>Or type this code in Forge: <strong>{{ .Token }}</strong></p>
   ```

   **Confirm signup**

   ```html
   <h2>Welcome to Forge</h2>

   <p>Follow this link to confirm your email and sign in on the device where you asked for it:</p>
   <p><a href="{{ .ConfirmationURL }}">Confirm and sign in to Forge</a></p>

   <p>Or type this code in Forge: <strong>{{ .Token }}</strong></p>
   ```
6. **Connect Forge.** In Forge open **Settings → Sync → Set up sync**, paste the Project URL and the anon key, and press **Check connection**. Then type your email and press **Send sign-in link**. Open the link on the same device, or type the code from the email. The first sync starts by itself.
7. **Sign in on your other devices** the same way, with the same project and the same email. A device that already has data is not overwritten: the first sync merges, keeps the newer version of anything both have, and saves a **Before sync** snapshot first (**Settings → Snapshots**). On a new phone, the welcome tour has a link that goes straight to Sync.
8. **Close the project to strangers.** Once you are signed in, open **Authentication** and find the **Allow new users to sign up** switch (under **Sign In / Providers**, or **Providers → Email** in older dashboards) and turn it off. The anon key only ever sits on your own devices and row-level security isolates accounts anyway, but this stops anyone who guesses the project's address from creating an account. Your own account keeps signing in. Turn the switch back on only if you want to add another account.

If the email does not arrive, wait a few minutes before sending it again: Supabase's built-in email sender allows only a few emails an hour. Free projects pause after a week without use; if Forge says yours may be paused, restore it from the Supabase dashboard and sync picks up where it left off.

### What sync can't do

- **One record, one winner.** When the same item changes on two devices before they sync, the change made later (by the devices' clocks) wins **for the whole item**. Edit a task's title on the laptop and its date on the phone, both offline, and one of the two edits is lost. Notes, checklists and tags are part of their task, goal or course. Settings are one item.
- **Delete versus edit.** An item deleted on one device and edited later on another comes back. Edited first and deleted later, it stays deleted (it is still in that device's Trash for 30 days).
- **XP is a log, not a counter.** XP events are added, never overwritten, so XP from both devices adds up. The same award paid on two devices offline (a daily goal, a course, a streak milestone, a finished task) counts once. A task finished on one device while its completion is undone on the other can leave its XP and its checkbox disagreeing until you tick it again.
- **Spending is not checked across devices.** Buying rewards on two devices offline can take the balance below zero.
- **Rebuilt on each device, never synced:** streak days, My World's city (it grows from the synced history, so it is the same), levels and balances (from the XP log), readiness. Plan tasks two devices both re-planned offline can show twice for a moment; the next sync removes the duplicate.
- **Clocks matter.** Keep "set time automatically" on; Forge warns when a device is more than 2 minutes off.
- **PDFs stay on the device they were added on.** Their resource rows sync and say where the file is.
- **A running timer shows on the other device when it ends.**
- **Import, snapshot restore** replace the data on every synced device; **Reset** erases only this device and turns sync off.

### Turning sync off, and erasing the cloud copy

**Settings → Sync → Sign out and stop syncing** stops syncing on that device. Everything stays on the device and the cloud copy stays in your project. Turning sync on again later is a new first sync.

Forge has no button that erases the cloud copy. Turn sync off on your devices first (a device that still syncs would send its next changes back), then use any of these in the Supabase dashboard:

- **Erase your rows, keep the table.** In the SQL editor, run the following with your user id from **Authentication → Users**. (`auth.uid()` is empty in the SQL editor, so the id has to be spelled out; run as a signed-in user, `delete from public.forge_rows where user_id = auth.uid();` does the same.)

  ```sql
  delete from public.forge_rows where user_id = '00000000-0000-0000-0000-000000000000';
  ```
- **Delete your account.** Delete the user under **Authentication → Users**: the table removes that user's rows with it.
- **Remove Forge from the project completely.** This drops the table and everything the setup SQL created:

  ```sql
  drop table if exists public.forge_rows;
  drop sequence if exists public.forge_rows_seq;
  drop function if exists public.forge_rows_accept();
  drop function if exists public.forge_now();
  ```

The data on each of your devices is not touched by any of this.

## Chrome extension (site blocker)

**Install the extension:**

1. Download `forge-extension.zip` from the [Releases](https://github.com/sdfkdweuwpor/forge-study-app/releases) page.
   - Note: The repository is private. You must be logged into GitHub to download. Alternatively, build it locally with `npm run zip:ext`.
2. Unzip the file to a folder on your computer.
3. Open Chrome and go to `chrome://extensions`.
4. Turn on **Developer mode** (toggle in the top right).
5. Click **Load unpacked** and select the unzipped folder.
6. The extension ID should be `gpinhblnpebjbiodblihfpjbffacipbd`.
7. Open Forge and go to the **Blocker** page to confirm it says "Connected".

**Emergency unlock:** If you need immediate access to a blocked site, wait 60 seconds, then type the exact phrase shown on the blocked page to unlock it for 5 minutes. Unlock attempts are logged on the Progress page.

**Note on mobile apps:** Browser extensions can only block web access, not native apps. To restrict app access:
- **iOS:** Use [Apple Screen Time](https://support.apple.com/en-us/108806)
- **Android:** Use [Google Digital Wellbeing](https://support.google.com/android/answer/9346420)

## Backup & restore

Coming in Phase 10. Export and import your data as JSON.

## WGU import prompt

Coming in Phase 5. Paste a Claude-generated plan (course list + milestones) to auto-populate your degree goal.

## Screenshots

Coming in Phase 13. Walkthrough and visual guide.
