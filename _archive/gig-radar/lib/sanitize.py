"""
Sanitize layer — strips HTML comments, invisible chars, dangerous tags, and detects
prompt injection markers. This runs before ANY content reaches the LLM scorer.

Used as a module (imported by run.py) OR as a stdin/stdout filter (python3 -m lib.sanitize).
"""
import json, sys, re

HTML_COMMENT = re.compile(r'<!--.*?-->', re.DOTALL)
INVISIBLE = re.compile(r'[\u200B\u200C\u200D\u202A\u202B\u202C\u202D\u202E\uFEFF]')
DANGEROUS = re.compile(r'<(script|iframe|object|embed|style|link)[^>]*>.*?</\1>', re.DOTALL | re.IGNORECASE)
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
    r'print this (exact )?(message|text)',
    r'send this (message|content) to',
    r'ANTHROPIC_MAGIC_STRING',          # known refusal trigger
    r'TRIGGER_REFUSAL',
    r'_MAGIC_STRING_',
]
INJECTION_RE = re.compile('|'.join(INJECTION_MARKERS), re.IGNORECASE)

QUARANTINE_URL_PATTERNS = [
    re.compile(r'1712n/dn-institute', re.IGNORECASE),  # chestnut emoji injection
    re.compile(r'lobste\.rs', re.IGNORECASE),          # ANTHROPIC_MAGIC_STRING_TRIGGER_REFUSAL injection
]


def sanitize_text(text: str) -> str:
    if not text:
        return text
    text = HTML_COMMENT.sub('', text)
    text = INVISIBLE.sub('', text)
    text = DANGEROUS.sub('', text)
    text = HTML_TAG.sub('', text)
    return text


def is_quarantined(url: str) -> bool:
    return any(p.search(url or '') for p in QUARANTINE_URL_PATTERNS)


def sanitize_lead(L: dict) -> dict:
    """In-place sanitization of a single lead dict. Returns the same dict with injection_suspected flag added."""
    if is_quarantined(L.get('url', '')):
        L['_quarantined'] = True
        return L
    L['title'] = sanitize_text(L.get('title', ''))
    L['body'] = sanitize_text(L.get('body', ''))
    combined = (L.get('title', '') + ' ' + L.get('body', ''))
    L['injection_suspected'] = bool(INJECTION_RE.search(combined))
    return L


def main_filter():
    """Stdin → stdout filter mode."""
    stats = {'in': 0, 'quarantined': 0, 'injection_suspected': 0, 'sanitized': 0, 'kept': 0}
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        stats['in'] += 1
        try:
            L = json.loads(line)
        except Exception:
            continue
        orig_title = L.get('title', '')
        orig_body = L.get('body', '')
        sanitize_lead(L)
        if L.get('_quarantined'):
            stats['quarantined'] += 1
            continue
        if L.get('title') != orig_title or L.get('body') != orig_body:
            stats['sanitized'] += 1
        if L.get('injection_suspected'):
            stats['injection_suspected'] += 1
        stats['kept'] += 1
        print(json.dumps(L, ensure_ascii=False))
    print(f"[sanitize] {stats}", file=sys.stderr)


if __name__ == '__main__':
    main_filter()
