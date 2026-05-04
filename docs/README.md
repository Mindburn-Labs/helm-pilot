# Pilot Docs

This tree is the canonical documentation source for Pilot self-hosting, API behavior, HELM integration, security, operations, ingestion, and public positioning.

## Start

- [Self-hosting](self-hosting.md)
- [API reference](api.md)
- [Pilot v1 spec](spec/v1.md)

## How-To

- [Runbook](runbook.md)
- [Environment reference](env-reference.md)
- [HELM integration](helm-integration.md)

## Reference

- [Security hardening](security.md)
- [Degradation matrix](degradation-matrix.md)
- [Documentation coverage ledger](documentation-coverage.csv)

## Explanation

- [Pilot vs general-purpose autonomy](positioning/pilot-vs-general-purpose-autonomy.md)
- [Scrapling ingestion](ingestion/scrapling-v045.md)
- [Roadmap](roadmap.md)

## Documentation Gates

- `npm run docs:coverage`
- `npm run docs:truth`
- `npm run format:check`
- `npm run typecheck`

Update [documentation-coverage.csv](documentation-coverage.csv) whenever services, routes, migrations, deployment workflows, env vars, public docs manifests, or HELM boundary behavior change.
