# PingVista

PingVista is an open-source API monitoring dashboard for developers. It helps you check endpoints, track latency, validate responses, review incidents, export reports, and optionally run checks through a small Python backend.

![PingVista dashboard preview](assets/pingvista-screenshot.svg)

## Current Status

PingVista is ready for local use, public demos, and self-hosted deployments. It can run as a browser-only tool for free, or with the Python backend for server-side checks, webhook alerts, health reporting, and optional Supabase Auth configuration.

## Try It Live

Live demo: `Add your Render URL after Day 3 deployment`

Free hosting may sleep after inactivity. If the app takes a few seconds to load, wait and refresh once.

## Features

- Demo mode with sample endpoints, latency history, and an example resolved incident
- Manual checks for one endpoint or all endpoints
- Browser-based automatic monitoring
- Optional Python backend checks
- Optional backend scheduler while the Python service is running
- Optional Supabase Auth configuration
- Endpoint groups for Production, Staging, and Development
- HTTP methods: `GET`, `POST`, `PUT`, `PATCH`, and `DELETE`
- Custom headers and JSON request bodies
- Expected status and response body validation
- Latency charts built with SVG
- Uptime, status, latency, and incident summaries
- Incident open/recovery tracking
- Webhook alerts for incident and recovery events
- Search and filters by status or group
- CSV report export
- JSON backup/import
- Dark mode
- Backend health endpoint at `/api/health`
- Security validation for public URL checks
- Rate limits, endpoint limits, and request body limits
- GitHub Actions CI for syntax and security tests

## Quick Start

### Browser-only mode

Open `index.html` in a modern browser.

This mode is fully free. It stores data in `localStorage` and runs checks from the browser, so some APIs may fail because of CORS.

### Backend mode

```bash
npm start
```

Then open:

```text
http://127.0.0.1:4175
```

Backend mode stores local data in:

```text
data/pingvista-db.json
```

### Supabase mode

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL editor.
3. Copy `.env.example` to `.env`.
4. Fill these values:

```env
PORT=4175
HOST=0.0.0.0
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SCHEDULER_INTERVAL_MS=300000
```

When these variables are present, PingVista can proxy Supabase sign-up and sign-in from the Settings tab. The Python backend keeps the no-cost local JSON persistence path as the default.

## Useful Commands

```bash
npm start
npm run check
npm run test:security
npm run deploy:check
```

## Health Check

The backend exposes:

```text
GET /api/health
```

It returns service status, storage mode, scheduler status, Supabase availability, and active safety limits.

## Free Deployment

PingVista can be deployed for free as a public demo:

- Frontend: GitHub Pages, Vercel Hobby, Netlify Free, or Render Static Site
- Backend: optional Render/Railway free or trial service
- Database/Auth: Supabase Free

Read the full guide:

```text
docs/FREE_DEPLOYMENT.md
docs/DAY3_PUBLIC_DEPLOYMENT.md
```

## Self-Hosting

For real monitoring, self-host the backend so scheduled checks continue while your browser is closed.

Read:

```text
docs/SELF_HOSTING.md
```

## Project Structure

```text
PingVista/
├── .github/workflows/ci.yml
├── assets/
│   ├── pingvista-og.svg
│   └── pingvista-screenshot.svg
├── data/
├── docs/
│   ├── FREE_DEPLOYMENT.md
│   ├── DAY3_PUBLIC_DEPLOYMENT.md
│   └── SELF_HOSTING.md
├── supabase/
│   └── schema.sql
├── tests/
│   └── python-backend.test.py
├── .env.example
├── CONTRIBUTING.md
├── LICENSE
├── Procfile
├── README.md
├── ROADMAP.md
├── SECURITY.md
├── app.py
├── index.html
├── package.json
├── render.yaml
├── requirements.txt
├── runtime.txt
├── scripts/
│   ├── start.sh
│   └── verify_deployment.py
├── script.js
└── styles.css
```

## Limitations

- Browser-only checks are affected by CORS.
- Free hosting may sleep, pause, or limit background checks.
- The backend scheduler only runs while the Python service is running.
- Supabase credentials are required for real user-owned cloud persistence.
- PingVista is not a replacement for enterprise observability platforms yet.

## License

MIT License. See `LICENSE`.
