"""
browser_fetch.py — Playwright-based fetcher for Cloudflare-protected classifieds.

Uses a real Chromium instance to render JS and bypass bot protection. Required
on the Fly OpenClaw machine where the Dockerfile installs Playwright via the
OPENCLAW_INSTALL_BROWSER=1 build arg.

Sites listed here are confirmed Cloudflare-blocked via plain curl. Each one
has its own DOM structure, so we use generic CSS-like selectors via Playwright's
locator API.

Falls back gracefully (silent exit) if Playwright is not installed.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

try:
    from playwright.sync_api import sync_playwright
    HAVE_PLAYWRIGHT = True
except ImportError:
    HAVE_PLAYWRIGHT = False


# Per-site fetch recipes — use Playwright locators to extract listings
SITES = [
    {
        "id": "browser_leboncoin",
        "name": "Leboncoin Services (FR)",
        "country": "FR",
        "lang": "fr",
        "url": "https://www.leboncoin.fr/recherche?category=33",
        "card_selector": "[data-test-id='ad'] a",
        "title_attr": "title",
    },
    {
        "id": "browser_craigslist_ny",
        "name": "Craigslist New York Computer Services",
        "country": "US",
        "lang": "en",
        "url": "https://newyork.craigslist.org/search/cps",
        "card_selector": "li.cl-static-search-result, .result-row",
        "title_attr": None,  # use innerText
    },
    {
        "id": "browser_craigslist_la",
        "name": "Craigslist LA Computer Services",
        "country": "US",
        "lang": "en",
        "url": "https://losangeles.craigslist.org/search/cps",
        "card_selector": "li.cl-static-search-result, .result-row",
        "title_attr": None,
    },
    {
        "id": "browser_craigslist_sf",
        "name": "Craigslist SF Computer Services",
        "country": "US",
        "lang": "en",
        "url": "https://sfbay.craigslist.org/search/cps",
        "card_selector": "li.cl-static-search-result, .result-row",
        "title_attr": None,
    },
    {
        "id": "browser_gumtree_uk",
        "name": "Gumtree UK Services",
        "country": "GB",
        "lang": "en",
        "url": "https://www.gumtree.com/all/uk/services-other",
        "card_selector": "article.listing-maxi a",
        "title_attr": None,
    },
    {
        "id": "browser_olx_br",
        "name": "OLX Brasil Serviços",
        "country": "BR",
        "lang": "pt",
        "url": "https://www.olx.com.br/servicos/estado-sp",
        "card_selector": "[data-ds-component='DS-AdCard'] a",
        "title_attr": None,
    },
    {
        "id": "browser_sahibinden_tr",
        "name": "Sahibinden Hizmet (TR)",
        "country": "TR",
        "lang": "tr",
        "url": "https://www.sahibinden.com/hizmet",
        "card_selector": "tr.searchResultsItem td.searchResultsTitleValue a",
        "title_attr": None,
    },
    {
        "id": "browser_olx_in",
        "name": "OLX India Services",
        "country": "IN",
        "lang": "en",
        "url": "https://www.olx.in/services_c4",
        "card_selector": "li[data-aut-id='itemBox'] a",
        "title_attr": None,
    },
    {
        "id": "browser_milanuncios",
        "name": "Milanuncios Servicios (ES)",
        "country": "ES",
        "lang": "es",
        "url": "https://www.milanuncios.com/servicios/",
        "card_selector": "article.ma-AdCardV2 a",
        "title_attr": None,
    },
    {
        "id": "browser_jiji_ng",
        "name": "Jiji Nigeria Services",
        "country": "NG",
        "lang": "en",
        "url": "https://jiji.ng/services",
        "card_selector": "div.b-list-advert__gallery__item a",
        "title_attr": None,
    },
]


def stable_id(s: str) -> str:
    return hashlib.sha1(s.encode()).hexdigest()[:16]


def extract_money(text: str) -> str:
    if not text:
        return ""
    m = re.search(r"[\$€£¥₹]\s*[0-9][0-9.,]*(?:\s*-\s*[0-9][0-9.,]*)?", text)
    if m:
        return m.group(0)
    m = re.search(r"[0-9][0-9.,]*\s*(?:€|EUR|USD|GBP|TRY|BRL|INR|NGN)", text, re.IGNORECASE)
    return m.group(0) if m else ""


def fetch_one_site(page, site: dict) -> list[dict]:
    """Fetch one site using an existing Playwright page."""
    url = site["url"]
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=20000)
    except Exception as e:
        print(f"[browser_fetch] goto failed for {site['id']}: {e}", file=sys.stderr)
        return []
    # Give CF challenges a beat to resolve, then settle
    try:
        page.wait_for_load_state("networkidle", timeout=10000)
    except Exception:
        pass

    cards = []
    try:
        # Try the configured selector
        elements = page.locator(site["card_selector"]).all()[:30]
    except Exception as e:
        print(f"[browser_fetch] locator failed for {site['id']}: {e}", file=sys.stderr)
        return []

    now_iso = datetime.now(timezone.utc).isoformat()
    seen_urls = set()
    for el in elements:
        try:
            href = el.get_attribute("href") or ""
            if not href:
                continue
            if href.startswith("/"):
                from urllib.parse import urljoin
                href = urljoin(url, href)
            if href in seen_urls:
                continue
            seen_urls.add(href)

            if site.get("title_attr"):
                title = el.get_attribute(site["title_attr"]) or ""
            else:
                title = (el.inner_text(timeout=2000) or "").strip()
            if not title or len(title) < 8:
                continue

            # Try to extract a price from the surrounding parent
            try:
                parent_text = el.evaluate("el => el.closest('article, li, div, tr')?.innerText || el.innerText") or ""
            except Exception:
                parent_text = title
            budget = extract_money(parent_text)

            cards.append({
                "source": site["id"],
                "post_id": stable_id(href),
                "title": title[:200],
                "body": parent_text[:1500],
                "url": href,
                "posted_at": now_iso,
                "budget_text": budget,
            })
        except Exception:
            continue

    return cards[:30]


def main():
    if not HAVE_PLAYWRIGHT:
        print("[browser_fetch] Playwright not installed — set OPENCLAW_INSTALL_BROWSER=1 in fly.toml or run `pip install playwright && playwright install chromium` locally", file=sys.stderr)
        sys.exit(0)  # silent exit, not an error

    browsers_path = os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "")
    if browsers_path:
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = browsers_path

    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-blink-features=AutomationControlled"],
            )
        except Exception as e:
            print(f"[browser_fetch] Chromium launch failed: {e}", file=sys.stderr)
            sys.exit(0)

        ctx = browser.new_context(
            user_agent=UA,
            viewport={"width": 1280, "height": 800},
            locale="en-US",
            extra_http_headers={"Accept-Language": "en-US,en;q=0.9"},
        )
        page = ctx.new_page()

        total_leads = 0
        for site in SITES:
            print(f"[browser_fetch] fetching {site['id']}...", file=sys.stderr)
            try:
                leads = fetch_one_site(page, site)
                print(f"[browser_fetch]   got {len(leads)} leads from {site['id']}", file=sys.stderr)
                for L in leads:
                    print(json.dumps(L, ensure_ascii=False))
                total_leads += len(leads)
            except Exception as e:
                print(f"[browser_fetch] {site['id']} failed: {e}", file=sys.stderr)
                continue

        print(f"[browser_fetch] total: {total_leads} leads from {len(SITES)} sites", file=sys.stderr)
        ctx.close()
        browser.close()


if __name__ == "__main__":
    main()
