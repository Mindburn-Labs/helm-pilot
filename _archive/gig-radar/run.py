#!/usr/bin/env python3
"""
gig-radar — standalone runner.

Runs the full pipeline: fetch → sanitize → prefilter → shortlist → LLM score + draft → Telegram send → persist.

Environment variables:
  OPENROUTER_API_KEY   required for LLM scoring (free tier works)
  TELEGRAM_BOT_TOKEN   required for real delivery (empty → dry-run to stdout)
  TELEGRAM_CHAT_ID     your personal chat or channel id
  GIG_RADAR_MODEL      optional, default openai/gpt-oss-120b (free on OpenRouter)
  GIG_RADAR_STATE_DIR  optional, default ~/.gig-radar

CLI flags:
  --limit N          max leads to process (default 5)
  --shortlist N      how many top candidates to pass to the LLM (default 15)
  --min-score N      skip leads below this LLM-assigned score (default 70)
  --dry-run          print Telegram messages to stdout, don't actually send
  --cron             cron-friendly: silent unless leads were sent
  --prefilter-only   stop after prefilter, print stats
  --skip-llm         skip LLM scoring (uses shortlist score as proxy)
"""
import argparse, json, os, subprocess, sys, time
from pathlib import Path
from datetime import datetime, timezone, timedelta

# Make lib importable
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from lib.sanitize import sanitize_lead
from lib.prefilter import prefilter
from lib.shortlist import shortlist_score
from lib.llm_score_draft import score_and_draft
from lib.telegram_send import send_leads


def _load_profile_yaml(path: Path) -> dict:
    """Tiny YAML loader for the flat profile schema (no external dep)."""
    out: dict = {"skills": [], "red_skills": [], "personal_blockers": [], "arbitrage_categories": [], "deliverables": []}
    cur = None
    with open(path) as f:
        for line in f:
            line = line.rstrip()
            if not line or line.lstrip().startswith("#"):
                continue
            if line.startswith("  - "):
                if cur in out and isinstance(out[cur], list):
                    out[cur].append(line[4:].strip().strip('"').strip("'").lower())
            elif ":" in line and not line.startswith(" "):
                k, _, v = line.partition(":")
                k = k.strip()
                v = v.strip()
                if v == "" or v == "|":
                    cur = k
                    if cur not in out:
                        out[cur] = []
                else:
                    cur = None
                    if v.lower() in ("true", "false"):
                        out[k] = v.lower() == "true"
                    else:
                        out[k] = v.strip('"').strip("'")
    return out


