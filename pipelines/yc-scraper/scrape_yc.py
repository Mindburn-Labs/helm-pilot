#!/usr/bin/env python3
"""
HELM Pilot — YC Intelligence Pipeline (Phase 2.1)

Scrapes YC public company directory and structures it into the intel DB tables.
Tracks provenance per Section 39.4: source origin, type, fetch time, parser version.
Supports raw capture saving and re-running from raw captures.

Usage:
    python scrape_yc.py                    # Full scrape
    python scrape_yc.py --batch W24        # Single batch
    python scrape_yc.py --limit 50         # Limit companies
    python scrape_yc.py --dry-run          # Print without DB writes
    python scrape_yc.py --replay <path>    # Replay from a raw JSON capture
"""

import argparse
import json
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from urllib.request import urlopen, Request
from urllib.error import HTTPError

import psycopg2

PARSER_VERSION = "0.2.0"
USER_AGENT = "HELM-Pilot/0.2.0 (YC Intelligence Pipeline)"
YC_API_BASE = "https://www.ycombinator.com/companies"

# ─── Database ───

def get_db():
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("ERROR: DATABASE_URL required", file=sys.stderr)
        sys.exit(1)
    return psycopg2.connect(url)


def ensure_batch(cur, batch_name: str) -> str:
    """Find or create a YC batch."""
    cur.execute("SELECT id FROM yc_batches WHERE name = %s", (batch_name,))
    row = cur.fetchone()
    if row:
        return row[0]

    season = "winter" if batch_name.startswith("W") else "summer"
    try:
        year = int("20" + batch_name[1:]) if len(batch_name) == 3 else int(batch_name[1:])
    except:
        year = 2000
    batch_id = str(uuid.uuid4())
    cur.execute(
        "INSERT INTO yc_batches (id, name, season, year) VALUES (%s, %s, %s, %s)",
        (batch_id, batch_name, season, year),
    )
    return batch_id


