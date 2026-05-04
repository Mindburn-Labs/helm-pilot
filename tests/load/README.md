# Load Tests (k6)

Load tests that exercise critical Pilot endpoints under realistic traffic.

## Prerequisites

Install k6: https://k6.io/docs/getting-started/installation/

```bash
# macOS
brew install k6

# Linux (Debian/Ubuntu)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

## Running

The gateway must be running on `BASE_URL` (default `http://localhost:3100`).

```bash
# Smoke test — basic sanity, ~1 min
k6 run tests/load/smoke.js

# Auth flow under load — 30s ramp, 2 min steady
k6 run tests/load/auth.js

# Knowledge search — mixed read/write, 3 min
k6 run tests/load/knowledge.js

# With custom base URL
BASE_URL=https://staging.example.com k6 run tests/load/smoke.js
```

## Thresholds

Each script sets SLOs via `thresholds`:
- `http_req_duration{p(95)} < 500ms` — p95 latency under 500ms
- `http_req_failed{rate} < 0.01` — error rate under 1%

k6 exits non-zero if thresholds are violated, making these usable in CI.

## Reports

Pass `--out` to export results:
```bash
k6 run --out json=results.json tests/load/smoke.js
k6 run --out csv=results.csv tests/load/smoke.js
```
