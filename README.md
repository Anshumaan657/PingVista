# PingVista

A small frontend-only API performance monitor that checks endpoint health, response time, uptime, and recent latency history.

## Features

- Add custom API endpoints with configurable timeout.
- Ping one endpoint or all endpoints at once.
- Classify results as healthy, slow, or down.
- Track recent checks with mini latency charts.
- Persist endpoints and history in `localStorage`.

## Run

Open `index.html` in a browser.

Suggested demo endpoints:

- `https://api.github.com`
- `https://jsonplaceholder.typicode.com/posts`