def insert_company(cur, company: dict, batch_id: str | None) -> str | None:
    """Insert a company, skip if slug already exists."""
    cur.execute("SELECT id FROM yc_companies WHERE slug = %s", (company.get("slug"),))
    if cur.fetchone():
        return None

    company_id = str(uuid.uuid4())
    cur.execute(
        """INSERT INTO yc_companies
           (id, name, slug, description, long_description, batch_id, industry,
            sub_industry, status, team_size, url, tags, scraped_at)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (
            company_id,
            company.get("name", ""),
            company.get("slug"),
            company.get("one_liner"),
            company.get("long_description"),
            batch_id,
            company.get("industry"),
            company.get("subindustry"),
            company.get("status", "active"),
            company.get("team_size") or None,
            company.get("website"),
            json.dumps(company.get("tags", [])),
            datetime.now(timezone.utc),
        ),
    )
    return company_id


def insert_founders(cur, company_id: str, founders: list):
    """Insert founders for a company."""
    for f in founders:
        cur.execute(
            """INSERT INTO yc_founders
               (id, company_id, name, role, bio, linkedin_url, twitter_url)
               VALUES (%s, %s, %s, %s, %s, %s, %s)""",
            (
                str(uuid.uuid4()),
                company_id,
                f.get("full_name", f.get("name", "")),
                f.get("title"),
                f.get("bio"),
                f.get("linkedin_url"),
                f.get("twitter_url"),
            ),
        )


def log_ingestion(cur, source_url: str, item_count: int, status: str, raw_storage_path: str = None, is_replay: bool = False, original_record_id: str = None, error: str = None):
    """Record ingestion provenance (Section 39.4)."""
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
            source_url,
            "scrape",
            True,  # YC directory is public
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


# ─── Fetching ───

def fetch_yc_companies(batch: str | None = None, limit: int | None = None) -> list[dict]:
    """
    Fetch companies from YC's Algolia-powered search API.
    This is the same API the public directory uses.
    """
    companies = []
    page = 0
    per_page = 100

    while True:
        params = {
            "page": page,
            "hitsPerPage": per_page,
            "facetFilters": [],
        }
        if batch:
            params["facetFilters"] = [f"batch:{batch}"]

        # YC uses Algolia for their directory search
        url = "https://45bwzj1sgc-dsn.algolia.net/1/indexes/YCCompany_production/query"
        headers = {
            "User-Agent": USER_AGENT,
            "x-algolia-application-id": "45BWZJ1SGC",
            "x-algolia-api-key": "MjBjYjRiMzY0NzdhZWY0NjExY2NhZjYxMGIxYjc2MTAwNWFkNTkwNTc4NjgxYjU0YzFhYTY2ZGQ5OGY5NDMxZnJlc3RyaWN0SW5kaWNlcz0lNUIlMjJZQ0NvbXBhbnlfcHJvZHVjdGlvbiUyMiU1RCZ0YWdGaWx0ZXJzPSU1QiUyMnljZGNfcHVibGljJTIyJTVEJmFuYWx5dGljc1RhZ3M9JTVCJTIyeWNkYyUyMiU1RA==",
            "Content-Type": "application/json",
        }

        body = json.dumps({
            "query": "",
            "page": page,
            "hitsPerPage": per_page,
            "facetFilters": params["facetFilters"],
        }).encode()

        try:
            req = Request(url, data=body, headers=headers, method="POST")
            with urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read())
        except (HTTPError, Exception) as e:
            print(f"  Fetch error on page {page}: {e}", file=sys.stderr)
            break

        hits = data.get("hits", [])
        if not hits:
            break

        companies.extend(hits)
        print(f"  Fetched page {page}: {len(hits)} companies (total: {len(companies)})")

        if limit and len(companies) >= limit:
            companies = companies[:limit]
            break

        if page >= data.get("nbPages", 0) - 1:
            break

        page += 1
        time.sleep(0.5)  # polite rate limiting

    return companies


def save_raw_capture(companies: list[dict]) -> str:
    """Save the raw JSON payload to disk/storage for provenance."""
    base_dir = os.environ.get("STORAGE_PATH", "./data/storage")
    capture_dir = os.path.join(base_dir, "raw", "yc_companies")
    os.makedirs(capture_dir, exist_ok=True)
    
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filepath = os.path.join(capture_dir, f"capture_{timestamp}.json")
    
    with open(filepath, "w") as f:
        json.dump(companies, f, indent=2)
    
    return filepath


# ─── Main ───

def main():
    parser = argparse.ArgumentParser(description="HELM Pilot YC Intelligence Pipeline")
    parser.add_argument("--batch", help="Specific YC batch (e.g., W24, S23)")
    parser.add_argument("--limit", type=int, help="Max companies to fetch")
    parser.add_argument("--dry-run", action="store_true", help="Print without DB writes")
    parser.add_argument("--replay", help="Path to a raw JSON capture file to replay")
    args = parser.parse_args()

    print(f"HELM Pilot YC Intelligence Pipeline v{PARSER_VERSION}")
    print(f"  Batch filter: {args.batch or 'all'}")
    print(f"  Limit: {args.limit or 'none'}")
    print(f"  Dry run: {args.dry_run}")
    print(f"  Replay: {args.replay or 'no'}")
    print()

    # Fetch or Replay
    raw_path = None
    if args.replay:
        print(f"Replaying from {args.replay}...")
        with open(args.replay, "r") as f:
            companies = json.load(f)
        raw_path = args.replay
    else:
        print("Fetching YC companies...")
        companies = fetch_yc_companies(batch=args.batch, limit=args.limit)
        if not args.dry_run and companies:
            raw_path = save_raw_capture(companies)
            print(f"Saved raw capture to {raw_path}")

    print(f"Loaded {len(companies)} companies total.")

    if args.dry_run:
        for c in companies[:5]:
            print(f"  {c.get('name')} ({c.get('batch')}) — {c.get('one_liner', '')[:80]}")
        if len(companies) > 5:
            print(f"  ... and {len(companies) - 5} more")
        return

    # Store
    print("Writing to database...")
    conn = get_db()
    cur = conn.cursor()

    inserted = 0
    skipped = 0

    try:
        for company in companies:
            batch_name = company.get("batch")
            batch_id = ensure_batch(cur, batch_name) if batch_name else None

            company_id = insert_company(cur, company, batch_id)
            if company_id:
                founders = company.get("founders", [])
                if founders:
                    insert_founders(cur, company_id, founders)
                inserted += 1
            else:
                skipped += 1

        log_ingestion(cur, YC_API_BASE, inserted, "parsed", raw_storage_path=raw_path, is_replay=bool(args.replay))
        conn.commit()

        print(f"Done: {inserted} inserted, {skipped} skipped (already existed)")

    except Exception as e:
        conn.rollback()
        log_ingestion(cur, YC_API_BASE, 0, "failed", raw_storage_path=raw_path, is_replay=bool(args.replay), error=str(e))
        conn.commit()
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
