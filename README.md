# PingVista

PingVista is a frontend-only API monitoring workspace for checking endpoint health, latency, uptime, response validity, and incidents directly in the browser.

## Version 3 Features

- Dashboard tabs for Overview, Endpoints, Incidents, Reports, and Settings.
- Add and edit endpoints with groups/environments.
- Support HTTP methods: GET, POST, PUT, PATCH, and DELETE.
- Configure custom request headers.
- Add JSON request bodies for POST, PUT, and PATCH checks.
- Validate responses with expected HTTP status codes and body text matching.
- Run manual checks or automatic checks every 30 seconds, 1 minute, or 5 minutes.
- Search endpoints and filter by status or group.
- Track recent checks with SVG latency charts.
- Automatically open and resolve incidents based on endpoint recovery.
- View endpoint detail history in a modal.
- Export reports as CSV.
- Export and import full JSON backups.
- Persist endpoints, history, and incidents in `localStorage`.

## Run

Open `index.html` in a browser.

Suggested demo endpoints:

- `https://api.github.com`
- `https://jsonplaceholder.typicode.com/posts`
