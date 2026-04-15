# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth-flow.spec.ts >> Magic Link Authentication >> auth endpoints are rate limited
- Location: tests/auth-flow.spec.ts:92:3

# Error details

```
Error: apiRequestContext.post: connect ECONNREFUSED ::1:3100
Call log:
  - → POST http://localhost:3100/api/auth/email/request
    - user-agent: Playwright/1.59.1 (arm64; macOS 26.4) node/22.19
    - accept: */*
    - accept-encoding: gzip,deflate,br
    - content-type: application/json
    - content-length: 43

```