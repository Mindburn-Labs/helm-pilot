# Contributing to HELM Pilot

Thank you for considering a contribution to HELM Pilot. This guide covers the
essentials for getting started, submitting changes, and passing CI.

## Prerequisites

- **Node.js 22+** (see `.nvmrc`)
- **Docker** (for PostgreSQL with pgvector)
- **Python 3.10+** (only needed for browser-automation pipelines)

## Quick Start

```bash
git clone https://github.com/Mindburn-Labs/helm-pilot.git
cd helm-pilot
cp .env.example .env          # fill in required values
docker compose up postgres -d # starts pgvector:pg17
npm ci
npm run db:migrate
npm run dev                   # gateway on :3100
```

## Project Structure

```
services/   — gateway, orchestrator, intelligence
packages/   — shared libraries (db, shared, scoring, dedup, ...)
apps/       — telegram-bot, telegram-miniapp
pipelines/  — Python browser-automation agents
packs/      — HELM policy packs (founder_ops, ...)
e2e/        — Playwright end-to-end tests
```

See `docs/spec/v1.md` for the full architecture specification.

## Branch Naming

```
feat/<short-description>
fix/<short-description>
chore/<short-description>
docs/<short-description>
```

## Commit Format

```
<type>: <imperative summary>

Optional body explaining *why*, not *what*.

Signed-off-by: Your Name <email@example.com>
```

Types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`.

All commits must include a **DCO sign-off** (`git commit -s`). The CI will
reject unsigned commits.

## Code Style

- **Single quotes**, **semicolons**, **trailing commas** (`prettier`)
- `const`-only — no `let`, no mutation
- Run `npm run format` before committing

## Testing

```bash
npm test              # unit tests (vitest, all workspaces)
npm run typecheck     # TypeScript strict
npm run lint:tenancy  # no unscoped DB queries on workspace-scoped tables
npm run test:e2e      # Playwright (requires running gateway)
```

All four must pass before a PR can merge.

## Pull Request Checklist

- [ ] `npm run typecheck` passes
- [ ] `npm run lint:tenancy` passes
- [ ] `npm test` passes
- [ ] New code has test coverage
- [ ] DCO sign-off on every commit

## Running E2E Tests Locally

```bash
docker compose up postgres -d
npm run dev &                     # or: npm start -w services/gateway
cd e2e && npm run test:e2e
```

## License

By contributing, you agree that your contributions will be licensed under the
MIT License (see `LICENSE`).
