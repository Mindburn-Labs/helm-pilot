#!/usr/bin/env bash
# Run all enabled fetchers and emit combined JSONL on stdout.
# Each line is a normalized lead { source, post_id, title, body, url, posted_at, budget_text }.
# Failures on individual sources are logged to stderr but do not abort the run.

set -uo pipefail

UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36"
DATE_14D=$(date -u -v-14d +%Y-%m-%d 2>/dev/null || date -u -d '14 days ago' +%Y-%m-%d)

log() { echo "[fetch_all] $*" >&2; }

fetch_reddit_subreddit() {
  local sub="$1" source_id="$2" regex="$3"
  log "fetching $source_id..."
  local data
  data=$(curl -s --max-time 15 -A "$UA" "https://www.reddit.com/r/$sub/new.json?limit=100") || { log "  $source_id: curl failed"; return; }
  echo "$data" | jq -c --arg src "$source_id" --arg re "$regex" '
    .data.children[]?
    | select(.data.title | test($re))
    | {
        source: $src,
        post_id: .data.id,
        title: .data.title,
        body: ((.data.selftext // "")[0:2000]),
        url: ("https://reddit.com" + .data.permalink),
        posted_at: (.data.created_utc | todate),
        budget_text: ""
      }
  ' 2>/dev/null || log "  $source_id: jq failed"
}

fetch_sideproject_help() {
  log "fetching reddit_sideproject_help..."
  curl -s --max-time 15 -A "$UA" "https://www.reddit.com/r/SideProject/new.json?limit=100" \
  | jq -c '
      .data.children[]?
      | select(
          ((.data.title + " " + (.data.selftext // "")) | ascii_downcase)
          | test("(will pay|i\u2019ll pay|i'\''ll pay|happy to pay|paying (a )?(developer|designer|builder|freelancer|someone)|need (a )?(developer|designer|builder|freelancer) (to|for)|hiring (a )?(developer|designer|builder|freelancer)|looking to hire|\\$[0-9]+ (budget|fixed|for))")
        )
      | {
          source: "reddit_sideproject_help",
          post_id: .data.id,
          title: .data.title,
          body: ((.data.selftext // "")[0:2000]),
          url: ("https://reddit.com" + .data.permalink),
          posted_at: (.data.created_utc | todate),
          budget_text: ""
        }
    ' 2>/dev/null || log "  reddit_sideproject_help: jq failed"
}

fetch_hn_thread() {
  local title_match="$1" source_id="$2"
  log "fetching $source_id..."
  local latest
  latest=$(curl -s --max-time 10 "https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=20" \
           | jq -r --arg m "$title_match" '.hits[] | select(.title | test($m)) | .objectID' | head -1)
  if [ -z "$latest" ]; then log "  $source_id: no latest thread found"; return; fi
  log "  latest $source_id thread: $latest"
  curl -s --max-time 15 "https://hn.algolia.com/api/v1/items/$latest" \
  | jq -c --arg src "$source_id" '
      .children[]?
      | select(.text != null)
      | {
          source: $src,
          post_id: (.id | tostring),
          title: ((.text | gsub("<[^>]+>";"") | gsub("&#x27;";"\u0027") | gsub("&#x2F;";"/") | gsub("&amp;";"&"))[0:140]),
          body: ((.text | gsub("<[^>]+>";"") | gsub("&#x27;";"\u0027") | gsub("&#x2F;";"/") | gsub("&amp;";"&") | gsub("&gt;";">") | gsub("&lt;";"<") | gsub("<p>";"\n"))[0:2000]),
          url: ("https://news.ycombinator.com/item?id=" + (.id | tostring)),
          posted_at: (.created_at // ""),
          budget_text: ""
        }
    ' 2>/dev/null || log "  $source_id: jq failed"
}

fetch_algora() {
  log "fetching algora_bounties..."
  curl -s --max-time 15 "https://app.algora.io/api/trpc/bounty.list?input=%7B%22json%22%3A%7B%22status%22%3A%22active%22%2C%22limit%22%3A50%7D%7D" \
  | jq -c '
      .[0].result.data.json.items[]?
      | select(.status == "open")
      | {
          source: "algora_bounties",
          post_id: .id,
          title: (.task.title // ""),
          body: ((.task.body // "")[0:2000]),
          url: (.task.url // ""),
          posted_at: (.created_at // ""),
          budget_text: ("$" + ((.reward.amount // 0) / 100 | floor | tostring) + " " + (.reward.currency // "USD"))
        }
    ' 2>/dev/null || log "  algora: jq failed"
}

fetch_github_bounty() {
  local source_id="$1" query="$2"
  log "fetching $source_id..."
  local headers=(-H "Accept: application/vnd.github+json")
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    headers+=(-H "Authorization: Bearer $GITHUB_TOKEN")
  fi
  curl -s --max-time 15 "${headers[@]}" "https://api.github.com/search/issues?q=${query}+created:%3E${DATE_14D}&sort=created&order=desc&per_page=30" \
  | jq -c --arg src "$source_id" '
      .items[]?
      | select(.repository_url | test("1712n/dn-institute") | not)
      | {
          source: $src,
          post_id: (.id | tostring),
          title: .title,
          body: ((.body // "")[0:2000]),
          url: .html_url,
          posted_at: .created_at,
          budget_text: ((.title + " " + (.body // ""))
                        | capture("(?<m>\\$\\s*[0-9.,]+(k|K)?)";"i") // {m:""}
                        | .m)
        }
    ' 2>/dev/null || log "  $source_id: jq failed"
}

# Reddit fetcher with a body+title keyword filter (instead of title-prefix only).
# Used for noisier subs (r/Entrepreneur, r/startups) where most posts are NOT gigs.
fetch_reddit_keyword() {
  local sub="$1" source_id="$2"
  log "fetching $source_id..."
  curl -s --max-time 15 -A "$UA" "https://www.reddit.com/r/$sub/new.json?limit=100" \
  | jq -c --arg src "$source_id" '
      .data.children[]?
      | select(
          ((.data.title + " " + (.data.selftext // "")) | ascii_downcase)
          | test("(will pay|i\u2019ll pay|i'\''ll pay|happy to pay|paying (a )?(developer|designer|builder|freelancer|someone)|need (a )?(developer|designer|builder|freelancer|coder) (to|for)|hiring (a )?(developer|designer|builder|freelancer|coder)|looking to hire|looking for (a )?(developer|designer|builder|freelancer|coder)|\\$[0-9]+ (budget|fixed|for|/hr))")
        )
      | {
          source: $src,
          post_id: .data.id,
          title: .data.title,
          body: ((.data.selftext // "")[0:2000]),
          url: ("https://reddit.com" + .data.permalink),
          posted_at: (.data.created_utc | todate),
          budget_text: ""
        }
    ' 2>/dev/null || log "  $source_id: jq failed"
}

# Generic RSS fetcher — converts RSS XML to normalized leads via xmllint + jq pipeline.
# Used for We Work Remotely. Filters by `type` (Contract, etc.) where applicable.
fetch_rss_weworkremotely() {
  log "fetching weworkremotely_rss..."
  curl -s --max-time 15 -A "$UA" "https://weworkremotely.com/remote-jobs.rss" -o /tmp/wwr.xml || { log "  weworkremotely: curl failed"; return; }
  if ! command -v xmllint >/dev/null 2>&1; then
    log "  weworkremotely: xmllint not installed, skipping (install with: brew install libxml2)"
    return
  fi
  # Extract items via xmllint XPath, convert to JSONL via python
  python3 - "/tmp/wwr.xml" <<'PY' 2>/dev/null || log "  weworkremotely: parse failed"
import sys, json, re, html
import xml.etree.ElementTree as ET
try:
    tree = ET.parse(sys.argv[1])
    root = tree.getroot()
    for item in root.findall('.//item'):
        title = (item.findtext('title') or '').strip()
        link = (item.findtext('link') or '').strip()
        desc = (item.findtext('description') or '').strip()
        pub = (item.findtext('pubDate') or '').strip()
        # WWR description has HTML; strip tags
        clean_desc = re.sub(r'<[^>]+>', '', html.unescape(desc))[:2000]
        # Extract WWR job type if present in description
        is_contract = bool(re.search(r'\b(contract|freelance|part[- ]time)\b', title + ' ' + clean_desc, re.I))
        # Skip pure full-time roles
        if 'full-time' in (title + ' ' + clean_desc[:500]).lower() and not is_contract:
            continue
        post_id = link.rsplit('/', 1)[-1] or title[:40]
        print(json.dumps({
            "source": "weworkremotely_rss",
            "post_id": post_id,
            "title": title,
            "body": clean_desc,
            "url": link,
            "posted_at": pub,
            "budget_text": ""
        }, ensure_ascii=False))
except Exception as e:
    print(f"WWR parse error: {e}", file=sys.stderr)
PY
}

# Discourse forum fetcher (used for n8n community).
fetch_discourse_latest() {
  local base="$1" source_id="$2"
  log "fetching $source_id..."
  curl -s --max-time 15 -A "$UA" "${base}/latest.json" \
  | jq -c --arg src "$source_id" --arg base "$base" '
      .topic_list.topics[]?
      | select((.title | ascii_downcase) | test("(help|build|developer|freelance|paid|hire|need someone|looking for)"))
      | {
          source: $src,
          post_id: (.id | tostring),
          title: .title,
          body: (.excerpt // ""),
          url: ($base + "/t/" + (.slug // "topic") + "/" + (.id | tostring)),
          posted_at: (.created_at // .last_posted_at // ""),
          budget_text: ""
        }
    ' 2>/dev/null || log "  $source_id: jq failed"
}

# Lobsters jobs tag — JSON endpoint at /t/<tag>.json
fetch_lobsters_jobs() {
  log "fetching lobsters_jobs..."
  curl -s --max-time 15 -A "$UA" "https://lobste.rs/t/jobs.json" \
  | jq -c '
      .[]?
      | {
          source: "lobsters_jobs",
          post_id: (.short_id // .url),
          title: .title,
          body: ((.description // "")[0:2000]),
          url: (.url // .short_id_url),
          posted_at: (.created_at // ""),
          budget_text: ""
        }
    ' 2>/dev/null || log "  lobsters_jobs: jq failed"
}

# Layer3 bounties — Web3 community
fetch_layer3() {
  log "fetching layer3_bounties..."
  curl -s --max-time 15 -A "$UA" "https://api.layer3.xyz/bounties" \
  | jq -c '
      (.bounties // .data // .)[]?
      | {
          source: "layer3_bounties",
          post_id: (.id // .slug | tostring),
          title: (.title // .name // ""),
          body: ((.description // "")[0:2000]),
          url: ("https://layer3.xyz/bounties/" + (.slug // .id | tostring)),
          posted_at: (.created_at // .createdAt // ""),
          budget_text: (("$" + ((.reward // .prize // 0) | tostring)) // "")
        }
    ' 2>/dev/null || log "  layer3_bounties: jq failed (endpoint may need probing)"
}

# Gmail saved-search alerts via himalaya — fetches email-as-leads from the "gig-radar" label
fetch_gmail_alerts() {
  log "fetching gmail_alerts..."
  if ! command -v himalaya >/dev/null 2>&1; then
    log "  gmail_alerts: himalaya not installed, skipping"
    return
  fi
  if [ -z "${GMAIL_APP_PASSWORD:-}" ]; then
    log "  gmail_alerts: GMAIL_APP_PASSWORD not set, skipping"
    return
  fi
  # List recent envelopes from the gig-radar label/folder, output as JSON
  himalaya envelope list --account gmail --folder "gig-radar" --output json 2>/dev/null \
  | jq -c '
      .[]?
      | {
          source: "gmail_alerts",
          post_id: (.id | tostring),
          title: (.subject // ""),
          body: ((.from[0].name // "") + " <" + (.from[0].address // "") + ">: " + (.subject // "")),
          url: ("mailto:" + (.from[0].address // "")),
          posted_at: (.date // ""),
          budget_text: ""
        }
    ' 2>/dev/null || log "  gmail_alerts: no messages or jq failed"
}

# Classifieds via stdlib HTML parser — for sites without Cloudflare
fetch_classifieds_html() {
  log "fetching classifieds_html..."
  local script_dir
  script_dir="$(dirname "$(realpath "$0")")"
  local lib_dir="$script_dir/../lib"
  if [ ! -f "$lib_dir/classifieds.py" ]; then
    log "  classifieds_html: lib/classifieds.py missing, skipping"
    return
  fi
  python3 "$lib_dir/classifieds.py" 2>/dev/null || log "  classifieds_html: parser failed"
}

# Vibe coder job boards — curated AI-assisted shipper roles (2026 category)
fetch_vibecodecareers() {
  log "fetching vibecodecareers..."
  # Scrape the listings index page. Simple <a href="/jobs/..."> extraction.
  local html
  html=$(curl -s --max-time 15 -A "$UA" "https://vibecodecareers.com/jobs" 2>/dev/null) || { log "  vibecodecareers: curl failed"; return; }
  printf '%s\n' "$html" \
  | python3 -c '
import sys, re, json, html as H, hashlib, time
raw = sys.stdin.read()
seen = set()
# Match anchor tags linking to job/listing pages
pat = re.compile(r"<a[^>]+href=\"(/jobs/[^\"]+|https://vibecodecareers\.com/jobs/[^\"]+)\"[^>]*>(.*?)</a>", re.DOTALL|re.IGNORECASE)
for m in pat.finditer(raw):
    href, inner = m.group(1), m.group(2)
    title = re.sub(r"<[^>]+>", " ", inner)
    title = H.unescape(re.sub(r"\s+", " ", title)).strip()
    if len(title) < 8: continue
    url = href if href.startswith("http") else f"https://vibecodecareers.com{href}"
    if url in seen: continue
    seen.add(url)
    pid = hashlib.sha1(url.encode()).hexdigest()[:16]
    rec = {
        "source": "vibecodecareers",
        "post_id": pid,
        "title": title[:300],
        "body": title[:300],
        "url": url,
        "posted_at": "",
        "budget_text": ""
    }
    print(json.dumps(rec, ensure_ascii=False))
' 2>/dev/null || log "  vibecodecareers: parse failed"
}

fetch_vibehackers() {
  log "fetching vibehackers..."
  local html
  html=$(curl -s --max-time 15 -A "$UA" "https://vibehackers.io/jobs" 2>/dev/null) || { log "  vibehackers: curl failed"; return; }
  printf '%s\n' "$html" \
  | python3 -c '
import sys, re, json, html as H, hashlib
raw = sys.stdin.read()
seen = set()
pat = re.compile(r"<a[^>]+href=\"(/jobs/[^\"]+|https://vibehackers\.io/jobs/[^\"]+)\"[^>]*>(.*?)</a>", re.DOTALL|re.IGNORECASE)
for m in pat.finditer(raw):
    href, inner = m.group(1), m.group(2)
    title = re.sub(r"<[^>]+>", " ", inner)
    title = H.unescape(re.sub(r"\s+", " ", title)).strip()
    if len(title) < 8: continue
    url = href if href.startswith("http") else f"https://vibehackers.io{href}"
    if url in seen: continue
    seen.add(url)
    pid = hashlib.sha1(url.encode()).hexdigest()[:16]
    rec = {
        "source": "vibehackers",
        "post_id": pid,
        "title": title[:300],
        "body": title[:300],
        "url": url,
        "posted_at": "",
        "budget_text": ""
    }
    print(json.dumps(rec, ensure_ascii=False))
' 2>/dev/null || log "  vibehackers: parse failed"
}

# Classifieds via Playwright — for Cloudflare-protected sites
fetch_classifieds_browser() {
  log "fetching classifieds_browser..."
  local script_dir
  script_dir="$(dirname "$(realpath "$0")")"
  local lib_dir="$script_dir/../lib"
  if [ ! -f "$lib_dir/browser_fetch.py" ]; then
    log "  classifieds_browser: lib/browser_fetch.py missing, skipping"
    return
  fi
  python3 "$lib_dir/browser_fetch.py" 2>/dev/null || log "  classifieds_browser: failed (Playwright not installed?)"
}

# OnlyDust — Web3 GitHub bounties
fetch_onlydust() {
  log "fetching onlydust_bounties..."
  curl -s --max-time 15 -A "$UA" "https://api.onlydust.com/api/v1/projects?perPage=30&sortBy=RANK" \
  | jq -c '
      (.projects // .data // .)[]?
      | select((.totalGranted // .budget // 0) > 0)
      | {
          source: "onlydust_bounties",
          post_id: (.id | tostring),
          title: (.name // .title // ""),
          body: ((.shortDescription // .description // "")[0:2000]),
          url: ("https://app.onlydust.com/projects/" + (.slug // (.id | tostring))),
          posted_at: (.createdAt // ""),
          budget_text: (("$" + ((.totalGranted // .budget // 0) | tostring)) // "")
        }
    ' 2>/dev/null || log "  onlydust_bounties: jq failed (endpoint may need probing)"
}

# Run all fetchers. Each echoes its jsonl to stdout; everything is combined.
{
  # === Existing 9 sources ===
  fetch_reddit_subreddit "forhire" "reddit_forhire" "^\\[[Hh][Ii][Rr][Ii][Nn][Gg]"
  fetch_reddit_subreddit "jobbit" "reddit_jobbit" "^\\[[Hh][Ii][Rr][Ii][Nn][Gg]"
  fetch_reddit_subreddit "slavelabour" "reddit_slavelabour" "^\\[[Tt][Aa][Ss][Kk]\\]"
  fetch_sideproject_help
  fetch_hn_thread "Who is hiring" "hn_whoishiring"
  fetch_hn_thread "Freelancer" "hn_freelancer"
  fetch_algora
  fetch_github_bounty "github_bounty_label" "label:%22%F0%9F%92%B0+Bounty%22+is:open+is:issue"
  fetch_github_bounty "github_bounty_title" "%22%24%22+in:title+is:issue+is:open"

  # === Phase 4.4 — 6 working new sources ===
  fetch_reddit_subreddit "hireaprogrammer" "reddit_hireaprogrammer" "^\\[[Hh][Ii][Rr][Ii][Nn][Gg]"
  fetch_rss_weworkremotely
  fetch_discourse_latest "https://community.n8n.io" "n8n_community"
  fetch_reddit_keyword "Entrepreneur" "reddit_entrepreneur"
  fetch_reddit_keyword "startups" "reddit_startups"
  fetch_github_bounty "github_first_issue_bounty" "label:bounty+label:%22good+first+issue%22+is:open+is:issue"
  # DISABLED — endpoint dead or actively anti-AI-scraping:
  #   fetch_lobsters_jobs    (lobste.rs returns HTML with ANTHROPIC_MAGIC_STRING_TRIGGER_REFUSAL — quarantined)
  #   fetch_layer3           (api.layer3.xyz returns empty)
  #   fetch_onlydust         (api.onlydust.com cloudflare 1016 — DNS dead)

  # === Phase 5.4 — National subreddits (multi-language, keyword-filtered) ===
  fetch_reddit_keyword "de" "reddit_de"
  fetch_reddit_keyword "france" "reddit_france"
  fetch_reddit_keyword "spain" "reddit_spain"
  fetch_reddit_keyword "italy" "reddit_italy"
  fetch_reddit_keyword "Netherlands" "reddit_netherlands"
  fetch_reddit_keyword "poland" "reddit_poland"
  fetch_reddit_keyword "Berlin" "reddit_berlin"
  fetch_reddit_keyword "paris" "reddit_paris"
  fetch_reddit_keyword "madrid" "reddit_madrid"
  fetch_reddit_keyword "Toronto" "reddit_toronto"
  fetch_reddit_keyword "sydney" "reddit_sydney"
  fetch_reddit_keyword "BuildInPublic" "reddit_buildinpublic"
  fetch_reddit_keyword "smallbusiness" "reddit_smallbusiness"
  fetch_reddit_keyword "EntrepreneurRideAlong" "reddit_entrepreneurridealong"
  fetch_reddit_keyword "indiehackers" "reddit_indiehackers"
  fetch_reddit_keyword "SaaS" "reddit_saas"
  fetch_reddit_keyword "vibecoding" "reddit_vibecoding"

  # === Phase 5.5 — Vibe coder job boards (curated AI-assisted shipper roles) ===
  fetch_vibecodecareers
  fetch_vibehackers

  # === Phase 5.4 — Gmail saved-search alerts (via himalaya) ===
  fetch_gmail_alerts

  # === Phase 5.4 — Classifieds via stdlib HTML parser ===
  fetch_classifieds_html

  # === Phase 5.4 — Cloudflare-protected classifieds via Playwright ===
  # Only runs if Playwright is installed (OPENCLAW_INSTALL_BROWSER=1).
  # On Fly: yes. Locally: only if user installed playwright manually.
  fetch_classifieds_browser
}

log "done"
