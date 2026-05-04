import http from 'k6/http';
import { check, sleep } from 'k6';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

/**
 * Knowledge search load test.
 *
 * Each VU authenticates once, then issues a mix of:
 *   - POST /api/knowledge/pages (write, 20%)
 *   - GET  /api/knowledge/search (keyword, 40%)
 *   - GET  /api/knowledge/search?method=hybrid (hybrid w/ embedding, 40%)
 *
 * Tests read-heavy traffic patterns typical of AI assistants browsing context.
 */

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3100';

export const options = {
  stages: [
    { duration: '30s', target: 5 },
    { duration: '3m', target: 5 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'], // Search may hit LLM for embeddings
    http_req_failed: ['rate<0.02'],
  },
};

// Per-VU setup: authenticate once
export function setup() {
  return {};
}

function authenticate() {
  const email = `kb-load-${randomString(10)}@pilot.test`;
  const reqResp = http.post(
    `${BASE_URL}/api/auth/email/request`,
    JSON.stringify({ email }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (reqResp.status !== 200) return null;
  let code;
  try { code = JSON.parse(reqResp.body).code; } catch { return null; }
  if (!code) return null;

  const verifyResp = http.post(
    `${BASE_URL}/api/auth/email/verify`,
    JSON.stringify({ email, code }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (verifyResp.status !== 200) return null;
  try { return JSON.parse(verifyResp.body).token; } catch { return null; }
}

// Cache token in VU state (k6 re-runs default per iteration)
let cachedToken = null;

export default function () {
  if (!cachedToken) {
    cachedToken = authenticate();
    if (!cachedToken) {
      sleep(1);
      return;
    }
  }
  const headers = { Authorization: `Bearer ${cachedToken}`, 'Content-Type': 'application/json' };

  const r = Math.random();
  if (r < 0.2) {
    // Write
    const payload = {
      type: 'note',
      title: `Load test ${randomString(8)}`,
      content: 'Load test content for indexing benchmarks.',
    };
    const resp = http.post(`${BASE_URL}/api/knowledge/pages`, JSON.stringify(payload), { headers });
    check(resp, { 'page created': (r) => r.status === 201 });
  } else if (r < 0.6) {
    // Keyword search
    const resp = http.get(`${BASE_URL}/api/knowledge/search?q=load`, { headers });
    check(resp, { 'search keyword ok': (r) => r.status === 200 });
  } else {
    // Hybrid search
    const resp = http.get(`${BASE_URL}/api/knowledge/search?q=load&method=hybrid`, { headers });
    check(resp, { 'search hybrid ok': (r) => r.status === 200 });
  }

  sleep(0.5);
}
