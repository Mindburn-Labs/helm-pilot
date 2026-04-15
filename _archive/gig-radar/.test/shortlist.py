#!/usr/bin/env python3
"""
Cheap shortlister: rank survivors so the LLM only has to deeply score the top N.
This is the "trim before LLM" step inside Phase 6.
"""
import json, sys, re
from datetime import datetime, timezone

# Money signal (rough — LLM will do the real analysis)
MONEY_RE = re.compile(r'[\$€£]\s*([0-9][0-9,]*\.?\d*)\s*(k|K)?', re.IGNORECASE)
HOURLY_HINT = re.compile(r'(per|/)\s*(hr|hour|h\b)', re.IGNORECASE)
ANNUAL_HINT = re.compile(r'(annual|salary|base|/year|per year|equity|OTE\b|comp range)', re.IGNORECASE)
CONTRACT_STRONG = re.compile(r'(contract role|contract position|1099 contract|b2b contract|freelance|fixed[- ]price project|fixed[- ]scope|one[- ]off|one[- ]shot|project[- ]based|project basis|founding engineer)', re.IGNORECASE)

# Quality signal
SOURCE_QUALITY = {
    'reddit_forhire': 1.0,
    'reddit_jobbit': 0.9,
    'reddit_sideproject_help': 0.8,
    'algora_bounties': 1.2,   # always concrete deliverable
    'github_bounty_label': 1.1,
    'github_bounty_title': 0.9,
    'hn_whoishiring': 0.6,    # mostly full-time (already filtered) — those that survive are gold
    'hn_freelancer': 1.3,     # explicit freelance thread
}

now = datetime.now(timezone.utc)

def shortlist_score(L):
    text = (L.get('title','') + ' ' + L.get('body','') + ' ' + L.get('budget_text',''))
    lower = text.lower()

    # Extract money — but disambiguate annual vs project
    money = 0
    is_annual = False
    is_hourly = False
    for m in MONEY_RE.finditer(text):
        try:
            n = float(m.group(1).replace(',',''))
            if m.group(2) and m.group(2).lower() == 'k':
                n *= 1000
            money = max(money, n)
        except: pass

    if HOURLY_HINT.search(text):
        is_hourly = True
    if ANNUAL_HINT.search(text) and money > 30000:
        is_annual = True

    # Annual salary discount: $200k annual ≠ $200k project
    if is_annual:
        money_signal = 0  # annual is irrelevant unless paired with contract
    elif is_hourly:
        money_signal = min(40, money * 0.4) if money > 0 else 5
    else:
        money_signal = min(40, money * 0.008) if money > 0 else 8

    # Contract escape bonus
    if CONTRACT_STRONG.search(text):
        contract_bonus = 15
    else:
        contract_bonus = 0

    # Source quality multiplier
    sq = SOURCE_QUALITY.get(L.get('source',''), 0.7)

    # Recency
    rec = 0
    try:
        ts = L.get('posted_at','')
        dt = datetime.fromisoformat(ts.replace('Z','+00:00'))
        if dt.tzinfo is None: dt = dt.replace(tzinfo=timezone.utc)
        age_h = (now - dt).total_seconds() / 3600
        if age_h < 6: rec = 15
        elif age_h < 24: rec = 10
        elif age_h < 72: rec = 5
        elif age_h < 168: rec = 2
    except: pass

    # Length signal — long detailed posts > short stubs
    body_len = len(L.get('body','') or '')
    detail = min(10, body_len / 100)

    raw = (money_signal + contract_bonus + rec + detail) * sq
    return round(raw, 1)

leads = []
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try:
        L = json.loads(line)
        L['_shortlist_score'] = shortlist_score(L)
        leads.append(L)
    except: pass

leads.sort(key=lambda x: -x['_shortlist_score'])

N = int(sys.argv[1]) if len(sys.argv) > 1 else 25
for L in leads[:N]:
    print(json.dumps(L))

print(f"\nSHORTLIST: {len(leads)} → top {N}", file=sys.stderr)
