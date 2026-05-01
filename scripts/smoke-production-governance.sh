#!/usr/bin/env bash
set -euo pipefail

# Production governance smoke profile.
# Expects a running Pilot deployment with HELM sidecar enabled and fail-closed.

API_URL="${API_URL:-http://localhost:3100}"

if [ "${HELM_FAIL_CLOSED:-}" != "1" ]; then
  echo "HELM_FAIL_CLOSED=1 is required for production smoke." >&2
  exit 1
fi

if [ -n "${OPENROUTER_API_KEY:-}${ANTHROPIC_API_KEY:-}${OPENAI_API_KEY:-}" ] &&
  [ "${ALLOW_DIRECT_LLM_KEYS:-}" != "1" ]; then
  echo "Direct Pilot LLM provider keys are set. Keep provider keys on the HELM sidecar." >&2
  exit 1
fi

node --input-type=module <<'NODE'
const apiUrl = process.env.API_URL.replace(/\/$/, '');

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function readJson(path, init) {
  const response = await fetch(`${apiUrl}${path}`, init);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    fail(`${path} did not return JSON: ${text.slice(0, 200)}`);
  }
  return { response, body };
}

const health = await readJson('/health');
if (!health.response.ok) {
  fail(`/health returned ${health.response.status}: ${JSON.stringify(health.body)}`);
}
if (health.body?.checks?.helm !== 'ok') {
  fail(`/health must report checks.helm="ok": ${JSON.stringify(health.body?.checks)}`);
}

const metricsHeaders = process.env.METRICS_AUTH_TOKEN
  ? { Authorization: `Bearer ${process.env.METRICS_AUTH_TOKEN}` }
  : {};
const metrics = await fetch(`${apiUrl}/metrics`, { headers: metricsHeaders });
const metricsText = await metrics.text();
if (!metrics.ok || !metricsText.includes('helm_pilot_http_requests_total')) {
  fail('/metrics did not expose helm_pilot_http_requests_total');
}

const unauthTasks = await fetch(`${apiUrl}/api/tasks`);
if (unauthTasks.status !== 401) {
  fail(`/api/tasks without auth should return 401, got ${unauthTasks.status}`);
}

const token = process.env.SMOKE_TOKEN;
const workspaceId = process.env.SMOKE_WORKSPACE_ID;
if (token) {
  const governance = await readJson('/api/governance/status', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!governance.response.ok || governance.body?.helmConfigured !== true) {
    fail(
      `/api/governance/status must be authenticated and HELM-configured: ${JSON.stringify(
        governance.body,
      )}`,
    );
  }
}

const taskId = process.env.SMOKE_TASK_ID;
if (token && workspaceId && taskId) {
  const run = await readJson(`/api/tasks/${encodeURIComponent(taskId)}/run`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Workspace-Id': workspaceId,
    },
    body: JSON.stringify({
      context:
        'Production smoke: perform one bounded governed planning step. Do not call external services.',
      iterationBudget: 1,
    }),
  });
  if (!run.response.ok || !run.body?.run) {
    fail(`governed task smoke failed: ${run.response.status} ${JSON.stringify(run.body)}`);
  }
}

console.log('Production governance smoke passed.');
NODE
