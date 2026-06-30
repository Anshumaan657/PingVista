# Day 3 Public Deployment Guide

Day 3 is about getting PingVista live as a professional public demo.

## Recommended Target

Use one hosted Python web service that serves both:

- the static frontend
- the Python backend API

Render is the simplest path because this repo already includes:

```text
render.yaml
requirements.txt
runtime.txt
Procfile
scripts/start.sh
```

## Pre-Deploy Checklist

Run these locally before creating the service:

```bash
npm run check
npm run test:security
```

Confirm the app starts:

```bash
HOST=0.0.0.0 PORT=4175 python3 app.py
```

Then open:

```text
http://127.0.0.1:4175
http://127.0.0.1:4175/api/health
```

## Render Deployment Steps

1. Push the latest code to GitHub.
2. Open Render.
3. Create a new Blueprint or Web Service from the PingVista repository.
4. Use the included `render.yaml` when Render detects it.
5. Confirm these values:

```text
Runtime: Python
Build command: pip install -r requirements.txt
Start command: python3 app.py
```

6. Add environment variables:

```env
HOST=0.0.0.0
SCHEDULER_INTERVAL_MS=300000
```

7. Leave Supabase variables unset unless auth is configured:

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

8. Deploy and wait for the public URL.

## Live Verification

After deployment, set your URL locally:

```bash
export PINGVISTA_DEPLOYMENT_URL=https://your-pingvista-url.onrender.com
```

Run:

```bash
npm run deploy:check
```

Expected result:

```text
PingVista deployment check passed
```

## Manual Live Checks

Open the deployed app and verify:

- dashboard loads
- `/api/health` returns `status: ok`
- runtime is `python`
- demo endpoints are visible
- `Check all` works
- CSV export downloads
- dark mode works
- private URL inputs are blocked

## README Update After Deployment

Replace the placeholder live URL in `README.md`:

```markdown
Live demo: https://your-pingvista-url.onrender.com
```

## Known Free-Hosting Notes

- Free services may sleep after inactivity.
- First load can be slow.
- Background checks only run while the hosted Python service is awake.
- Local JSON storage can reset when the platform restarts or redeploys.
