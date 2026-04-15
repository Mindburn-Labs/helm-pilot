# HELM Integration Guide

> How HELM Pilot consumes HELM's fail-closed governance engine, what's wired today, and what lands in the remaining Phase 1 slices.

## Why HELM

HELM Pilot's vision hinges on one structural claim: **every non-trivial action a founder delegates to Pilot goes through HELM's deterministic execution core before it runs.** No free-floating "the agent said so" — a signed receipt or an explicit denial, every time.

HELM OSS (helm-oss) provides that boundary. Pilot consumes it over HTTP as a docker-compose sidecar — there is no Go embedding, no process sharing, no shortcut.

## Architecture

```
HELM Pilot (Node.js)                       helm-oss (Go, :8080)
┌──────────────────────┐                   ┌──────────────────────────┐
│  AgentLoop           │                   │  Guardian Pipeline        │
│    ↓                 │   HTTP POST       │    Freeze → Context →     │
│  HelmClient ─────────┼──── /v1/chat/  ──▶│    Identity → Egress →    │
│    ↓                 │     completions   │    Threat → Delegation    │
│  chatCompletion()    │                   │    ↓                     │
│    ↓                 │                   │  Policy Bundle            │
│  OpenAI response     │ ◀── response ──── │    founder_ops.v1.json    │
│  + receipt headers   │   (2xx/403)       │    ↓                     │
│    ↓                 │                   │  EvidencePack + ProofGraph│
│  evidence_packs row  │                   │    (signed Ed25519)       │
└──────────────────────┘                   └──────────────────────────┘
```

## What's Wired Today (Phase 1, partial)

### Docker sidecar

`infra/docker/docker-compose.yml` defines a `helm` service that builds from the sibling `helm-oss/` repo (`Dockerfile.slim`). Pilot's container depends on it being healthy before starting.

```yaml
helm:
  image: ${HELM_IMAGE:-}
  build:
    context: ../../../helm-oss
    dockerfile: Dockerfile.slim
  ports: ['8420:8080', '8421:8081']
  environment:
    HELM_BIND_ADDR: 0.0.0.0
    HELM_UPSTREAM_URL: https://openrouter.ai/api/v1
    EVIDENCE_SIGNING_KEY: ${EVIDENCE_SIGNING_KEY:-pilot-dev-ephemeral-key-change-me}
    DATABASE_URL: postgres://helm:helm@postgres:5432/helm_governance?sslmode=disable
```

Set `HELM_IMAGE` in `.env` to pin a published image and skip the local build.

### TypeScript client

`packages/helm-client/` exposes the `HelmClient` class. Today it supports:

- `chatCompletion(principal, body)` — routes an OpenAI-shape request through HELM's governed proxy. Returns `{body, receipt}` on ALLOW; throws `HelmDeniedError` on DENY, `HelmEscalationError` on ESCALATE, `HelmUnreachableError` on any other failure mode.
- `health()` — non-governed probe of `/healthz`. Safe for dashboard polling.
- `evaluate(...)` — stubbed with `HelmNotImplementedError` until helm-oss exposes a generic `POST /api/v1/guardian/evaluate` endpoint.

**Fail-closed discipline:**

- 2xx with missing governance headers → `HelmUnreachableError` (protocol violation, deny).
- 403 with DENY verdict → `HelmDeniedError` with the receipt attached.
- 5xx or network failure → retried up to 3 times with exponential backoff, then `HelmUnreachableError`.
- A 403 verdict is NEVER retried; it's a definitive governance outcome.

### Policy pack

`packs/founder_ops.v1.json` is HELM Pilot's policy bundle. It mirrors the structure of `helm-oss/reference_packs/exec_ops.v1.json`:

- **Programs** — 7 founder-facing programs (intake, discovery, cofounder assessment, decision court, MVP build, launch, YC application) with signal filters.
- **Employees** — 5 virtual employees (Engineering / Product / Growth / Design / Ops operators) with tool scopes and execution modes.
- **Capability grants** — per-connector daily action caps and per-target approval gates (e.g. "first deploy per app requires approval").
- **Budget envelopes** — workspace daily/weekly/monthly USD ceilings plus per-operator daily ceilings.
- **Policy overlays** — human-reviewed escalations for external email, deploys, financial actions, application submission, and external posts.

Mount the pack at `/home/helm/packs/founder_ops.v1.json` inside the sidecar (done automatically in `docker-compose.yml`) and register it on startup via `helm bundle add`.

### Local evidence table

`evidence_packs` (see `packages/db/src/schema/governance.ts`) is a workspace-scoped local mirror of every HELM receipt the orchestrator emits. Populated by `HelmClient.onReceipt`. Browsable under `/api/governance/receipts`.

`helm_health_snapshots` stores periodic health probes for the dashboard.

Three new columns on `task_runs` (`helm_decision_id`, `helm_policy_version`, `helm_reason_code`) anchor every agent iteration to its governance decision.

### Admin surface

- `GET /api/governance/status` — live HELM probe + latest snapshot
- `GET /api/governance/receipts` — paginated workspace receipts (cursor pagination)
- `GET /api/governance/receipts/:decisionId` — single receipt with the signed blob for offline verification

