# PingVista

A lightweight API monitoring dashboard. Ping endpoints, track latency, validate responses, review incidents, and optionally run checks through a small Node backend.

## What Changed In Version 4

Version 4 adds a backend mode while keeping the original frontend-only workflow available.

- Optional Node.js backend worker for server-side API checks
- File-based JSON persistence in `data/pingvista-db.json`
- Backend check endpoints for single and bulk monitoring
- Webhook alert support for down and recovery events
- Dark mode
- Runtime mode switch: browser-only or backend worker
- Expanded reports with uptime, average latency, and backend-check counts
- Project metadata through `package.json`

## Features

- Manual endpoint checks
- Automatic checks at fixed intervals
- Endpoint groups for environments like Production, Staging, and Development
- HTTP method support: `GET`, `POST`, `PUT`, `PATCH`, and `DELETE`
- Custom request headers
- JSON request body support for `POST`, `PUT`, and `PATCH`
- Response validation using expected status code and optional body text matching
- Latency charts built with SVG
- Endpoint search and filtering by status or group
- Local incident tracking with automatic open/resolve behavior
- Optional webhook alerts in backend mode
- Endpoint detail modal with recent check history
- CSV report export
- JSON backup and import
- Browser persistence with `localStorage`
- Backend persistence with a local JSON file

## Quick Start

### Frontend-only mode

Open `index.html` in a modern browser.

This mode stores data in browser `localStorage` and runs checks from the browser.

### Backend mode

Run the included Node server:

```bash
npm start
```

Then visit:

```text
http://127.0.0.1:4175
```

Backend mode stores data in:

```text
data/pingvista-db.json
```

## Demo Endpoints

Try these public endpoints:

```text
https://api.github.com
https://jsonplaceholder.typicode.com/posts
```

## Usage

1. Add an endpoint with a name, URL, method, group, timeout, and validation rules.
2. Choose browser-only mode or backend-worker mode in Settings.
3. Click `Check` on one endpoint or `Check all` for every endpoint.
4. Use auto monitoring to run checks repeatedly.
5. Review latency, uptime, status code, validation result, and recent history.
6. Check the Incidents tab to see failed checks and recovered endpoints.
7. Export a CSV report or JSON backup when needed.

## Dashboard Sections

- **Overview**: Metrics, filters, auto monitoring, group summaries, and endpoint cards.
- **Endpoints**: Endpoint configuration table with edit and detail actions.
- **Incidents**: Open and resolved local incident history.
- **Reports**: Summary cards for checks, failures, uptime, latency, incidents, groups, and validation coverage.
- **Settings**: Runtime mode, dark mode, webhook alerts, JSON backup/import, and storage summary.

## Webhook Alerts

Webhook alerts work in backend mode. Add a webhook URL in Settings, then PingVista sends JSON events when:

- An endpoint opens an incident
- An endpoint recovers, if recovery alerts are enabled

The backend sends payloads shaped like:

```json
{
  "app": "PingVista",
  "event": "down",
  "incident": {
    "endpointName": "GitHub API",
    "status": "open"
  }
}
```

## Limitations

- **Frontend-only mode still has CORS limits**: Some APIs may fail because browser requests are blocked by the target server.
- **Backend mode is local-first**: It uses a JSON file, not a production database.
- **No background daemon**: Checks run while the Node server and dashboard workflow are active.
- **Single-user tool**: There is no authentication, team workspace, or permissions model.
- **Webhook delivery is best-effort**: Failed alert delivery does not block monitoring.

## Project Structure

```text
PingVista/
├── data/
│   └── .gitkeep
├── index.html
├── package.json
├── script.js
├── server.js
├── styles.css
└── README.md
```

## Tech Stack

- HTML5
- CSS3
- Vanilla JavaScript
- Node.js built-in `http` server
- Browser and server `fetch()` APIs
- `AbortController` for request timeouts
- `localStorage` for browser mode
- JSON file persistence for backend mode
- SVG for latency charts

## Useful Commands

```bash
npm start
npm run check
```

## Roadmap Ideas

- Replace JSON persistence with SQLite or PostgreSQL.
- Add a true background scheduler in the backend.
- Add email, Slack, Discord, or Telegram alert templates.
- Add GitHub Pages, Render, Railway, or Vercel deployment.
- Add screenshots or a short demo GIF.
- Add authentication and shared team monitors.

## License

No license has been added yet.
