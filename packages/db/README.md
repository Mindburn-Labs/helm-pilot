# Db

## Purpose

Active package surface for the helm-pilot project.

The package owns Drizzle schema and migrations. Migration `0017_ingestion_replay_columns` adds replay tracking for YC ingestion records: `replay_count` and `last_replayed_at`.

## Canonical Interface

- Source path: `packages/db`
- Package: `@helm-pilot/db`.
- Coverage record: `docs/documentation-coverage.csv`

## Local Commands

- `npm run build -w packages/db`
- `npm run dev -w packages/db`
- `npm run generate -w packages/db`
- `npm run migrate -w packages/db`
- `npm run migrate:production -w packages/db`
- `npm run studio -w packages/db`
- `npm run test -w packages/db`
- `npm run test:coverage -w packages/db`

## Documentation Contract

This README is the maintainer reference for this active package surface. Keep it aligned with the source path above and update `docs/documentation-coverage.csv` when ownership, interfaces, validation, or lifecycle status changes.
