"""
classifieds.py — generic HTML classified-ad parser for gig-radar.

Each classified site has a different DOM, so we configure per-site:
- url: the listing page (or category)
- selectors: CSS-like patterns for title/body/url/price using stdlib html.parser
- post_id_strategy: how to derive a stable id (slug from URL, hash, etc.)
- date_strategy: how to extract posted_at (regex, attribute, position)
- country_lang: ISO codes for the LLM scorer hint

We use stdlib html.parser instead of BeautifulSoup to avoid the dep. The
parser is forgiving — sites that change DOM will produce fewer leads but
won't crash the pipeline.

Each site_config is a dict; the run_site_fetcher function takes one and
emits normalized lead JSON to stdout.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from typing import Any

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"


class ListingExtractor(HTMLParser):
    """
    Extracts listing-like blocks from a classified-ad page.

    Strategy: walk the DOM, identify repeating "card" containers (typically
    <article>, <li>, or <div class*="listing"|"item"|"card"|"ad">) and pull
    out title (h2/h3 + a[href]), price ($/€/£/etc patterns), description,
    and date. Returns a list of dicts.
    """

    def __init__(self, base_url: str, container_tags: tuple = ("article", "li", "div"),
                 container_class_hints: tuple = ("listing", "item", "card", "ad", "anzeige", "annunci", "ogloszenie", "annonce", "anuncio", "result")):
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.container_tags = container_tags
        self.container_class_hints = tuple(c.lower() for c in container_class_hints)
        self.in_container_stack: list[dict] = []  # stack of {tag, depth, buf, href, ...}
        self.depth = 0
        self.results: list[dict] = []

    def handle_starttag(self, tag, attrs):
        self.depth += 1
        attrs_d = dict(attrs)
        cls = (attrs_d.get("class") or "").lower()
        is_container = (
            tag in self.container_tags
            and any(hint in cls for hint in self.container_class_hints)
        )
        if is_container:
            self.in_container_stack.append({
                "tag": tag,
                "depth": self.depth,
                "title_parts": [],
                "body_parts": [],
                "href": "",
                "attrs": attrs_d,
                "in_title": False,
                "current_href": "",
            })
            return

        if not self.in_container_stack:
            return

        cur = self.in_container_stack[-1]

        # Track first <a href=...> as the listing link
        if tag == "a" and not cur["href"]:
            href = attrs_d.get("href", "")
            if href:
                cur["href"] = urllib.parse.urljoin(self.base_url, href)
                cur["current_href"] = cur["href"]

        # Mark <h*> blocks as title sources
        if tag in ("h1", "h2", "h3", "h4"):
            cur["in_title"] = True

    def handle_endtag(self, tag):
        if self.in_container_stack:
            cur = self.in_container_stack[-1]
            if cur["depth"] == self.depth and cur["tag"] == tag:
                # Close this container
                self.in_container_stack.pop()
                title = " ".join(cur["title_parts"]).strip()
                body = " ".join(cur["body_parts"]).strip()
                if title and len(title) > 5 and cur["href"]:
                    self.results.append({
                        "title": title[:200],
                        "body": body[:1500],
                        "url": cur["href"],
                    })
            elif tag in ("h1", "h2", "h3", "h4"):
                cur["in_title"] = False

        self.depth -= 1

    def handle_data(self, data):
        if not self.in_container_stack:
            return
        cur = self.in_container_stack[-1]
        text = data.strip()
        if not text:
            return
        if cur["in_title"] and len(text) > 2:
            cur["title_parts"].append(text)
        elif len(text) > 4:
            cur["body_parts"].append(text)


def fetch_html(url: str, timeout: int = 15) -> str:
    """Fetch a URL with a real-browser user agent. Returns body or empty string on failure."""
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": UA,
            "Accept-Language": "en;q=0.8,*;q=0.5",
            "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        })
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"[classifieds] fetch failed {url}: {e}", file=sys.stderr)
        return ""


def stable_id(s: str) -> str:
    """Derive a stable post_id from a URL or string."""
    return hashlib.sha1(s.encode()).hexdigest()[:16]


def extract_money(text: str) -> str:
    """Find the highest-confidence money string in some text."""
    if not text:
        return ""
    patterns = [
        r"[\$€£¥₹]\s*[0-9][0-9.,]*(?:\s*-\s*[0-9][0-9.,]*)?",
        r"[0-9][0-9.,]*\s*(?:€|EUR|USD|GBP|PLN|CHF|SEK|DKK|NOK|RUB|TRY|UAH|BRL|ARS|MXN|JPY|VND|HKD|CAD|AUD|NZD|KRW|INR|IDR|PHP|TWD|CZK|HUF|RON|BGN)",
    ]
    for p in patterns:
        m = re.search(p, text)
        if m:
            return m.group(0)
    return ""


def run_site(site: dict) -> list[dict]:
    """Fetch + parse one classified site, return normalized leads."""
    url = site["url"]
    html = fetch_html(url)
    if not html:
        return []

    parser = ListingExtractor(
        base_url=url,
        container_tags=site.get("container_tags", ("article", "li", "div")),
        container_class_hints=tuple(site.get("container_class_hints", ("listing", "item", "card", "ad", "anzeige", "annunci", "ogloszenie", "annonce", "anuncio", "result"))),
    )
    try:
        parser.feed(html)
    except Exception as e:
        print(f"[classifieds] parser failed for {site['id']}: {e}", file=sys.stderr)
        return []

    now_iso = datetime.now(timezone.utc).isoformat()
    out = []
    seen_urls = set()
    for r in parser.results:
        if r["url"] in seen_urls:
            continue
        seen_urls.add(r["url"])
        # Filter out junk: titles that are nav links, footer text, etc.
        title = r["title"]
        if len(title) < 8:
            continue
        if any(skip in title.lower() for skip in [
            "cookie", "log in", "sign in", "register", "navigation", "menu",
            "see all", "view all", "load more", "next page", "previous", "search",
        ]):
            continue
        body = r["body"]
        budget = extract_money(title + " " + body)
        out.append({
            "source": site["id"],
            "post_id": stable_id(r["url"]),
            "title": title,
            "body": body,
            "url": r["url"],
            "posted_at": now_iso,  # most classified pages don't expose per-card timestamps cleanly
            "budget_text": budget,
        })

    # Cap to ~30 leads per site to avoid flooding
    return out[:30]


# ---- Site registry ----
SITES = [
    {
        "id": "classifieds_kleinanzeigen_de",
        "name": "Kleinanzeigen.de Dienstleistungen (DE)",
        "country": "DE",
        "lang": "de",
        "url": "https://www.kleinanzeigen.de/s-dienstleistungen/k0",
    },
    {
        "id": "classifieds_olx_pl",
        "name": "OLX.pl Usługi (PL)",
        "country": "PL",
        "lang": "pl",
        "url": "https://www.olx.pl/uslugi/",
    },
    {
        "id": "classifieds_kijiji_ca",
        "name": "Kijiji.ca Services (CA)",
        "country": "CA",
        "lang": "en",
        "url": "https://www.kijiji.ca/b-services/canada/page-1/k0c72l0",
    },
    {
        "id": "classifieds_olx_pt",
        "name": "OLX.pt Serviços (PT)",
        "country": "PT",
        "lang": "pt",
        "url": "https://www.olx.pt/servicos/",
    },
    {
        "id": "classifieds_subito_it",
        "name": "Subito.it Servizi (IT)",
        "country": "IT",
        "lang": "it",
        "url": "https://www.subito.it/annunci-italia/vendita/usato/?cgsubcat=ce",
    },
    {
        "id": "classifieds_marktplaats_nl",
        "name": "Marktplaats Diensten (NL)",
        "country": "NL",
        "lang": "nl",
        "url": "https://www.marktplaats.nl/l/diensten-en-vakmensen/",
    },
    {
        "id": "classifieds_wallapop_es",
        "name": "Wallapop Servicios (ES)",
        "country": "ES",
        "lang": "es",
        "url": "https://es.wallapop.com/app/search?category_ids=24200",
    },
    {
        "id": "classifieds_mercadolibre_ar",
        "name": "MercadoLibre Servicios (AR)",
        "country": "AR",
        "lang": "es",
        "url": "https://servicios.mercadolibre.com.ar/",
    },
    {
        "id": "classifieds_blocket_se",
        "name": "Blocket Tjänster (SE)",
        "country": "SE",
        "lang": "sv",
        "url": "https://www.blocket.se/annonser/hela_sverige?cg=4060",
    },
    {
        "id": "classifieds_anibis_ch",
        "name": "Anibis Services (CH)",
        "country": "CH",
        "lang": "fr",
        "url": "https://www.anibis.ch/fr/c/services--108",
    },
    {
        "id": "classifieds_chotot_vn",
        "name": "Chợ Tốt Dịch vụ (VN)",
        "country": "VN",
        "lang": "vi",
        "url": "https://www.chotot.com/mua-ban-dich-vu",
    },
    {
        "id": "classifieds_mercari_jp",
        "name": "Mercari (JP)",
        "country": "JP",
        "lang": "ja",
        "url": "https://jp.mercari.com/search?keyword=%E4%BB%A3%E8%A1%8C",  # "agency/proxy" search
    },
]

# Confirmed BLOCKED — do not bother (Cloudflare or login wall):
DEAD_SITES = {
    "leboncoin.fr": "Cloudflare 403 on all paths",
    "craigslist.org": "RSS endpoints return 403 since 2024",
    "gumtree.com (UK)": "404 / login wall",
    "gumtree.com.au": "Cloudflare 403",
    "olx.com.br": "Cloudflare 403",
    "olx.com.mx": "DNS / unreachable",
    "olx.in": "DNS / unreachable",
    "olx.co.id": "Cloudflare 403",
    "olx.ph": "DNS / unreachable",
    "sahibinden.com": "Cloudflare 403",
    "bazaraki.com": "Cloudflare 403",
    "milanuncios.com": "404 on all probed URLs",
    "tori.fi": "404 on category URLs",
    "dba.dk": "404 on category URLs",
    "willhaben.at": "404 on category URLs",
    "bazos.cz": "404 on probed URLs",
    "jmty.jp": "404 on probed URLs",
    "rsshub.app (public)": "Universal 403 — heavily rate-limited",
}


def main_fetch_all():
    """Print all leads from all sites as JSONL to stdout."""
    for site in SITES:
        print(f"[classifieds] fetching {site['id']}...", file=sys.stderr)
        leads = run_site(site)
        print(f"[classifieds]   got {len(leads)} leads from {site['id']}", file=sys.stderr)
        for L in leads:
            print(json.dumps(L, ensure_ascii=False))


def main_fetch_one(site_id: str):
    site = next((s for s in SITES if s["id"] == site_id), None)
    if not site:
        print(f"site {site_id} not in registry", file=sys.stderr)
        sys.exit(1)
    leads = run_site(site)
    print(f"[classifieds] {site_id}: {len(leads)} leads", file=sys.stderr)
    for L in leads:
        print(json.dumps(L, ensure_ascii=False))


if __name__ == "__main__":
    if len(sys.argv) > 1:
        main_fetch_one(sys.argv[1])
    else:
        main_fetch_all()
