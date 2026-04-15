#!/usr/bin/env python3
"""
Phase 5 — Cheap pre-filter (regex-based).
Reads jsonl on stdin, writes survivors to stdout. Logs stats to stderr.
"""
import json, sys, re
from datetime import datetime, timezone

# Operator's red skills (stack they can't credibly deliver, even with AI)
RED_TOKENS = {
    'rust', 'c++', 'cpp', 'scala', 'haskell', 'elixir', 'erlang',
    'swift', 'swiftui', 'objective-c', 'objc', 'kotlin native',
    'java spring', '.net', 'c#', 'csharp',
    'ruby on rails', 'rails', 'django',
    'cuda', 'opencl', 'assembly', 'embedded', 'firmware',
    'solidity', 'move', 'cairo',
    'kubernetes operator', 'k8s operator',
}

# Hard-kill phrases
HARD_KILL_PHRASES = [
    r'\bin[- ]?office only\b', r'\bonsite required\b', r'\bin[- ]?person\b',
    r'\bmust relocate\b', r'\brelocation required\b',
    r'\b10\+? years\b', r'\b15\+? years\b', r'\b20\+? years\b',
    r'\bprincipal engineer\b', r'\bstaff engineer\b',
    r'\bdirector of engineering\b', r'\bvp engineering\b',
    r'\bno ai\b', r'\bno cursor\b', r'\bno copilot\b', r'\bno llm\b',
    r'\bhuman[- ]written only\b',
    r'\bphd required\b', r'\bphd preferred\b', r'\bms required\b',
    r'\bresearch scientist\b',
    r'\bsecurity clearance\b', r'\btop secret\b', r'\bdod\b',
]

# Soft-kill phrases (drop unless contract escape clause is present)
SOFT_KILL_PHRASES = [
    r'\bfull[- ]time\b', r'\bft only\b', r'\bperm role\b', r'\bpermanent role\b',
    r'\bjoin (our|the) team\b', r'\bgrowing team\b',
    r'\blong[- ]term collaboration\b',
]

# Contract escape clauses — if any present, do NOT soft-kill
CONTRACT_ESCAPE = [
    r'\bcontract\b', r'\bfreelance\b', r'\b1099\b', r'\bb2b\b',
    r'\bfixed[- ]price\b', r'\bone[- ]off\b', r'\bone[- ]shot\b',
    r'\bproject basis\b', r'\bproject[- ]based\b',
    r'\bpart[- ]time\b',
]

stats = {'in': 0, 'hard_kill': 0, 'red_skill': 0, 'soft_kill': 0, 'too_short': 0, 'kept': 0}

for line in sys.stdin:
    line = line.strip()
    if not line: continue
    stats['in'] += 1
    try:
        L = json.loads(line)
    except: continue

    text = (L.get('title','') + '\n' + L.get('body','') + '\n' + L.get('budget_text','')).lower()

    # Length check
    if len(text) < 150:
        stats['too_short'] += 1
        continue

    # Red skills (token boundary)
    if any(re.search(r'(^|[^a-z0-9])' + re.escape(t) + r'($|[^a-z0-9])', text) for t in RED_TOKENS):
        stats['red_skill'] += 1
        continue

    # Hard kill phrases
    if any(re.search(p, text) for p in HARD_KILL_PHRASES):
        stats['hard_kill'] += 1
        continue

    # Soft kill: full-time etc, UNLESS contract escape present
    has_soft = any(re.search(p, text) for p in SOFT_KILL_PHRASES)
    has_escape = any(re.search(p, text) for p in CONTRACT_ESCAPE)
    if has_soft and not has_escape:
        stats['soft_kill'] += 1
        continue

    stats['kept'] += 1
    print(line)

print(f"\nPRE-FILTER STATS: {stats}", file=sys.stderr)
