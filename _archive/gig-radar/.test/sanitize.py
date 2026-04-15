#!/usr/bin/env python3
"""
Phase 5.0 — Sanitization layer.
Reads jsonl on stdin. For each lead:
  - Strips HTML comments <!-- ... -->
  - Strips zero-width and bidi control chars
  - Strips dangerous HTML tags
  - Detects injection markers and adds injection_suspected flag
Writes sanitized jsonl to stdout. Stats to stderr.
"""
import json, sys, re

# Multi-line HTML comment stripper
HTML_COMMENT = re.compile(r'<!--.*?-->', re.DOTALL)
# Zero-width + bidi controls
INVISIBLE = re.compile(r'[\u200B\u200C\u200D\u202A\u202B\u202C\u202D\u202E\uFEFF]')
# Dangerous tags (drop the whole tag including content)
DANGEROUS = re.compile(r'<(script|iframe|object|embed|style|link)[^>]*>.*?</\1>', re.DOTALL | re.IGNORECASE)
# All other HTML (just strip tags, keep content)
HTML_TAG = re.compile(r'<[^>]+>')

INJECTION_MARKERS = [
    r'ignore (all )?previous instructions',
    r'ignore (all )?prior instructions',
    r'disregard (all )?(previous|prior|above)',
    r'<\|system\|>', r'<\|im_start\|>', r'<\|im_end\|>',
    r'\bsystem prompt\b',
    r'you are now',
    r'new instructions',
    r'override your',
    r'chestnut (overlord|emoji)',
    r':shipit:',
    r'\bjailbreak\b',
]
INJECTION_RE = re.compile('|'.join(INJECTION_MARKERS), re.IGNORECASE)

QUARANTINE_URL_PATTERNS = [
    re.compile(r'1712n/dn-institute', re.IGNORECASE),
]

stats = {'in': 0, 'sanitized': 0, 'injection_suspected': 0, 'quarantined': 0, 'kept': 0}

def sanitize(text):
    if not text: return text
    text = HTML_COMMENT.sub('', text)
    text = INVISIBLE.sub('', text)
    text = DANGEROUS.sub('', text)
    text = HTML_TAG.sub('', text)
    return text

for line in sys.stdin:
    line = line.strip()
    if not line: continue
    stats['in'] += 1
    try:
        L = json.loads(line)
    except: continue

    # Quarantine check
    if any(p.search(L.get('url','')) for p in QUARANTINE_URL_PATTERNS):
        stats['quarantined'] += 1
        continue

    orig_title = L.get('title','') or ''
    orig_body = L.get('body','') or ''

    L['title'] = sanitize(orig_title)
    L['body'] = sanitize(orig_body)

    if L['title'] != orig_title or L['body'] != orig_body:
        stats['sanitized'] += 1

    combined = (L['title'] + ' ' + L['body'])
    if INJECTION_RE.search(combined):
        L['injection_suspected'] = True
        stats['injection_suspected'] += 1
    else:
        L['injection_suspected'] = False

    stats['kept'] += 1
    print(json.dumps(L))

print(f"\nSANITIZE STATS: {stats}", file=sys.stderr)
