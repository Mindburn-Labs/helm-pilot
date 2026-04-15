"""
Cheap regex pre-filter. Drops obvious junk before the expensive LLM scoring pass.
Rules implement Phase 5 of SKILL.md.
"""
import json, sys, re
from datetime import datetime, timezone, timedelta

# Operator's red skills — tokens that disqualify a lead outright (stack can't be vibe-coded)
RED_TOKENS = {
    'rust', 'scala', 'haskell', 'elixir', 'erlang',
    'swift', 'swiftui', 'objective-c', 'objc',
    'c++', 'cpp',
    'kotlin native',
    'java spring',
    'cuda', 'opencl', 'assembly', 'embedded', 'firmware',
    'solidity', 'move', 'cairo',
    'kubernetes operator', 'k8s operator',
}

HARD_KILL_PHRASES = [
    # Location requirements — drop boundary assumption, use lookahead for letter-or-not
    r'\(in[- ]office\)', r'\(in[- ]person\)', r'\(onsite\)', r'\(on[- ]site\)',
    r'\|\s*in[- ]office', r'\|\s*in[- ]person', r'\|\s*onsite', r'\|\s*on[- ]site',
    r'\bin[- ]?office (only|required)', r'\bonsite required',
    r'\bmust relocate\b', r'\brelocation required\b',
    # Seniority requirements
    r'\b10\+? years\b', r'\b15\+? years\b', r'\b20\+? years\b',
    r'\bprincipal engineer', r'\bstaff engineer',
    r'\bdirector of engineering', r'\bvp engineering',
    r'\bfounding engineer', r'\bfounding eng(?![a-z])',   # founding eng = usually equity-heavy full-time
    r'\blead software engineer',
    # Anti-AI
    r'\bno ai\b', r'\bno cursor\b', r'\bno copilot\b', r'\bno llm\b',
    r'\bhuman[- ]written only',
    # Academic
    r'\bphd required', r'\bphd preferred', r'\bms required',
    r'\bresearch scientist',
    # Security clearance
    r'\bsecurity clearance', r'\btop secret',
]

# NOTE: patterns dropped trailing \b because HN post bodies often glue "full-time" to next word
# (e.g. "Full-timeColonist"). False positive risk is very low (no common English word contains these substrings).
SOFT_KILL_PHRASES = [
    r'full[- ]?time(?![a-z])',   # matches "full-time", "full time", "Full-time", "Full-timeColonist" (stops before letters but allows end-of-string/whitespace/punct)
    r'ft only',
    r'\bperm role\b', r'\bpermanent role\b',
    r'\bjoin (our|the) team\b',
    r'\blong[- ]term collaboration\b',
    # Annual salary patterns — $XXXk-$YYYk ... (base|salary|equity|comp) within reasonable distance
    r'\$\d{2,3}k?\s*[-–]\s*\$?\d{2,3}k.{0,80}(base|salary|equity|comp|ote)',
    r'\$\d{3},?\d{3}.{0,50}(base|salary|equity|comp|ote|annual)',
]

# Strong contract escape clauses — override soft kills
CONTRACT_ESCAPE = [
    r'\bcontract role\b', r'\bcontract position\b', r'\b1099 contract\b', r'\bb2b contract\b',
    r'\bfreelance role\b', r'\bfreelancer wanted\b', r'\bfreelance gig\b',
    r'\bfixed[- ]price project\b', r'\bfixed[- ]scope\b', r'\bfixed[- ]fee\b',
    r'\bone[- ]off project\b', r'\bone[- ]shot build\b', r'\bsingle deliverable\b',
    r'\bproject[- ]based engagement\b', r'\bproject basis\b',
    r'\bopen to contractors?\b', r'\bcontract or full[- ]time\b',
    r'\bfreelance basis\b',
    r'\|\s*contract\b',   # HN-style pipe-separated "| Contract"
]

HARD_KILL_RE = re.compile('|'.join(HARD_KILL_PHRASES), re.IGNORECASE)
SOFT_KILL_RE = re.compile('|'.join(SOFT_KILL_PHRASES), re.IGNORECASE)
ESCAPE_RE = re.compile('|'.join(CONTRACT_ESCAPE), re.IGNORECASE)


def has_red_skill(text: str) -> bool:
    """Token-boundary match for red skills — avoid 'go' matching 'google', 'rust' matching 'trust'."""
    for t in RED_TOKENS:
        if re.search(r'(^|[^a-z0-9+])' + re.escape(t) + r'($|[^a-z0-9+])', text):
            return True
    return False


def prefilter(lead: dict, max_age_days: int = 14, arbitrage_enabled: bool = True) -> tuple[bool, str]:
    """Returns (kept, reason). reason is empty string if kept.

    When arbitrage_enabled=True, leads with red_skill stacks are KEPT (they get
    delivery_mode=arbitrage at the LLM scoring stage). Only kill for true
    non-arbitrageable reasons (injection, truly stale, too short).
    """
    text = (lead.get('title', '') + '\n' + lead.get('body', '') + '\n' + lead.get('budget_text', '')).lower()

    if len(text) < 150:
        return False, 'too_short'

    if lead.get('injection_suspected'):
        return False, 'injection_suspected'

    # Red skill detection — flag the lead but only drop if arbitrage disabled
    if has_red_skill(text):
        lead['_red_skill_detected'] = True
        if not arbitrage_enabled:
            return False, 'red_skill'

    if HARD_KILL_RE.search(text):
        return False, 'hard_kill'

    # Recency — skip leads older than max_age_days
    try:
        ts = lead.get('posted_at', '')
        if ts:
            dt = datetime.fromisoformat(ts.replace('Z', '+00:00'))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) - dt > timedelta(days=max_age_days):
                return False, 'stale'
    except Exception:
        pass

    # Soft kill unless contract escape
    if SOFT_KILL_RE.search(text) and not ESCAPE_RE.search(text):
        return False, 'soft_kill_fulltime'

    return True, ''


def main_filter():
    stats = {'in': 0, 'kept': 0}
    drop_reasons = {}
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        stats['in'] += 1
        try:
            L = json.loads(line)
        except Exception:
            continue
        kept, reason = prefilter(L)
        if kept:
            stats['kept'] += 1
            print(json.dumps(L, ensure_ascii=False))
        else:
            drop_reasons[reason] = drop_reasons.get(reason, 0) + 1
    print(f"[prefilter] {stats} drops={drop_reasons}", file=sys.stderr)


if __name__ == '__main__':
    main_filter()
