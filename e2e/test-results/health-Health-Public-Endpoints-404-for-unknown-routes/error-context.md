# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: health.spec.ts >> Health & Public Endpoints >> 404 for unknown routes
- Location: tests/health.spec.ts:53:3

# Error details

```
Error: apiRequestContext.get: connect ECONNREFUSED ::1:3100
Call log:
  - → GET http://localhost:3100/nonexistent-route
    - user-agent: Playwright/1.59.1 (arm64; macOS 26.4) node/22.19
    - accept: */*
    - accept-encoding: gzip,deflate,br

```