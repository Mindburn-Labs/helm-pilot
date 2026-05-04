# Web
<!-- docs-generated: surface-readme -->

## Purpose

Active app surface for the pilot project.

The Discover page consumes founder profile, opportunity, co-founder, connector, and YC ingestion APIs. The web API helper returns `null` for non-2xx JSON responses, so empty states such as a missing founder profile must be handled as normal UI state instead of thrown errors.

## Canonical Interface

- Source path: `apps/web`
- Package: `@pilot/web`.
- Coverage record: `docs/documentation-coverage.csv`
- Current API contract: cookie-authenticated requests include CSRF headers for mutating calls, and list/detail responses are normalized before rendering.

## Local Commands

- `npm run build -w apps/web`
- `npm run dev -w apps/web`
- `npm run start -w apps/web`
- `npm run test -w apps/web`
- `npm run test:coverage -w apps/web`
- `npm run typecheck -w apps/web`

## Documentation Contract

Generated surface README. This file is a local ownership and validation contract, not the primary docs information architecture entry point. It covers the active app surface. Keep it aligned with the source path above and update `docs/documentation-coverage.csv` when ownership, interfaces, validation, or lifecycle status changes.
