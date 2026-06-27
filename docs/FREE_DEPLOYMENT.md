# Free Deployment Guide

This guide helps you publish PingVista without paying for infrastructure.

## Recommended Free Setup

- Frontend: GitHub Pages, Vercel Hobby, Netlify Free, or Render Static Site
- Backend: optional Render/Railway free or trial service
- Auth/database: Supabase Free
- Email alerts: skip for now, or use a free email provider later

## Option A: Static Demo

Use this when you want a public link quickly.

1. Push the repository to GitHub.
2. Deploy the static files with GitHub Pages, Vercel, Netlify, or Render Static Site.
3. Keep PingVista in browser mode.
4. Add the live demo link to `README.md`.

What works:

- Demo mode
- Manual browser checks
- Browser auto monitoring while the tab is open
- CSV export
- JSON backup/import
- localStorage persistence

What is limited:

- Some APIs fail because of CORS.
- Checks stop when the browser is closed.
- No real webhook alerts.
- No server-side scheduler.

## Option B: Free Backend Demo

Use this when you want backend checks and `/api/health`.

1. Deploy the Python app to Render or Railway.
2. Set `PORT` if the platform requires it.
3. Keep Supabase variables empty for local JSON mode, or configure Supabase Free.
4. Open the deployed backend URL.

Important note: free backend platforms may sleep. PingVista shows this clearly in the UI.

## Option C: Supabase Free

1. Create a Supabase project.
2. Run `supabase/schema.sql`.
3. Configure these backend environment variables:

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SCHEDULER_INTERVAL_MS=300000
```

4. Use the Account card in Settings to sign up or sign in.

## Safety Limits For Public Demos

PingVista currently uses these backend safety controls:

- Blocks localhost, loopback, private IP ranges, metadata service IPs, and non-HTTP URLs
- Blocks URLs with embedded credentials
- Limits check requests per minute
- Limits write requests per minute
- Limits workspace endpoint count
- Limits JSON body size
- Validates method, URL, headers, timeout, status code, slow threshold, body, and webhook URL

## Suggested Public Copy

```text
PingVista is a free, open-source API monitoring dashboard.
The hosted demo is limited by free hosting. For reliable background checks,
self-host the Python backend or connect a paid backend service.
```
