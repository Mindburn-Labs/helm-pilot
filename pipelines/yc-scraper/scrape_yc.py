#!/usr/bin/env python3
"""
Pilot — YC public company ingestion via Scrapling.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import uuid
from pathlib import Path

PIPELINES_ROOT = Path(__file__).resolve().parents[1]
if str(PIPELINES_ROOT) not in sys.path:
    sys.path.append(str(PIPELINES_ROOT))

from scraper.lib.scrapling_adapter import fetch_json  # noqa: E402
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
    touch_checkpoint,
    utcnow,
)

PARSER_VERSION = "0.3.0-scrapling"
USER_AGENT = "Pilot/0.3.0 (YC Public Intelligence)"
YC_DIRECTORY_URL = "https://www.ycombinator.com/companies"
YC_ALGOLIA_URL = "https://45bwzj1sgc-dsn.algolia.net/1/indexes/YCCompany_production/query"


def ensure_batch(cur, batch_name: str) -> str:
    cur.execute("SELECT id FROM yc_batches WHERE name = %s", (batch_name,))
    row = cur.fetchone()
    if row:
        return row[0]

    season = "winter" if batch_name.startswith("W") else "summer"
    try:
        year = int("20" + batch_name[1:]) if len(batch_name) == 3 else int(batch_name[1:])
    except Exception:
        year = 2000
    batch_id = str(uuid.uuid4())
    cur.execute(
        "INSERT INTO yc_batches (id, name, season, year) VALUES (%s, %s, %s, %s)",
        (batch_id, batch_name, season, year),
    )
    return batch_id


def insert_company(cur, company: dict, batch_id: str | None) -> str | None:
    cur.execute("SELECT id FROM yc_companies WHERE slug = %s", (company.get("slug"),))
    if cur.fetchone():
        return None

    company_id = str(uuid.uuid4())
    cur.execute(
        """
        INSERT INTO yc_companies
          (id, name, slug, description, long_description, batch_id, industry,
           sub_industry, status, team_size, url, tags, scraped_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
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
            utcnow(),
        ),
    )
    return company_id


