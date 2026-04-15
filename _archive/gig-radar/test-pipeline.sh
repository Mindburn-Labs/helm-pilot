#!/usr/bin/env bash
# End-to-end smoke test of the gig-radar pipeline.
# Runs the same fetch + dedup + score logic the SKILL.md tells the OpenClaw agent to run.
# No Telegram delivery — output goes to stdout.
#
# Usage: bash test-pipeline.sh

set -euo pipefail
TMP=$(mktemp -d)
echo "Working in $TMP"

UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36"

echo
echo "=== Phase 4.1 — Reddit r/forhire ==="
curl -s -A "$UA" "https://www.reddit.com/r/forhire/new.json?limit=100" \
| jq -c '
    .data.children[]
    | select(.data.title | test("^\\[[Hh][Ii][Rr][Ii][Nn][Gg]"))
    | {
        source: "reddit_forhire",
        post_id: .data.id,
        title: .data.title,
        body: ((.data.selftext // "")[0:2000]),
        url: ("https://reddit.com" + .data.permalink),
        posted_at: (.data.created_utc | todate),
        budget_text: ""
      }' > "$TMP/reddit.jsonl"
echo "  fetched: $(wc -l < "$TMP/reddit.jsonl") leads"

echo
echo "=== Phase 4.2 — HN monthly hiring thread ==="
LATEST_HN=$(curl -s "https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=10" \
  | jq -r '.hits[] | select(.title | test("Who is hiring")) | .objectID' | head -1)
echo "  latest thread: $LATEST_HN"
curl -s "https://hn.algolia.com/api/v1/items/$LATEST_HN" \
| jq -c --arg src "hn_whoishiring" '
    .children[]?
    | select(.text != null)
    | {
        source: $src,
        post_id: (.id | tostring),
        title: ((.text | gsub("<[^>]+>";"") | gsub("&#x27;";"\u0027") | gsub("&#x2F;";"/") | gsub("&amp;";"&"))[0:120]),
        body: ((.text | gsub("<[^>]+>";"") | gsub("&#x27;";"\u0027") | gsub("&#x2F;";"/") | gsub("&amp;";"&") | gsub("&gt;";">") | gsub("&lt;";"<") | gsub("<p>";"\n"))[0:2000]),
        url: ("https://news.ycombinator.com/item?id=" + (.id | tostring)),
        posted_at: (.created_at // ""),
        budget_text: ""
      }' > "$TMP/hn.jsonl"
echo "  fetched: $(wc -l < "$TMP/hn.jsonl") leads"

echo
echo "=== Phase 4.3 — Algora bounties ==="
curl -s "https://app.algora.io/api/trpc/bounty.list?input=%7B%22json%22%3A%7B%22status%22%3A%22active%22%2C%22limit%22%3A50%7D%7D" \
| jq -c '
    .[0].result.data.json.items[]?
    | select(.status == "open")
    | {
        source: "algora",
        post_id: .id,
        title: (.task.title // ""),
        body: ((.task.body // "")[0:2000]),
        url: (.task.url // ""),
        posted_at: (.created_at // ""),
        budget_text: ("$" + ((.reward.amount // 0) / 100 | floor | tostring) + " " + (.reward.currency // "USD"))
      }' > "$TMP/algora.jsonl"
echo "  fetched: $(wc -l < "$TMP/algora.jsonl") leads"

echo
echo "=== Phase 4.4 — GitHub bounty issues ==="
curl -s -H "Accept: application/vnd.github+json" \
  "https://api.github.com/search/issues?q=label:%22%F0%9F%92%B0+Bounty%22+is:open+sort:created-desc&per_page=20" \
| jq -c '
    .items[]?
    | {
        source: "github_bounty",
        post_id: (.id | tostring),
        title: .title,
        body: ((.body // "")[0:2000]),
        url: .html_url,
        posted_at: .created_at,
        budget_text: ((.title + " " + (.body // ""))
                      | capture("(?<m>\\$\\s*[0-9.,]+(k|K)?)";"i") // {m:""}
                      | .m)
      }' > "$TMP/github.jsonl"
echo "  fetched: $(wc -l < "$TMP/github.jsonl") leads"

echo
echo "=== Phase 5+6+7 — Combine, score against profile, sort ==="
cat "$TMP/reddit.jsonl" "$TMP/hn.jsonl" "$TMP/algora.jsonl" "$TMP/github.jsonl" > "$TMP/all.jsonl"
TOTAL=$(wc -l < "$TMP/all.jsonl")
echo "  combined: $TOTAL leads"

PROFILE_PATH="$(dirname "$0")/profile.yaml"
python3 - "$TMP/all.jsonl" "$PROFILE_PATH" <<'PY'
import json, sys, re
from datetime import datetime, timezone

leads_path, profile_path = sys.argv[1], sys.argv[2]

# tiny YAML parser for our flat profile (avoids external deps)
def load_profile(p):
    out = {'skills': [], 'red_skills': [], 'ai_friendly_buyers_only': True}
    cur = None
    with open(p) as f:
        for line in f:
            line = line.rstrip()
            if not line or line.startswith('#'): continue
            if line.startswith('  - '):
                if cur in ('skills','red_skills'):
                    out[cur].append(line[4:].strip().lower())
            elif ':' in line and not line.startswith(' '):
                k, _, v = line.partition(':')
                k = k.strip(); v = v.strip()
                if v == '':
                    cur = k
                else:
                    cur = None
                    if v.lower() in ('true','false'):
                        out[k] = v.lower() == 'true'
                    else:
                        out[k] = v
    return out

profile = load_profile(profile_path)
print(f"  profile loaded: {len(profile['skills'])} skills, {len(profile['red_skills'])} red_skills, ai_friendly={profile.get('ai_friendly_buyers_only')}")

GREEN = ['claude','cursor','copilot','gpt','ai-native','ai native','vibe coding','vibe-coding',
         'ship fast','scrappy','founding engineer','0 to 1','0-to-1','mvp',
         'indie','solo founder','small team','side project',
         '.ai','no-code','no code','low-code','low code',
         'n8n','zapier','make.com','bubble','webflow','framer']
RED = ['10+ years','10 years','principal','staff engineer','deep expertise',
       'no ai','no cursor','no copilot','human-written only','no llm',
       'enterprise','regulated','compliance-critical','soc2 audit',
       'phd','research scientist']

now = datetime.now(timezone.utc)

def score_lead(L, profile):
    text = (L.get('title','') + ' ' + L.get('body','') + ' ' + L.get('budget_text','')).lower()

    # Budget
    budget_pts = 5
    nums = re.findall(r'[\$€£]\s*([0-9][0-9.,]*)\s*(k|K)?(?:\s*[-–]\s*([0-9][0-9.,]*)\s*(k|K)?)?(?:\s*(?:per|/)\s*(hr|hour|h\b|month|wk|week))?', text)
    max_amt = 0
    is_hourly = False
    for m in nums:
        try:
            n = float(m[0].replace(',',''))
            if m[1].lower() == 'k': n *= 1000
            if m[2]:
                n2 = float(m[2].replace(',',''))
                if m[3].lower() == 'k': n2 *= 1000
                n = max(n, n2)
            if m[4] and m[4].lower() in ('hr','hour','h'):
                is_hourly = True
            max_amt = max(max_amt, n)
        except: pass
    if is_hourly:
        if max_amt >= 200: budget_pts = 40
        elif max_amt >= 100: budget_pts = 32
        elif max_amt >= 60: budget_pts = 25
        elif max_amt >= 30: budget_pts = 18
        elif max_amt >= 15: budget_pts = 8
        elif max_amt > 0: budget_pts = 0
    else:
        if max_amt >= 5000: budget_pts = 40
        elif max_amt >= 2000: budget_pts = 32
        elif max_amt >= 1000: budget_pts = 25
        elif max_amt >= 500: budget_pts = 18
        elif max_amt >= 100: budget_pts = 8
        elif max_amt > 0: budget_pts = 0
    # Algora budget_text override
    if L.get('source') == 'algora':
        m = re.search(r'\$([0-9]+)', L.get('budget_text','') or '')
        if m:
            n = float(m.group(1))
            if n >= 5000: budget_pts = 40
            elif n >= 2000: budget_pts = 32
            elif n >= 1000: budget_pts = 25
            elif n >= 500: budget_pts = 18
            elif n >= 100: budget_pts = 8
            elif n > 0: budget_pts = 0

    # Skill fit
    skill_pts = 0
    for s in profile['skills']:
        c = text.count(s)
        if c: skill_pts += min(3, c) * 5
    skill_pts = min(30, skill_pts)
    # Red skills hard penalty
    red_hit = False
    for r in profile['red_skills']:
        if r and r in text:
            red_hit = True; break

    # Recency
    rec_pts = 0
    try:
        ts = L.get('posted_at','')
        if ts:
            dt = datetime.fromisoformat(ts.replace('Z','+00:00'))
            if dt.tzinfo is None: dt = dt.replace(tzinfo=timezone.utc)
            age_h = (now - dt).total_seconds() / 3600
            if age_h < 6: rec_pts = 15
            elif age_h < 24: rec_pts = 10
            elif age_h < 72: rec_pts = 5
    except: pass

    # AI friendliness
    if profile.get('ai_friendly_buyers_only'):
        ai_pts = 0
        for g in GREEN:
            if g in text: ai_pts += 3
        for r in RED:
            if r in text: ai_pts -= 5
        ai_pts = max(-15, min(15, ai_pts))
    else:
        ai_pts = 7

    total = budget_pts + skill_pts + rec_pts + ai_pts
    if red_hit: total -= 50
    total = max(0, min(100, total))
    return {'total': total, 'budget': budget_pts, 'skill': skill_pts, 'recency': rec_pts, 'ai': ai_pts, 'red_hit': red_hit, 'parsed_amount': max_amt, 'is_hourly': is_hourly}

leads = []
with open(leads_path) as f:
    for line in f:
        line = line.strip()
        if not line: continue
        try:
            L = json.loads(line)
            s = score_lead(L, profile)
            leads.append({'lead': L, 'score': s})
        except Exception as e:
            print(f"  parse error: {e}", file=sys.stderr)

leads.sort(key=lambda x: -x['score']['total'])
print(f"\n  scored: {len(leads)} leads")
print(f"\n=== TOP 10 by score ===")
for i, x in enumerate(leads[:10], 1):
    L, s = x['lead'], x['score']
    title = L['title'][:75]
    print(f"\n{i:2d}. [{s['total']:3d}] {title}")
    print(f"     src={L['source']}  budget={L.get('budget_text','')!r:25}  amt={s['parsed_amount']:.0f}{'/h' if s['is_hourly'] else ''}")
    print(f"     score: B{s['budget']:2d} + S{s['skill']:2d} + R{s['recency']:2d} + AI{s['ai']:+d}{' RED-PENALTY-50' if s['red_hit'] else ''}")
    print(f"     {L['url']}")
PY

echo
echo "Done. Pipeline files in $TMP"