def log(msg, cron=False):
    if not cron:
        print(msg, file=sys.stderr)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--shortlist", type=int, default=15)
    parser.add_argument("--min-score", type=int, default=45)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--cron", action="store_true")
    parser.add_argument("--prefilter-only", action="store_true")
    parser.add_argument("--skip-llm", action="store_true")
    parser.add_argument("--dump-shortlist", action="store_true", help="print shortlist contents + scores")
    args = parser.parse_args()

    t0 = time.time()

    # ----- STATE -----
    state_dir = Path(os.environ.get("GIG_RADAR_STATE_DIR", str(Path.home() / ".gig-radar")))
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "logs").mkdir(exist_ok=True)
    seen_path = state_dir / "seen.json"
    if not seen_path.exists():
        seen_path.write_text("{}")
    seen = json.loads(seen_path.read_text() or "{}")

    openrouter_key = os.environ.get("OPENROUTER_API_KEY", "")
    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "")

    # ----- FETCH -----
    log("[1] Fetching sources...", args.cron)
    fetch_script = HERE / "fetchers" / "fetch_all.sh"
    try:
        result = subprocess.run(
            ["bash", str(fetch_script)],
            capture_output=True,
            text=True,
            timeout=180,
        )
    except subprocess.TimeoutExpired:
        log("[fetch] TIMEOUT", args.cron)
        return 1
    raw_lines = [line for line in result.stdout.splitlines() if line.strip()]
    log(f"  fetched {len(raw_lines)} raw leads", args.cron)
    if not args.cron:
        # Pass through fetcher logs
        for line in result.stderr.splitlines():
            print(line, file=sys.stderr)

    # ----- SANITIZE -----
    leads = []
    dropped_quarantine = 0
    for line in raw_lines:
        try:
            L = json.loads(line)
        except Exception:
            continue
        sanitize_lead(L)
        if L.get('_quarantined'):
            dropped_quarantine += 1
            continue
        leads.append(L)
    log(f"[2] Sanitized — {len(leads)} leads kept, {dropped_quarantine} quarantined", args.cron)

    # ----- DEDUPE -----
    fresh = []
    deduped = 0
    for L in leads:
        key = f"{L.get('source')}:{L.get('post_id')}"
        if key in seen:
            deduped += 1
            continue
        fresh.append(L)
    log(f"[3] Dedupe — {len(fresh)} unseen ({deduped} skipped)", args.cron)

    # ----- PREFILTER -----
    kept = []
    drop_reasons = {}
    for L in fresh:
        ok, reason = prefilter(L)
        if ok:
            kept.append(L)
        else:
            drop_reasons[reason] = drop_reasons.get(reason, 0) + 1
    log(f"[4] Prefilter — kept {len(kept)}, dropped {sum(drop_reasons.values())}: {drop_reasons}", args.cron)

    if args.prefilter_only:
        for L in kept:
            print(json.dumps(L, ensure_ascii=False))
        return 0

    # ----- SHORTLIST (cheap heuristic) OR RERANK (Pro tier) -----
    rerank_enabled = os.environ.get("GIG_RADAR_RERANK") == "1"
    if rerank_enabled and openrouter_key:
        try:
            # Lazy import so users without rerank can still run the script
            from lib.rerank import rerank_leads
            # Load profile.yaml for the rerank query
            profile_path = state_dir / "profile.yaml" if (state_dir / "profile.yaml").exists() else HERE / "profile.yaml"
            profile_dict = _load_profile_yaml(profile_path) if profile_path.exists() else {}
            shortlisted = rerank_leads(kept, profile_dict, top_n=args.shortlist)
            for i, L in enumerate(shortlisted):
                L['_shortlist_score'] = round((L.get('_rerank_score') or 0) * 100, 1)
            log(f"[5] Rerank (Cohere Pro) — top {len(shortlisted)} by semantic relevance", args.cron)
        except Exception as e:
            log(f"[5] Rerank failed ({e}) — falling back to heuristic shortlist", args.cron)
            for L in kept:
                L['_shortlist_score'] = shortlist_score(L)
            kept.sort(key=lambda x: -x['_shortlist_score'])
            shortlisted = kept[: args.shortlist]
    else:
        for L in kept:
            L['_shortlist_score'] = shortlist_score(L)
        kept.sort(key=lambda x: -x['_shortlist_score'])
        shortlisted = kept[: args.shortlist]
        log(f"[5] Shortlist — top {len(shortlisted)} by cheap heuristic (set GIG_RADAR_RERANK=1 for Pro semantic ranking)", args.cron)

    if args.dump_shortlist:
        for L in shortlisted:
            print(f"  [{L['_shortlist_score']:5.1f}] {L.get('source'):25} {L.get('title','')[:70]}")
            print(f"          {L.get('url')}")
        return 0

    # ----- LLM SCORE + DRAFT -----
    if args.skip_llm or not openrouter_key:
        log("[6] Skipping LLM scoring — using shortlist proxy scores", args.cron)
        for L in shortlisted:
            L['llm'] = {
                'score': round(L['_shortlist_score']),
                'employment_shape': 'unclear',
                'real_budget_usd': None,
                'budget_kind': 'unclear',
                'skill_fit': 'unclear',
                'ai_friendly_buyer': 'unclear',
                'closeability': 'unclear',
                'concerns': 'LLM scoring skipped',
                'fit_reasoning': f'Shortlist proxy score {L["_shortlist_score"]}',
                'would_pitch': True,
                'injection_suspected': False,
            }
            L['draft'] = '(LLM drafting skipped — set OPENROUTER_API_KEY to get drafts)'
    else:
        shortlisted = score_and_draft(shortlisted, openrouter_key)

    # ----- FILTER BY LLM SCORE + would_pitch -----
    pitch_ready = [
        L for L in shortlisted
        if L.get('llm', {}).get('would_pitch') and (L.get('llm', {}).get('score') or 0) >= args.min_score
    ]
    pitch_ready.sort(key=lambda x: -(x.get('llm', {}).get('score') or 0))
    top = pitch_ready[: args.limit]
    log(f"[7] LLM pass — {len(pitch_ready)} pitch-ready (≥{args.min_score}), sending top {len(top)}", args.cron)

    if not top:
        if not args.cron:
            log("  no leads met the bar this run", args.cron)
        return 0

    # ----- WRITE TO MINI APP INBOX (leads.jsonl) -----
    # The Mini App reads pending leads from $STATE_DIR/leads.jsonl. Append each new
    # top-ranked lead there with status=pending so the inbox populates regardless
    # of whether Telegram delivery succeeds.
    leads_file = state_dir / "leads.jsonl"
    now_iso_write = datetime.now(timezone.utc).isoformat()
    try:
        with leads_file.open("a") as f:
            for L in top:
                entry = {
                    "id": f"{L.get('source')}:{L.get('post_id')}",
                    "source": L.get("source"),
                    "post_id": L.get("post_id"),
                    "title": L.get("title", ""),
                    "body": L.get("body", ""),
                    "url": L.get("url", ""),
                    "posted_at": L.get("posted_at", ""),
                    "budget_text": L.get("budget_text", ""),
                    "llm": L.get("llm", {}),
                    "draft": L.get("draft", ""),
                    "status": "pending",
                    "discovered_at": now_iso_write,
                }
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        log(f"[7.5] Wrote {len(top)} leads to Mini App inbox ({leads_file})", args.cron)
    except Exception as e:
        log(f"[7.5] Failed to write leads.jsonl: {e}", args.cron)

    # ----- SEND -----
    sent = send_leads(top, bot_token, chat_id, dry_run=args.dry_run)
    log(f"[8] Delivered {sent} leads to Telegram", args.cron)

    # ----- PERSIST SEEN -----
    now_iso = datetime.now(timezone.utc).isoformat()
    for L in top:
        key = f"{L.get('source')}:{L.get('post_id')}"
        seen[key] = {
            'sent_at': now_iso,
            'score': L.get('llm', {}).get('score'),
            'url': L.get('url'),
        }
    # Evict older than 30 days
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    seen = {
        k: v for k, v in seen.items()
        if datetime.fromisoformat(v['sent_at'].replace('Z', '+00:00')) > cutoff
    }
    seen_path.write_text(json.dumps(seen, indent=2))
    log(f"[9] Seen cache: {len(seen)} entries", args.cron)

    # ----- REPORT -----
    duration = round(time.time() - t0, 1)
    if args.cron:
        if sent > 0:
            top_score = max((L.get('llm', {}).get('score') or 0) for L in top)
            print(f"gig-radar: sent {sent} leads (top score {top_score}/100, {duration}s)")
    else:
        log(f"\n=== DONE in {duration}s ===", args.cron)
        log(f"  Raw fetched:     {len(raw_lines)}", args.cron)
        log(f"  Quarantined:     {dropped_quarantine}", args.cron)
        log(f"  Deduped:         {deduped}", args.cron)
        log(f"  Prefiltered out: {sum(drop_reasons.values())}", args.cron)
        log(f"  Shortlisted:     {len(shortlisted)}", args.cron)
        log(f"  Pitch-ready:     {len(pitch_ready)}", args.cron)
        log(f"  Sent:            {sent}", args.cron)

    return 0


if __name__ == "__main__":
    sys.exit(main())
