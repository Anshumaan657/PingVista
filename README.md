# PingVista

A lightweight, frontend-only API monitoring dashboard. Ping endpoints, track latency, validate responses, and review incidents in the browser with no backend setup.

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
- Endpoint detail modal with recent check history
- CSV report export
- JSON backup and import
- Browser persistence with `localStorage`

## Quick Start

Clone or download the repository, then open `index.html` in a modern browser.

You can also run it with a local static server:

```bash
python3 -m http.server 4175
```

Then visit:

```text
http://127.0.0.1:4175/index.html
```

## Demo Endpoints

Try these public endpoints:

```text
https://api.github.com
https://jsonplaceholder.typicode.com/posts
```

## Usage

1. Add an endpoint with a name, URL, method, group, timeout, and validation rules.
2. Click `Check` on one endpoint or `Check all` for every endpoint.
3. Use auto monitoring to run checks repeatedly.
4. Review latency, uptime, status code, validation result, and recent history.
5. Check the Incidents tab to see failed checks and recovered endpoints.
6. Export a CSV report or JSON backup when needed.

## Dashboard Sections

- **Overview**: Metrics, filters, auto monitoring, group summaries, and endpoint cards.
- **Endpoints**: Endpoint configuration table with edit and detail actions.
- **Incidents**: Open and resolved local incident history.
- **Reports**: Summary cards for checks, failures, incidents, groups, and validation coverage.
- **Settings**: JSON backup/import and local storage summary.

## Limitations

- **CORS applies**: Some APIs may fail because browser requests are blocked by the target server, even when the API is online.
- **Local only**: Data is stored in the current browser with `localStorage`.
- **Not production monitoring**: PingVista does not run checks when the browser is closed.
- **Single-user tool**: There is no authentication, team workspace, server database, or shared alerting.
- **Browser-based timing**: Latency numbers are useful for quick checks, not precise infrastructure monitoring.

## Project Structure

```text
PingVista/
├── index.html
├── styles.css
├── script.js
└── README.md
```

## Tech Stack

- HTML5
- CSS3
- Vanilla JavaScript
- Browser `fetch()` API
- `AbortController` for request timeouts
- `localStorage` for persistence
- SVG for latency charts

## Roadmap Ideas

- Add a backend worker to avoid browser CORS limitations.
- Add GitHub Pages or Vercel deployment.
- Add screenshots or a short demo GIF.
- Add alert integrations such as email, Slack, Discord, or Telegram.
- Add a database for long-term history.
- Add team accounts and shared monitors.

## License

No license has been added yet.
