"""
Cohere Rerank 4 Pro client for the gig-radar Pro tier.

Replaces the cheap heuristic shortlist with semantic ranking via Cohere's
Rerank model, accessed through OpenRouter (so we reuse the same API key).

Gated by env var GIG_RADAR_RERANK=1. Falls back to the heuristic shortlist
on any error (HTTP, parse, missing key).

Cost: ~$0.0025 per search (max 1000 docs/request). At 30-min cron with ~150
prefiltered leads per run, that's $0.005/run × 48 runs/day = ~$0.24/day.

Reference: https://docs.cohere.com/docs/rerank-overview
OpenRouter route: https://openrouter.ai/cohere/rerank-4-pro
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Any

OPENROUTER_RERANK_URL = "https://openrouter.ai/api/v1/rerank"
DEFAULT_MODEL = os.environ.get("GIG_RADAR_RERANK_MODEL", "cohere/rerank-4-pro")
TIMEOUT = int(os.environ.get("GIG_RADAR_RERANK_TIMEOUT", "30"))
MAX_DOCS_PER_CALL = 1000


def _build_profile_query(profile: dict) -> str:
    """Serialize the operator profile into a single query string for Rerank."""
    parts = []
    name = profile.get("name") or "Operator"
    parts.append(f"Operator: {name}")

    skills = profile.get("skills") or []
    if skills:
        parts.append("Skills I can deliver personally: " + ", ".join(skills[:30]))

    arb = profile.get("arbitrage_categories") or []
    if arb:
        parts.append("Categories I can broker via specialists: " + ", ".join(arb))

    deliverables = profile.get("deliverables") or []
    if deliverables:
        parts.append("Typical deliverables: " + " | ".join(deliverables[:8]))

    rates = profile.get("rates") or {}
    if rates:
        bits = []
        if rates.get("hourly_eur"):
            bits.append(f"€{rates['hourly_eur']}/hr")
        if rates.get("fixed_min") and rates.get("fixed_max"):
            bits.append(f"€{rates['fixed_min']}-{rates['fixed_max']} fixed")
        if bits:
            parts.append("Rates: " + " or ".join(bits))

    voice = profile.get("pitch_voice")
    if voice:
        parts.append("Voice: " + str(voice)[:200])

    return " | ".join(parts)


def _build_lead_doc(lead: dict) -> str:
    """Serialize a lead into a single document string for Rerank."""
    title = (lead.get("title") or "").strip()
    body = (lead.get("body") or "").strip()
    budget = (lead.get("budget_text") or "").strip()
    parts = [title]
    if body:
        parts.append(body[:500])
    if budget:
        parts.append(f"Budget: {budget}")
    return "\n".join(parts)


def _call_rerank(query: str, documents: list[str], top_n: int, api_key: str, model: str) -> list[dict]:
    """Single Rerank API call. Returns list of {index, relevance_score}."""
    payload = {
        "model": model,
        "query": query,
        "documents": documents,
        "top_n": top_n,
    }
    req = urllib.request.Request(
        OPENROUTER_RERANK_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/gig-radar",
            "X-Title": "gig-radar",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        data = json.loads(resp.read().decode("utf-8", errors="replace"))

    # OpenRouter normalizes Cohere's response to a "results" array. Cohere's
    # native shape is also {"results": [...]}. Both should work.
    results = data.get("results")
    if results is None:
        # Defensive: some providers wrap in "data.results"
        results = (data.get("data") or {}).get("results", [])
    return results or []


def rerank_leads(
    leads: list[dict],
    profile: dict,
    top_n: int = 25,
    api_key: str | None = None,
    model: str | None = None,
) -> list[dict]:
    """Sort prefiltered leads by semantic relevance to the operator profile.

    Returns the top_n leads, each annotated with `_rerank_score` (0-1 float).
    Falls back to the input order if the API call fails — caller is responsible
    for the fallback shortlist if Rerank is disabled or fails.
    """
    if not leads:
        return []

    api_key = api_key or os.environ.get("OPENROUTER_API_KEY", "")
    if not api_key:
        print("[rerank] OPENROUTER_API_KEY not set — skipping rerank", file=sys.stderr)
        return leads[:top_n]

    model = model or DEFAULT_MODEL
    query = _build_profile_query(profile)
    docs = [_build_lead_doc(L) for L in leads]

    t0 = time.time()
    print(f"[rerank] scoring {len(docs)} docs against profile via {model}...", file=sys.stderr)

    try:
        # Cohere allows up to 1000 docs per request. We always have <500 in practice.
        if len(docs) > MAX_DOCS_PER_CALL:
            print(f"[rerank] WARN: {len(docs)} docs exceeds max {MAX_DOCS_PER_CALL}, truncating", file=sys.stderr)
            docs = docs[:MAX_DOCS_PER_CALL]
            leads_to_rank = leads[:MAX_DOCS_PER_CALL]
        else:
            leads_to_rank = leads

        results = _call_rerank(query, docs, min(top_n, len(docs)), api_key, model)
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")[:300]
        except Exception:
            pass
        print(f"[rerank] HTTP {e.code}: {body}", file=sys.stderr)
        return leads[:top_n]
    except Exception as e:
        print(f"[rerank] call failed: {e} — falling back to input order", file=sys.stderr)
        return leads[:top_n]

    if not results:
        print("[rerank] empty results array — falling back to input order", file=sys.stderr)
        return leads[:top_n]

    elapsed = time.time() - t0
    top_score = max((r.get("relevance_score") or 0) for r in results) if results else 0
    print(f"[rerank] scored in {elapsed:.1f}s, top score={top_score:.3f}", file=sys.stderr)

    # Annotate leads with rerank scores
    ranked: list[dict] = []
    for r in results:
        idx = r.get("index")
        if idx is None or idx >= len(leads_to_rank):
            continue
        L = leads_to_rank[idx]
        L["_rerank_score"] = r.get("relevance_score", 0)
        ranked.append(L)

    return ranked[:top_n]
