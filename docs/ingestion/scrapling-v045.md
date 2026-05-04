# Scrapling 0.4.5 Ingestion Upgrade

Status: implemented behind the existing Pilot ingestion boundary.

Linear: MIN-254, MIN-245

## Source Check

- Scrapling 0.4.x adds the MCP server and anti-bot/Turnstile-oriented fetch surface used by the Pilot bridge.
- Scrapling 0.4.5 changes redirect handling so safe redirects reject loopback, private, and link-local targets by default.
- 0.4.5 also adds spider development mode. Pilot exposes it only through explicit development flags and disables the env override in production.

Primary sources:

- https://github.com/D4Vinci/Scrapling/releases/tag/v0.4.0
- https://github.com/D4Vinci/Scrapling/releases/tag/v0.4.5
- https://scrapling.readthedocs.io/en/latest/ai/mcp-server.html

## Repository Changes

- `pipelines/requirements.txt` pins `scrapling[ai]==0.4.5`.
- `pipelines/scraper/lib/scrapling_adapter.py` centralizes `follow_redirects="safe"` for fetcher, dynamic, and stealthy paths.
- `pipelines/scraper/run_fetch.py` reports safe redirect mode and accepts `--development-mode`.
- `pipelines/yc-scraper/scrape_startup_school.py` can use development mode for spider iteration outside production.
- `services/orchestrator/src/tools.ts` validates `scrapling_fetch` with a Zod schema before the Python bridge runs.

## MCP Boundary

Scrapling MCP exposure must use the existing MCP registry path:

1. Configure Scrapling in `packs/mcp/servers.json` or `MCP_SERVERS_CONFIG_PATH`.
2. Let `McpServerRegistry` instantiate the server.
3. Let `ToolRegistry.registerMcpTools("scrapling", client)` create namespaced tools such as `mcp.scrapling.fetch`.
4. Let `AgentLoop.evaluateToolGovernance()` evaluate every `mcp.scrapling.*` call through `packages/helm-client` before execution.

Do not call the Scrapling MCP server directly from services or Telegram handlers.

## Validation

Dry-run examples:

```bash
PYTHONPATH=pipelines python pipelines/scraper/run_fetch.py \
  --url https://www.ycombinator.com/companies \
  --strategy fetcher \
  --selector title \
  --limit 1

PYTHONPATH=pipelines python pipelines/yc-scraper/scrape_startup_school.py \
  --limit 2 \
  --dry-run \
  --development-mode
```

Live YC validation should be run with a short `--limit` first, then a scheduled crawl after the Python runtime is rebuilt with `scripts/install-python-runtime.sh`.
