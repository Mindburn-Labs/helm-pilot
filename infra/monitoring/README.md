# Monitoring

Grafana dashboards + Prometheus alert rules for Pilot.

## Sources

Pilot exposes Prometheus metrics on `GET /metrics` (served by the gateway on the same port as the HTTP API, default `3100`). In production, configure `METRICS_AUTH_TOKEN` and scrape the gateway on the private Docker network with a bearer token. Caddy deliberately returns `404` for public `/metrics`.

Metrics prefix: `pilot_*`

Key metrics:

- `pilot_http_requests_total{method, route, status_code}`
- `pilot_http_request_duration_seconds{method, route, status_code}` (histogram)
- `pilot_http_errors_total{method, route, status_code}`
- `pilot_active_connections`
- `pilot_job_queue_depth{queue}`
- `pilot_active_sessions`
- `pilot_llm_tokens_total{direction, model}`
- Plus default Node.js metrics (event loop lag, memory, CPU)

## Dashboards

Three Grafana dashboards are provided in `grafana/dashboards/`:

- `api.json` — request rate, latency percentiles, error rate, by-route breakdown
- `orchestrator.json` — task throughput, LLM token spend, job queue depth
- `infrastructure.json` — DB pool saturation, event bus status, process memory/CPU

### Import

1. In Grafana, **Dashboards → New → Import**.
2. Upload the JSON file or paste its contents.
3. Select your Prometheus datasource when prompted.

## Alerts

`prometheus/alerts.yml` defines alert rules. Load via Prometheus config:

```yaml
# prometheus.yml
rule_files:
  - /etc/prometheus/alerts/pilot-alerts.yml
```

Wire Prometheus Alertmanager to your preferred channel (Slack, PagerDuty, Email).

## DigitalOcean scrape

For the Droplet deployment, scrape the gateway service on the Docker network from a colocated Prometheus container. Do not scrape the public Caddy endpoint; it is intentionally disabled.

## Self-hosted scrape

For docker-compose deployments, add Prometheus as a service:

```yaml
services:
  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./infra/monitoring/prometheus:/etc/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
    ports: ['9090:9090']
```

Where `prometheus.yml` includes:

```yaml
scrape_configs:
  - job_name: 'pilot'
    static_configs:
      - targets: ['pilot:3100']
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/secrets/pilot-metrics-token
```
