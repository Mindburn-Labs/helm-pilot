#!/usr/bin/env python3
"""
HELM Pilot internal Scrapling fetch bridge.

This is used by the orchestrator as a direct tool-level bridge into Scrapling
for one-off operator research and extraction.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PIPELINES_ROOT = Path(__file__).resolve().parents[1]
if str(PIPELINES_ROOT) not in sys.path:
    sys.path.append(str(PIPELINES_ROOT))
YC_SCRAPER_ROOT = PIPELINES_ROOT / "yc-scraper"
if str(YC_SCRAPER_ROOT) not in sys.path:
    sys.path.append(str(YC_SCRAPER_ROOT))

from scraper.lib.scrapling_adapter import fetch_html  # noqa: E402
from common import save_text_capture  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="HELM Pilot Scrapling fetch bridge")
    parser.add_argument("--url", required=True, help="URL to fetch")
    parser.add_argument("--strategy", default="auto", choices=["auto", "fetcher", "dynamic", "stealthy"])
    parser.add_argument("--selector", help="Optional CSS selector to extract")
    parser.add_argument("--wait-selector", help="Optional selector to wait for")
    parser.add_argument("--adaptive-domain", help="Optional canonical domain for adaptive storage")
    parser.add_argument("--limit", type=int, default=5, help="Maximum selected nodes to return")
    args = parser.parse_args()

    response = fetch_html(
        args.url,
        strategy=args.strategy,
        adaptive_domain=args.adaptive_domain,
        wait_selector=args.wait_selector,
    )

    title_nodes = response.css("title")
    title = title_nodes[0].get_all_text(strip=True) if title_nodes else ""

    selected: list[dict[str, str]] = []
    if args.selector:
        nodes = response.css(
            args.selector,
            adaptive=True,
            auto_save=True,
            identifier=f"operator::{args.selector}",
        )
        for node in nodes[: args.limit]:
            selected.append(
                {
                    "text": node.get_all_text(separator=" ", strip=True)[:2000],
                    "html": str(node)[:4000],
                }
            )

    capture_path, _, _ = save_text_capture("operator_fetch", response.html_content, "capture", "html")
    text = response.get_all_text(separator="\n", strip=True)
    payload = {
        "url": response.url,
        "title": title,
        "selector": args.selector,
        "selected": selected,
        "textPreview": text[:6000],
        "capturePath": capture_path,
    }
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
