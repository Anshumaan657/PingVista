# Self-Hosting Guide

Self-hosting is the best path when you want PingVista to behave like a real monitoring tool.

## Requirements

- Python 3.10 or newer
- A public HTTPS URL for the backend
- Optional Supabase project for Auth

## Local Backend

```bash
npm start
```

This runs:

```bash
python3 app.py
```

Open:

```text
http://127.0.0.1:4175
```

## Environment Variables

```env
PORT=4175
HOST=0.0.0.0
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SCHEDULER_INTERVAL_MS=300000
```

## Deployment Notes

- `Procfile`, `render.yaml`, `requirements.txt`, and `runtime.txt` are included for Python hosting.
- Hosts usually provide `PORT`; set `HOST=0.0.0.0` for public deployments.
- Keep `SUPABASE_SERVICE_ROLE_KEY` only on the backend.
- Use HTTPS for public deployments.
- Set `SCHEDULER_INTERVAL_MS` to at least `300000` for a free-friendly 5 minute interval.
- Do not remove URL safety validation before public deployment.
- Keep endpoint count and rate limits conservative until billing is under control.

## Production Checklist

- Add a custom domain
- Configure Supabase
- Verify `/api/health`
- Run `npm run check`
- Run `npm run test:security`
- Confirm private URLs are blocked
- Confirm rate limits return `429`
- Add screenshots and live demo link to the README
