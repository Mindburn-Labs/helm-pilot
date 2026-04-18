// HELM Pilot — 50-founder baseline (Phase 13 Track F2)
//
// k6 v0.50+ script simulating 50 concurrent founders hitting the
// gateway's no-auth read surface (health, governance status, subagent
// list). Baseline capacity check — it does not exercise the full task
// lifecycle because that requires per-tenant auth + LLM cost. The
// numbers it measures (p99 latency, error rate) are the floor: if
// these targets don't hold for unauthenticated reads, authenticated
// task-loop throughput will be worse.
//
// Usage:
//   BASE_URL=https://staging.helm-pilot.dev k6 run loadtests/k6/founder-50.js
//   k6 run -e BASE_URL=http://localhost:3100 loadtests/k6/founder-50.js
//
// Pass criteria (from approved Phase 13 plan):
//   http_req_duration p99 < 500ms (excluding LLM calls)
//   http_req_failed rate < 1%
//   checks rate > 99%
//
// Reference: https://k6.io/docs/using-k6/thresholds/

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:3100';
const subagentHits = new Counter('subagent_list_hits');

export const options = {
  scenarios: {
    founder_ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 }, // ramp to 50 VUs
        { duration: '3m', target: 50 }, // hold 3 minutes
        { duration: '30s', target: 0 }, // ramp down
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_duration: ['p(99)<500'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

export default function () {
  group('health', () => {
    const res = http.get(`${BASE}/health`);
    check(res, {
      'health status 200 or 503': (r) => r.status === 200 || r.status === 503,
      'health has service field': (r) => {
        try {
          return JSON.parse(r.body).service === 'helm-pilot';
        } catch {
          return false;
        }
      },
    });
  });

  group('governance-status', () => {
    const res = http.get(`${BASE}/api/governance/status`);
    check(res, {
      'governance status has helmConfigured': (r) => {
        if (r.status !== 200) return true; // auth-gated is ok
        try {
          return typeof JSON.parse(r.body).helmConfigured === 'boolean';
        } catch {
          return false;
        }
      },
    });
  });

  group('subagent-list', () => {
    const res = http.get(`${BASE}/api/orchestrator/subagents`);
    check(res, {
      'subagent list returns array or is gated': (r) => {
        if (r.status !== 200) return true;
        try {
          return Array.isArray(JSON.parse(r.body).subagents);
        } catch {
          return false;
        }
      },
    });
    if (res.status === 200) subagentHits.add(1);
  });

  // Simulate think-time between page navigations.
  sleep(1 + Math.random() * 2);
}
