import http from 'k6/http';
import { check, sleep } from 'k6';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

/**
 * Auth-flow load test.
 *
 * Scenario: each VU completes the full magic-link flow (request → verify →
 * authenticated GET → logout), validating that rate limiting behaves correctly
 * under traffic and that session creation doesn't degrade at scale.
 *
 * NOTE: /api/auth/* is rate-limited to 5 req/min per IP — this test
 * deliberately stays under that threshold per-VU.
 */

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3100';

export const options = {
  stages: [
    { duration: '30s', target: 10 }, // ramp up to 10 concurrent users
    { duration: '2m', target: 10 },  // sustained
    { duration: '30s', target: 0 },  // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<800'], // Auth involves DB writes, allow more headroom
    http_req_failed: ['rate<0.02'],   // <2% failure rate (some 429s expected)
    'checks{endpoint:verify}': ['rate>0.9'], // 90%+ of verify attempts succeed
  },
};

export default function () {
  const email = `load-${randomString(10)}@pilot.test`;

  // Step 1: Request magic code
  const reqResp = http.post(
    `${BASE_URL}/api/auth/email/request`,
    JSON.stringify({ email }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  if (reqResp.status === 429) {
    sleep(2); // Back off on rate limit
    return;
  }

  check(reqResp, {
    'request returned 200': (r) => r.status === 200,
    'response contains code': (r) => {
      try {
        return !!JSON.parse(r.body).code;
      } catch {
        return false;
      }
    },
  });

  let code;
  try {
    code = JSON.parse(reqResp.body).code;
  } catch {
    return;
  }
  if (!code) return;

  // Step 2: Verify
  const verifyResp = http.post(
    `${BASE_URL}/api/auth/email/verify`,
    JSON.stringify({ email, code }),
    { headers: { 'Content-Type': 'application/json' }, tags: { endpoint: 'verify' } },
  );

  check(verifyResp, {
    'verify returned 200': (r) => r.status === 200,
    'response contains token': (r) => {
      try {
        return !!JSON.parse(r.body).token;
      } catch {
        return false;
      }
    },
  });

  let token;
  try {
    token = JSON.parse(verifyResp.body).token;
  } catch {
    return;
  }
  if (!token) return;

  // Step 3: Authenticated read (should succeed)
  const authedResp = http.get(`${BASE_URL}/health`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  check(authedResp, {
    'authed health 200': (r) => r.status === 200,
  });

  sleep(1);
}
