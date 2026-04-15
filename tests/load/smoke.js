import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * Smoke test — verifies that HELM Pilot's public endpoints respond
 * correctly under modest, steady load.
 *
 * Target: 5 VUs for 1 minute, ~300 requests across /health, /, /metrics.
 */

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3100';

export const options = {
  vus: 5,
  duration: '1m',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  // Rotate through public endpoints
  const endpoints = ['/health', '/', '/metrics'];
  const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];

  const res = http.get(`${BASE_URL}${endpoint}`);
  check(res, {
    'status is 200 or 503': (r) => r.status === 200 || r.status === 503,
    'response body is non-empty': (r) => r.body && r.body.length > 0,
    'X-Request-Id header is set': (r) => !!r.headers['X-Request-Id'],
  });

  sleep(0.2);
}
