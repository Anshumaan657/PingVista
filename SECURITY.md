# Security Policy

PingVista accepts user-provided URLs and asks the backend to fetch them. That makes URL safety a core security concern.

## Current Protections

- Blocks localhost and loopback hosts
- Blocks `127.0.0.1`, `0.0.0.0`, private IPv4 ranges, link-local ranges, and metadata service IPs
- Blocks `metadata.google.internal`
- Blocks non-HTTP and non-HTTPS URLs
- Blocks URLs with embedded credentials
- Validates HTTP method, headers, timeout, expected status, slow threshold, JSON body, and webhook URL
- Limits endpoint count
- Limits request body size
- Rate-limits reads, writes, and checks

## Responsible Disclosure

Please open a private GitHub security advisory if available, or contact the maintainer before publishing details of a vulnerability.

## Public Deployment Advice

- Keep the SSRF protections enabled.
- Keep rate limits enabled.
- Keep Supabase service role keys only on the backend.
- Use HTTPS in production.
- Monitor logs for repeated blocked URL attempts.
- Avoid offering unlimited free checks.