def insert_founders(cur, company_id: str, founders: list[dict]) -> None:
    for founder in founders:
        cur.execute(
            """
            INSERT INTO yc_founders
              (id, company_id, name, role, bio, linkedin_url, twitter_url)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                str(uuid.uuid4()),
                company_id,
                founder.get("full_name", founder.get("name", "")),
                founder.get("title"),
                founder.get("bio"),
                founder.get("linkedin_url"),
                founder.get("twitter_url"),
            ),
        )


def fetch_yc_companies(batch: str | None = None, limit: int | None = None) -> tuple[list[dict], int]:
    companies: list[dict] = []
    page = 0
    per_page = 100

    while True:
        payload = {
            "query": "",
            "page": page,
            "hitsPerPage": per_page,
            "facetFilters": [f"batch:{batch}"] if batch else [],
        }
        data = fetch_json(
            YC_ALGOLIA_URL,
            method="POST",
            strategy="fetcher",
            adaptive_domain="ycombinator.com",
            headers={
                "User-Agent": USER_AGENT,
                "x-algolia-application-id": "45BWZJ1SGC",
                "x-algolia-api-key": "MjBjYjRiMzY0NzdhZWY0NjExY2NhZjYxMGIxYjc2MTAwNWFkNTkwNTc4NjgxYjU0YzFhYTY2ZGQ5OGY5NDMxZnJlc3RyaWN0SW5kaWNlcz0lNUIlMjJZQ0NvbXBhbnlfcHJvZHVjdGlvbiUyMiU1RCZ0YWdGaWx0ZXJzPSU1QiUyMnljZGNfcHVibGljJTIyJTVEJmFuYWx5dGljc1RhZ3M9JTVCJTIyeWNkYyUyMiU1RA==",
                "Content-Type": "application/json",
            },
            json_body=payload,
            timeout=30,
        )

        hits = data.get("hits", [])
        if not hits:
            break

        companies.extend(hits)
        print(f"  fetched page {page}: {len(hits)} companies (total {len(companies)})")

        if limit and len(companies) >= limit:
            companies = companies[:limit]
            break

        if page >= data.get("nbPages", 0) - 1:
            break

        page += 1
        time.sleep(0.25)

    return companies, page + 1


def main() -> None:
    parser = argparse.ArgumentParser(description="Pilot YC public company scraper")
    parser.add_argument("--batch", help="Specific YC batch, e.g. W24")
    parser.add_argument("--limit", type=int, help="Max companies to fetch")
    parser.add_argument("--dry-run", action="store_true", help="Print without DB writes")
    parser.add_argument("--replay", help="Replay from a raw JSON capture")
    parser.add_argument("--workspace-id", help="Optional workspace id for provenance")
    args = parser.parse_args()

    print(f"Pilot YC public scrape v{PARSER_VERSION}")
    print(f"  batch: {args.batch or 'all'}")
    print(f"  limit: {args.limit or 'none'}")
    print(f"  replay: {args.replay or 'no'}")
    print(f"  dry-run: {args.dry_run}")

    crawl_checkpoint_dir = crawl_dir("yc-public-companies")
    if args.replay:
        companies = json.loads(Path(args.replay).read_text())
        raw_path = args.replay
        fetched_pages = 0
    else:
        companies, fetched_pages = fetch_yc_companies(batch=args.batch, limit=args.limit)
        raw_path = None

    print(f"Loaded {len(companies)} companies")
    if args.dry_run:
        for company in companies[:5]:
            print(f"  {company.get('name')} ({company.get('batch')}) — {company.get('one_liner', '')[:80]}")
        return

    conn = get_db()
    cur = conn.cursor()
    crawl_run_id: str | None = None
    ingestion_record_id: str | None = None

    try:
        source_id = ensure_crawl_source(
            cur,
            workspace_id=args.workspace_id,
            name="yc-public-companies",
            domain="www.ycombinator.com",
            source_type="yc_directory",
            fetch_strategy="fetcher",
            auth_requirement="public",
            parser_version=PARSER_VERSION,
            schedule="0 3 * * 0",
            config={"replay": bool(args.replay), "batch": args.batch, "limit": args.limit},
        )
        ingestion_record_id = create_ingestion_record(
            cur,
            source_origin=YC_DIRECTORY_URL,
            source_type="scrape",
            is_public=True,
            parser_version=PARSER_VERSION,
            metadata={"batch": args.batch, "limit": args.limit, "replay": bool(args.replay)},
            raw_storage_path=raw_path,
        )
        crawl_run_id = create_crawl_run(
            cur,
            source_id=source_id,
            workspace_id=args.workspace_id,
            ingestion_record_id=ingestion_record_id,
            mode="replay" if args.replay else "public",
            checkpoint_dir=crawl_checkpoint_dir,
            metadata={"fetchedPages": fetched_pages},
        )

        if not raw_path:
            raw_path, size_bytes, checksum = save_json_capture("yc_companies", companies, "capture")
            record_raw_capture(
                cur,
                crawl_run_id=crawl_run_id,
                source_url=YC_ALGOLIA_URL,
                content_type="application/json",
                storage_path=raw_path,
                size_bytes=size_bytes,
                checksum=checksum,
                metadata={"hits": len(companies)},
            )

        inserted = 0
        skipped = 0
        for company in companies:
            batch_name = company.get("batch")
            batch_id = ensure_batch(cur, batch_name) if batch_name else None
            company_id = insert_company(cur, company, batch_id)
            if company_id:
                insert_founders(cur, company_id, company.get("founders", []))
                inserted += 1
            else:
                skipped += 1

        touch_checkpoint(
            cur,
            run_id=crawl_run_id,
            checkpoint_key="yc-public-companies",
            storage_path=crawl_checkpoint_dir,
            cursor=str(fetched_pages),
            last_seen_url=YC_ALGOLIA_URL,
            metadata={"batch": args.batch, "limit": args.limit},
        )
        finalize_ingestion_record(
            cur,
            record_id=ingestion_record_id,
            status="parsed",
            item_count=inserted,
            raw_storage_path=raw_path,
        )
        finalize_crawl_run(cur, run_id=crawl_run_id, status="completed", item_count=inserted)
        conn.commit()
        print(f"Done: {inserted} inserted, {skipped} skipped")
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
