"""
Shortlist layer — ranks prefiltered leads by cheap heuristics so the expensive
LLM scorer only has to deeply analyze the top N candidates.

This is NOT the final score. The LLM scorer (Phase 6) does the actual intelligence.
Shortlist is just "trim before LLM" cost optimization.
"""
import json, sys, re
from datetime import datetime, timezone

MONEY_RE = re.compile(r'[\$€£]\s*([0-9][0-9,]*\.?\d*)\s*(k|K)?', re.IGNORECASE)
HOURLY_HINT = re.compile(r'(per|/)\s*(hr|hour|h\b)', re.IGNORECASE)
ANNUAL_HINT = re.compile(r'(annual|salary|base|/year|per year|equity|OTE\b|comp range|total comp)', re.IGNORECASE)
CONTRACT_STRONG = re.compile(
    r'(contract role|contract position|1099 contract|b2b contract|freelance|'
    r'fixed[- ]price project|fixed[- ]scope|fixed[- ]fee|one[- ]off|one[- ]shot|'
    r'project[- ]based|project basis|founding engineer|founding eng|'
    r'\|\s*contract\b|freelance basis)',
    re.IGNORECASE
)

SOURCE_QUALITY = {
    'reddit_forhire': 1.0,
    'reddit_jobbit': 0.95,
    'reddit_slavelabour': 0.6,
    'reddit_sideproject_help': 1.15,   # founders explicitly hiring = high signal
    'algora_bounties': 1.25,           # always concrete deliverable + payment rails
    'github_bounty_label': 1.1,
    'github_bounty_title': 0.9,
    'hn_whoishiring': 0.7,             # mostly full-time; survivors are gold
    'hn_freelancer': 1.3,              # explicit freelance thread when it exists
}


def shortlist_score(lead: dict) -> float:
    text = (lead.get('title', '') + ' ' + lead.get('body', '') + ' ' + lead.get('budget_text', ''))
    lower = text.lower()

    # Extract highest dollar signal
    money = 0.0
    for m in MONEY_RE.finditer(text):
        try:
            n = float(m.group(1).replace(',', ''))
            if m.group(2) and m.group(2).lower() == 'k':
                n *= 1000
            money = max(money, n)
        except Exception:
            pass

    is_hourly = bool(HOURLY_HINT.search(text))
    is_annual = bool(ANNUAL_HINT.search(text)) and money > 30000

    # Annual salary is not a gig budget — discount it
    if is_annual:
        money_signal = 0.0
    elif is_hourly:
        money_signal = min(40, money * 0.4) if money > 0 else 5
    else:
        money_signal = min(40, money * 0.008) if money > 0 else 8

    # Contract escape bonus — rewards explicit contract/freelance framing
    contract_bonus = 15 if CONTRACT_STRONG.search(text) else 0

    # Source quality
    sq = SOURCE_QUALITY.get(lead.get('source', ''), 0.7)

    # Recency — flatter curve so good old leads still make the shortlist
    rec = 0
    try:
        ts = lead.get('posted_at', '')
        if ts:
            dt = datetime.fromisoformat(ts.replace('Z', '+00:00'))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            age_h = (datetime.now(timezone.utc) - dt).total_seconds() / 3600
            if age_h < 6:
                rec = 10
            elif age_h < 24:
                rec = 8
            elif age_h < 72:
                rec = 6
            elif age_h < 168:
                rec = 4
            elif age_h < 336:  # 14 days
                rec = 2
    except Exception:
        pass

    # Body length — more detail usually means a more serious post
    body_len = len(lead.get('body', '') or '')
    detail = min(10, body_len / 100)

    return round((money_signal + contract_bonus + rec + detail) * sq, 1)


def main_shortlist(top_n: int = 25):
    leads = []
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            L = json.loads(line)
            L['_shortlist_score'] = shortlist_score(L)
            leads.append(L)
        except Exception:
            pass
    leads.sort(key=lambda x: -x['_shortlist_score'])
    for L in leads[:top_n]:
        print(json.dumps(L, ensure_ascii=False))
    print(f"[shortlist] {len(leads)} → top {top_n}", file=sys.stderr)


if __name__ == '__main__':
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 25
    main_shortlist(n)
