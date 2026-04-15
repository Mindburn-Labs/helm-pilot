# HELM Pilot Runbook

On-call response procedures, diagnostic commands, and rollback playbooks for operators running HELM Pilot in production.

---

## 0. Start Here (Every Incident)

1. **Check `/health`** — `curl https://<your-domain>/health`. Anything non-200 is a hard incident.
2. **Check Sentry** — are there recent unhandled errors spiking?
3. **Check Grafana dashboards** — `api.json`, `orchestrator.json`, `infrastructure.json`.
4. **Check Fly.io status / recent deploys** — `fly status && fly releases`.
5. Declare severity and communicate on your internal channel.

---

## 1. Common Incidents

### 1A. Auth broken — users cannot log in

Symptoms: users report not receiving email magic link, or verify returns 401 despite correct code.

- Check `/health` → `checks.db` true?
- Check `EMAIL_PROVIDER` config — if it reverted to `noop`, codes aren't being sent.
  ```bash
  fly ssh console --app helm-pilot -C 'env | grep EMAIL'
  ```
- Check Resend/SMTP dashboard for bounces or rate limiting.
- Check the `sessions` table — are rows being written?
  ```sql
  SELECT COUNT(*), MAX(created_at) FROM sessions WHERE channel = 'email_pending';
  ```
- If Resend API is down: temporarily switch to a backup SMTP provider (`fly secrets set EMAIL_PROVIDER=smtp SMTP_HOST=...`) and redeploy.

### 1B. Database down

Symptoms: `/health` returns 503 with `checks.db: false`.

- Fly Postgres: `fly postgres connect -a <db-app>` → `\l` → check DB exists.
- Check DB logs: `fly logs -a <db-app> --since 10m`.
- Connection pool exhausted? Query `SELECT count(*) FROM pg_stat_activity`. If >80 increase `DB_POOL_MAX` or investigate slow queries.
- If the DB is truly down, failover: provision a replica via `fly postgres create`, restore latest backup with `scripts/backup.sh restore`, swap `DATABASE_URL` secret, redeploy.

### 1C. LLM provider outage

Symptoms: agent tasks fail with timeouts or 5xx from OpenRouter/Anthropic/OpenAI.

- Check provider status pages.
- Failover: the provider chain already falls through — ensure *all three* keys are set (`OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) so one outage doesn't kill you.
- Enable kill switch temporarily: set `policy.killSwitch=true` via a workspace-settings update. Tasks will be blocked rather than retry-storming.

### 1D. Rate-limiting users unexpectedly

Symptoms: users report 429 on normal usage.

- Check if Redis-backed limiter flipped to in-memory mode: `GET /metrics | grep redis`.
- If a single bad IP is hammering, upstream Cloudflare / Fly firewall is the right place to block (not app layer).
- Bump limits temporarily via code — update `services/gateway/src/index.ts` rate-limit configs and ship.

### 1E. Disk full / storage exhausted

- Check `fly volumes list` for data volume usage.
- Rotate old Pino logs (if writing to disk): `find /app/logs -mtime +7 -delete`.
- Clean old S3 backups via `scripts/backup.sh` retention (default 30 days).
- If `STORAGE_PROVIDER=local`, migrate to S3.

### 1F. Task stuck in 'running' status

Symptoms: a task shows status='running' for hours.

- Expected: the reaper job should move it to 'failed' after 10 minutes (`tasks.reap_stuck` scheduled every 5 min).
- If not happening, check pg-boss health: `SELECT * FROM pgboss.schedule WHERE name = 'tasks.reap_stuck'`.
- Manual reap: `UPDATE tasks SET status='failed' WHERE id='<uuid>' AND status='running'`.

---

## 2. Diagnostic Commands

### Health
```bash
curl https://<host>/health | jq          # full health JSON
curl https://<host>/metrics | head -50   # Prometheus metrics sample
```

### Logs (Fly.io)
```bash
fly logs -a helm-pilot --since 10m             # app logs, last 10 min
fly logs -a helm-pilot | grep ERROR            # errors only
fly logs -a helm-pilot | grep requestId=XXX    # one request's full trace
```

### Database (Fly Postgres)
```bash
fly postgres connect -a <db-app>

# Most active tables
SELECT schemaname, relname, n_live_tup
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC LIMIT 10;

# Pool saturation
SELECT count(*), state FROM pg_stat_activity GROUP BY state;

# Long-running queries
SELECT pid, now() - pg_stat_activity.query_start AS duration, query
FROM pg_stat_activity
WHERE state = 'active' AND now() - pg_stat_activity.query_start > interval '30 seconds';
```

### pg-boss queue
```sql
SELECT name, state, COUNT(*) FROM pgboss.job GROUP BY name, state;
SELECT * FROM pgboss.archive ORDER BY completed_on DESC LIMIT 20;  -- recently completed
```

---

## 3. Rollback Procedure

### 3A. Application rollback

1. Find the last known-good release:
   ```bash
   fly releases -a helm-pilot | head -20
   ```
2. Roll back:
   ```bash
   fly deploy -a helm-pilot --image <previous-image-tag>
   ```
3. Watch health:
   ```bash
   while true; do curl -s https://<host>/health | jq -c; sleep 2; done
   ```

### 3B. Database rollback (destructive — last resort)

1. Stop the gateway: `fly scale count 0 -a helm-pilot`.
2. Take a snapshot of current DB state.
3. Restore from last known-good backup:
   ```bash
   bash scripts/backup.sh restore <backup-file.sql.gz>
   ```
4. Start gateway: `fly scale count 1 -a helm-pilot`.
5. **Warning:** connector tokens encrypted with a since-rotated ENCRYPTION_KEY will be unreadable. Plan carefully.

### 3C. Migration rollback

Drizzle migrations are forward-only by default. To roll a migration back:

1. Write a reverse migration SQL file manually (e.g., `0005_revert_xyz.sql` that drops the column added in `0004`).
2. Apply it normally via `npm run db:push`.
3. Redeploy the app pinned to the pre-`0004` schema version.

---

## 4. Escalation

- **SEV-1 (data loss, security breach):** Wake the on-call immediately. Preserve state (snapshots, logs) before attempting fixes.
- **SEV-2 (service down for all users):** Respond within 15 min. Start incident channel.
- **SEV-3 (degraded, subset of users):** Respond within 1h. File ticket, fix during business hours.

---

## 5. Post-Incident Review Template

```
# Incident YYYY-MM-DD — <one-line summary>

## Timeline
- HH:MM UTC — Detected (how?)
- HH:MM UTC — First responder on call
- HH:MM UTC — Mitigated (what was done?)
- HH:MM UTC — Fully resolved

## Impact
- Users affected: <count> / <total>
- Features affected: <list>
- Data loss: <yes/no + scope>

## Root Cause
<what actually caused it>

## Contributing Factors
<what made it worse or prevented faster recovery>

## Action Items
- [ ] <fix root cause permanently>
- [ ] <detect earlier next time>
- [ ] <respond faster next time>
- [ ] <prevent this class of issue>

## Lessons Learned
<what we knew vs. didn't know; what we'd do differently>
```
