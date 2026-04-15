#!/usr/bin/env python3
"""
HELM Pilot — YC Startup School Pipeline (Phase 2.2)

playwright-based scraper for YC Startup School library.
Scrapes course structures and general YC Library advice items.
Extracts structured advice into `yc_courses` and `yc_advice`.

Usage:
    python scrape_startup_school.py
    python scrape_startup_school.py --limit 10
    python scrape_startup_school.py --replay <path>
"""

import argparse
import json
import os
import sys
import uuid
from datetime import datetime, timezone

import psycopg2
try:
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
except ImportError:
    print("ERROR: playwright not found. Please `pip install playwright && playwright install`", file=sys.stderr)
    sys.exit(1)

PARSER_VERSION = "0.2.0"
SOURCE_ORIGIN = "https://www.ycombinator.com/library"


def get_db():
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("ERROR: DATABASE_URL required", file=sys.stderr)
        sys.exit(1)
    return psycopg2.connect(url)


def save_raw_capture(items: list[dict]) -> str:
    """Save the raw combined text/html payload to disk for provenance."""
    base_dir = os.environ.get("STORAGE_PATH", "./data/storage")
    capture_dir = os.path.join(base_dir, "raw", "startup_school")
    os.makedirs(capture_dir, exist_ok=True)
    
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filepath = os.path.join(capture_dir, f"capture_{timestamp}.json")
    
    with open(filepath, "w") as f:
        json.dump(items, f, indent=2)
    
    return filepath


def log_ingestion(cur, item_count: int, status: str, raw_storage_path: str = None, is_replay: bool = False, original_record_id: str = None, error: str = None):
    if is_replay and original_record_id:
        cur.execute(
            "UPDATE ingestion_records SET replay_count = replay_count + 1, last_replayed_at = %s, parsed_at = %s WHERE id = %s",
            (datetime.now(timezone.utc), datetime.now(timezone.utc), original_record_id)
        )
        return original_record_id

    record_id = str(uuid.uuid4())
    cur.execute(
        """INSERT INTO ingestion_records
           (id, source_origin, source_type, is_public, parser_version,
            fetched_at, parsed_at, item_count, status, raw_storage_path, error)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (
            record_id,
            SOURCE_ORIGIN,
            "scrape",
            True,
            PARSER_VERSION,
            datetime.now(timezone.utc),
            datetime.now(timezone.utc) if status == "parsed" else None,
            item_count,
            status,
            raw_storage_path,
            error,
        ),
    )
    return record_id


def scrape_library(limit: int | None = None) -> list[dict]:
    """Scrape YC Library using Playwright"""
    items = []
    print(f"Scraping library at {SOURCE_ORIGIN} ...")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(SOURCE_ORIGIN)
        
        # Give it a moment to render
        page.wait_for_load_state("networkidle")
        
        # Find article links
        links = page.locator("a[href^='/library/']").all()
        hrefs = set()
        for link in links:
            href = link.get_attribute("href")
            if href and href != "/library" and not href.startswith("/library/author"):
                hrefs.add(href)
        
        print(f"Found {len(hrefs)} library items.")
        
        hrefs = list(hrefs)
        if limit:
            hrefs = hrefs[:limit]
            
        for href in hrefs:
            full_url = f"https://www.ycombinator.com{href}"
            print(f"  Scraping {full_url} ...")
            try:
                page.goto(full_url)
                page.wait_for_load_state("domcontentloaded")
                
                title = page.locator("h1").first.inner_text() if page.locator("h1").count() > 0 else "Unknown Title"
                content = page.locator("main").inner_text() if page.locator("main").count() > 0 else page.inner_text("body")
                
                # Try to get author
                author_loc = page.locator("a[href^='/library/author/']").first
                author = author_loc.inner_text() if author_loc.count() > 0 else "Y Combinator"
                
                items.append({
                    "url": full_url,
                    "title": title.strip(),
                    "author": author.strip(),
                    "content": content,
                    "html": page.content()  # Store raw HTML for potential re-parsing
                })
            except Exception as e:
                print(f"    Failed to scrape {full_url}: {e}")
                
        browser.close()
        
    return items


def insert_course_dummy(cur) -> str:
    """Create a default course structure for parsed library items."""
    cur.execute("SELECT id FROM yc_courses WHERE program = 'library'")
    row = cur.fetchone()
    if row:
        return row[0]
        
    course_id = str(uuid.uuid4())
    cur.execute(
        """INSERT INTO yc_courses (id, program, module, title, description) 
           VALUES (%s, %s, %s, %s, %s)""",
        (course_id, "library", "general", "YC Library Archive", "General unstructured advice from YC Library.")
    )
    return course_id


def insert_advice(cur, item: dict, course_id: str):
    cur.execute("SELECT id FROM yc_advice WHERE url = %s", (item["url"],))
    if cur.fetchone():
        return False
        
    advice_id = str(uuid.uuid4())
    # Clean up content a bit to remove massive bloat if needed
    content = item["content"][:30000] # Limit to avoid overwhelming DB if scrape goes wrong
    
    cur.execute(
        """INSERT INTO yc_advice (id, source, title, content, author, url, course_id, tags)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
        (
            advice_id,
            "yc_library",
            item["title"],
            content,
            item["author"],
            item["url"],
            course_id,
            json.dumps(["library"])
        )
    )
    return True


def main():
    parser = argparse.ArgumentParser(description="HELM Pilot Startup School / Library Scraper")
    parser.add_argument("--limit", type=int, help="Max items to scrape")
    parser.add_argument("--replay", help="Path to raw JSON capture")
    parser.add_argument("--dry-run", action="store_true", help="Print without DB writes")
    args = parser.parse_args()

    items = []
    raw_path = None
    if args.replay:
        print(f"Replaying from {args.replay}...")
        with open(args.replay, "r") as f:
            items = json.load(f)
        raw_path = args.replay
    else:
        items = scrape_library(args.limit)
        if not args.dry_run and items:
            raw_path = save_raw_capture(items)
            print(f"Saved raw capture to {raw_path}")

    if args.dry_run:
        for it in items[:3]:
            print(f" {it['title']} by {it['author']} ({len(it['content'])} chars)")
        return

    print("Writing to DB...")
    conn = get_db()
    cur = conn.cursor()
    inserted = 0
    
    try:
        course_id = insert_course_dummy(cur)
        for it in items:
            if insert_advice(cur, it, course_id):
                inserted += 1
                
        log_ingestion(cur, inserted, "parsed", raw_storage_path=raw_path, is_replay=bool(args.replay))
        conn.commit()
        print(f"Done: {inserted} inserted, {len(items)-inserted} skipped (already existed)")
    except Exception as e:
        conn.rollback()
        log_ingestion(cur, 0, "failed", raw_storage_path=raw_path, is_replay=bool(args.replay), error=str(e))
        conn.commit()
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