## What's Not Wired Yet (remaining Phase 1)

1. **AgentLoop wiring.** `services/orchestrator/src/agent-loop.ts` still calls its local LLM provider directly. The next Phase 1 slice replaces that path with `HelmClient.chatCompletion()` and persists `receipt.decisionId` + `receipt.policyVersion` onto the `taskRuns` row. This is the change that makes the "every LLM call is governed" invariant real.

2. **HelmTrustBoundary for tool calls.** helm-oss v0.3.0 does not yet expose a generic `POST /api/v1/guardian/evaluate` for non-LLM tool invocations (see §"Known gap" below). Until then, Pilot's local `TrustBoundary` stays authoritative for tool calls; HELM receipts only flow for LLM_INFERENCE actions.

3. **Migration generation.** `npm run db:generate` needs to be run against the current schema to produce the `0005_governance.sql` migration artifact. Deferred to a database-attached session.

4. **/health endpoint extension.** The gateway's `/health` should include HELM liveness as a sub-check (`checks.helm`) so the docker-compose healthcheck is end-to-end.

5. **Fly.io deploy config.** `infra/fly/` needs a sibling app for the helm sidecar with internal networking.

## Known Gap: Generic Guardian evaluate() endpoint

helm-oss v0.3.0 governs LLM calls via its OpenAI-proxy pattern at `/v1/chat/completions`. There is **no generic HTTP endpoint** that takes a `{principal, action, resource, context}` tuple and returns a `{verdict, permit_id, evidence_pack_id}` response. The closest are:

- `/api/v1/authz/check` — returns a status string, not a decision.
- `/api/v1/boundary/check` — network-egress-specific.
- `/api/v1/obligation/create` — creates an obligation artifact, not an evaluation.

For Pilot to enforce tool-level governance end-to-end (e.g. `github.commit`, `fly.deploy`, `launch.post_hackernews`), helm-oss needs a new endpoint:

```
POST /api/v1/guardian/evaluate
Content-Type: application/json
{
  "principal": "workspace:uuid/operator:engineering",
  "action": "TOOL_USE",
  "resource": "github.commit",
  "context": { "repo": "owner/name", "branch": "main", "diff_hash": "sha256:..." }
}
→ 200 { "decision_id": "...", "verdict": "ALLOW|DENY|ESCALATE", "policy_version": "...", "decision_hash": "..." }
```

This is tracked as an upstream helm-oss work item. Until it lands:

- **LLM governance is live** via `chatCompletion()`.
- **Tool governance is local** via `services/orchestrator/src/trust.ts`.

The `HelmClient.evaluate()` method is reserved for this endpoint and throws `HelmNotImplementedError` today — callers can safely probe for it.

## Environment reference

| Variable | Purpose | Default |
|---|---|---|
| `HELM_GOVERNANCE_URL` | Base URL of HELM's governed API | `http://helm:8080` in compose, `http://localhost:8420` on host |
| `HELM_HEALTH_URL` | Base URL of HELM's health server | `http://helm:8081` / `http://localhost:8421` |
| `HELM_FAIL_CLOSED` | When `1` (default) any HELM unreachability denies tool calls | `1` |
| `HELM_UPSTREAM_URL` | Upstream LLM endpoint HELM forwards allowed requests to | `https://openrouter.ai/api/v1` |
| `EVIDENCE_SIGNING_KEY` | Ed25519 signing key for evidence packs — use Docker/Fly secret in production | `pilot-dev-ephemeral-key-change-me` |
| `HELM_IMAGE` | Pin a published HELM image instead of building from `../../../helm-oss` | unset → build locally |
| `HELM_PORT` / `HELM_HEALTH_PORT` | Host ports for the sidecar | `8420` / `8421` |

## Offline receipt verification

Every `evidence_packs.signedBlob` is a self-contained JCS-canonicalized record signed with Ed25519 by HELM. Verify without a running HELM:

```bash
# Pull a receipt by decision ID
curl -H "Authorization: Bearer $TOKEN" \
  "$PILOT_URL/api/governance/receipts/$DECISION_ID" > receipt.json

# Extract signed blob and verify against HELM's public key
# (verification CLI ships in a future slice of helm-oss)
```

The verification path is part of the launch-readiness definition of done. Until the CLI lands, trust the `verified_at` timestamp populated by the orchestrator after a background verification job.

## Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| Every LLM call returns 500 with `HelmUnreachableError` | HELM sidecar unhealthy | `docker compose logs helm`, check `/healthz`, verify `EVIDENCE_SIGNING_KEY` set |
| Agent loop blocks on `HelmDeniedError` | Policy bundle denies the action | Inspect receipt in `evidence_packs`, check which overlay triggered; review `packs/founder_ops.v1.json` |
| Receipts table empty despite agent runs | `helmClient` not passed to orchestrator | Startup log should show `HELM client configured`; if not, check `HELM_GOVERNANCE_URL` |
| HELM build fails on `docker compose build` | `../../../helm-oss` not present or out of date | `git clone https://github.com/Mindburn-Labs/helm-oss` as a sibling of HELM Pilot |
