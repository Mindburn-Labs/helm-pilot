#!/usr/bin/env python3
"""
HELM Pilot — YC library / Startup School ingestion using Scrapling spiders.
"""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from pathlib import Path

PIPELINES_ROOT = Path(__file__).resolve().parents[1]
if str(PIPELINES_ROOT) not in sys.path:
    sys.path.append(str(PIPELINES_ROOT))

from scrapling.fetchers import AsyncDynamicSession  # noqa: E402
from scrapling.spiders.request import Request  # noqa: E402
from scrapling.spiders.spider import Spider  # noqa: E402

from common import (  # noqa: E402
    create_crawl_run,
    create_ingestion_record,
    crawl_dir,
    ensure_crawl_source,
    finalize_crawl_run,
    finalize_ingestion_record,
    get_db,
    record_raw_capture,
    save_json_capture,
)

PARSER_VERSION = "0.3.0-scrapling"
SOURCE_ORIGIN = "https://www.ycombinator.com/library"


def first_text(nodes) -> str:
    if not nodes:
        return ""
    try:
        return nodes[0].get_all_text(strip=True)
    except Exception:
        return ""


class YcLibrarySpider(Spider):
    name = "yc-library"
    start_urls = [SOURCE_ORIGIN]
    allowed_domains = {"www.ycombinator.com", "ycombinator.com"}
    concurrent_requests = 4
    download_delay = 0.1

    def __init__(self, *, limit: int | None, crawldir: str):
        self.limit = limit
        self.scheduled = 0
        self.seen: set[str] = set()
        super().__init__(crawldir=crawldir)

    def configure_sessions(self, manager) -> None:
        manager.add(
            "browser",
            AsyncDynamicSession(
                headless=True,
                load_dom=True,
                network_idle=True,
                timeout=30_000,
            ),
            default=True,
        )

    async def start_requests(self):
        yield Request(
            SOURCE_ORIGIN,
            sid="browser",
            wait_selector="a[href^='/library/']",
            callback=self.parse,
        )

    async def parse(self, response):
        links = response.css(
            "a[href^='/library/']",
            identifier="yc_library_links",
            adaptive=True,
            auto_save=True,
        )
        for link in links:
            href = link.attrib.get("href") or ""
            if not href or href == "/library" or href.startswith("/library/author"):
                continue
            full_url = response.urljoin(href)
            if full_url in self.seen:
                continue
            if self.limit and self.scheduled >= self.limit:
                break
            self.seen.add(full_url)
            self.scheduled += 1
            yield Request(
                full_url,
                sid="browser",
                wait_selector="main",
                callback=self.parse_article,
            )

    async def parse_article(self, response):
        title = first_text(
            response.css("h1", identifier="yc_library_title", adaptive=True, auto_save=True)
        ) or "Unknown Title"
        author = first_text(
            response.css(
                "a[href^='/library/author/']",
                identifier="yc_library_author",
                adaptive=True,
                auto_save=True,
            )
        ) or "Y Combinator"
        content = first_text(
            response.css("main", identifier="yc_library_main", adaptive=True, auto_save=True)
        )
        yield {
            "url": response.url,
            "title": title.strip(),
            "author": author.strip(),
            "content": content[:30000],
            "html": response.html_content,
        }


def ensure_course(cur) -> str:
    cur.execute("SELECT id FROM yc_courses WHERE program = 'library' LIMIT 1")
    row = cur.fetchone()
    if row:
        return row[0]

    course_id = str(uuid.uuid4())
    cur.execute(
        """
        INSERT INTO yc_courses (id, program, module, title, description)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (
            course_id,
            "library",
            "general",
            "YC Library Archive",
            "General YC library and Startup School advice corpus.",
        ),
    )
    return course_id


def insert_advice(cur, item: dict, course_id: str) -> bool:
    cur.execute("SELECT id FROM yc_advice WHERE url = %s LIMIT 1", (item["url"],))
    if cur.fetchone():
        return False

    cur.execute(
        """
        INSERT INTO yc_advice (id, source, title, content, author, url, course_id, tags)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            str(uuid.uuid4()),
            "yc_library",
            item["title"],
            item["content"],
            item["author"],
            item["url"],
            course_id,
            json.dumps(["library", "startup_school"]),
        ),
    )
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="HELM Pilot YC library / Startup School scraper")
    parser.add_argument("--limit", type=int, help="Max items to scrape")
    parser.add_argument("--replay", help="Replay from a raw JSON capture")
    parser.add_argument("--dry-run", action="store_true", help="Print without DB writes")
    parser.add_argument("--workspace-id", help="Optional workspace id for provenance")
    args = parser.parse_args()

    if args.replay:
        items = json.loads(Path(args.replay).read_text())
        raw_path = args.replay
    else:
        spider = YcLibrarySpider(limit=args.limit, crawldir=crawl_dir("yc-library"))
        result = spider.start()
        items = result.items
        raw_path = None

    if args.dry_run:
        for item in items[:3]:
            print(f"{item['title']} by {item['author']} ({len(item['content'])} chars)")
        return

    conn = get_db()
    cur = conn.cursor()
    crawl_run_id: str | None = None
    ingestion_record_id: str | None = None

    try:
        source_id = ensure_crawl_source(
            cur,
            workspace_id=args.workspace_id,
            name="yc-library",
            domain="www.ycombinator.com",
            source_type="yc_library",
            fetch_strategy="dynamic",
            auth_requirement="public",
            parser_version=PARSER_VERSION,
            schedule="0 4 * * 0",
            config={"limit": args.limit, "replay": bool(args.replay)},
        )
        ingestion_record_id = create_ingestion_record(
            cur,
            source_origin=SOURCE_ORIGIN,
            source_type="scrape",
            is_public=True,
            parser_version=PARSER_VERSION,
            metadata={"limit": args.limit, "replay": bool(args.replay)},
            raw_storage_path=raw_path,
        )
        crawl_run_id = create_crawl_run(
            cur,
            source_id=source_id,
            workspace_id=args.workspace_id,
            ingestion_record_id=ingestion_record_id,
            mode="replay" if args.replay else "public",
            checkpoint_dir=crawl_dir("yc-library"),
            metadata={"itemCount": len(items)},
        )

        if not raw_path:
            raw_path, size_bytes, checksum = save_json_capture("startup_school", items, "capture")
            record_raw_capture(
                cur,
                crawl_run_id=crawl_run_id,
                source_url=SOURCE_ORIGIN,
                content_type="application/json",
                storage_path=raw_path,
                size_bytes=size_bytes,
                checksum=checksum,
                metadata={"items": len(items)},
            )

        course_id = ensure_course(cur)
        inserted = 0
        for item in items:
            if insert_advice(cur, item, course_id):
                inserted += 1

        finalize_ingestion_record(
            cur,
            record_id=ingestion_record_id,
            status="parsed",
            item_count=inserted,
            raw_storage_path=raw_path,
        )
        finalize_crawl_run(cur, run_id=crawl_run_id, status="completed", item_count=inserted)
        conn.commit()
        print(f"Done: {inserted} inserted, {len(items) - inserted} skipped")
    except Exception as exc:
        conn.rollback()
        if ingestion_record_id and crawl_run_id:
            finalize_ingestion_record(
                cur,
                record_id=ingestion_record_id,
                status="failed",
                item_count=0,
                raw_storage_path=raw_path,
                error=str(exc),
            )
            finalize_crawl_run(cur, run_id=crawl_run_id, status="failed", item_count=0, error=str(exc))
            conn.commit()
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
