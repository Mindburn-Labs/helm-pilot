# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Pilot, please report it
**privately** via email:

**security@mindburn.org**

**Do NOT open a public GitHub issue for security vulnerabilities.**

## What to Include

- Description of the vulnerability
- Steps to reproduce (if applicable)
- Affected versions or components
- Potential impact assessment

## Response SLA

- **Acknowledge** your report within **48 hours**
- **Triage and fix** critical vulnerabilities within **7 days**
- Non-critical issues are prioritized in the next release cycle

## Disclosure

We follow coordinated disclosure. Once a fix is released, we will credit
reporters (unless anonymity is requested) in the release notes.

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |

## Scope

This policy covers the Pilot repository, including the gateway, orchestrator,
intelligence pipeline, scoring engine, and HELM policy packs. Third-party
dependencies are tracked via `npm audit` in CI.
