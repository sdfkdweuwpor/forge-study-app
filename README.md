# Forge — Premium focus, study & long-term goal app

Forge helps you stay focused, plan your day, and break big goals (like a WGU bachelor's degree spanning 1+ years) into small daily tasks. It protects your focus with a Chrome extension that blocks distracting sites during study sessions, rewards progress with XP, streaks, and badges, and grows a visual world as you complete work. Single user, no login, works offline.

**Live app:** https://forge-study-app.netlify.app

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

## Deploy (Netlify)

The site is deployed to Netlify as `forge-study-app`.

- **Build:** `npm run build` → `dist/`
- **SPA:** `netlify.toml` rewrites all routes to `/index.html`
- **Headers:** Security headers (CSP, etc.) are written by `security-headers.mjs` → `dist/_headers`
- **GitHub Actions (optional):** `.github/workflows/deploy.yml` pushes to `main` branch if secrets are set:
  - `NETLIFY_AUTH_TOKEN`
  - `NETLIFY_SITE_ID` (the app ID, not the site name)
  
  If these secrets are absent, the workflow skips. Alternatively, connect the repo in Netlify's UI and delete `.github/workflows/deploy.yml` to avoid double deploys.

## Install the app on your phone (PWA)

Coming in Phase 10. The app will be installable as a progressive web app for offline use on iOS and Android.

## Chrome extension (site blocker)

**Install the extension:**

1. Download `forge-extension.zip` from the [Releases](https://github.com/jobany860/forge-study-app/releases) page.
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
