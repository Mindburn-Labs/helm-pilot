#!/usr/bin/env python3
"""
HELM Pilot — founder-authorized YC private automation and cofounder matching sync.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import uuid
from pathlib import Path

PIPELINES_ROOT = Path(__file__).resolve().parents[1]
if str(PIPELINES_ROOT) not in sys.path:
    sys.path.append(str(PIPELINES_ROOT))

from scraper.lib.scrapling_adapter import fetch_html  # noqa: E402
from common import (  # noqa: E402
    create_crawl_run,
    create_ingestion_record,
    crawl_dir,
    ensure_crawl_source,
    finalize_crawl_run,
    finalize_ingestion_record,
    get_db,
    load_session_for_grant,
    record_raw_capture,
    save_json_capture,
    save_text_capture,
)

PARSER_VERSION = "0.3.0-scrapling"
MATCHING_URL = "https://www.ycombinator.com/cofounder-matching"


def response_looks_authenticated(response) -> bool:
    text = response.get_all_text(separator="\n", strip=True).lower()
    blocked_markers = ("log in", "sign in", "create an account")
    if any(marker in text[:4000] for marker in blocked_markers):
        return False
    if "login" in response.url or "signin" in response.url:
        return False
    return True


def extract_candidate_cards(response, limit: int | None) -> list[dict]:
    cards = []
    link_nodes = response.css(
        "a[href*='/cofounder-matching/']",
        identifier="yc_matching_links",
        adaptive=True,
        auto_save=True,
    )

    seen = set()
    for node in link_nodes:
        href = node.attrib.get("href") or ""
        full_url = response.urljoin(href)
        if full_url in seen:
            continue
        if any(skip in full_url for skip in ("/settings", "/messages", "/favorites", "/sign")):
            continue
        seen.add(full_url)
        text = node.get_all_text(strip=True)
        if len(text) < 3:
            continue
        cards.append({
            "profileUrl": full_url,
            "name": text[:200],
            "headline": "",
            "bio": "",
            "rawProfile": {"linkText": text},
        })
        if limit and len(cards) >= limit:
            break

    return cards


def extract_candidate_profile(response) -> dict:
    title_nodes = response.css("h1", identifier="yc_matching_name", adaptive=True, auto_save=True)
    subtitle_nodes = response.css("h2, h3", identifier="yc_matching_headline", adaptive=True, auto_save=True)
    main_nodes = response.css("main", identifier="yc_matching_main", adaptive=True, auto_save=True)
    name = title_nodes[0].get_all_text(strip=True) if title_nodes else "Unknown Candidate"
    headline = subtitle_nodes[0].get_all_text(strip=True) if subtitle_nodes else ""
    bio = main_nodes[0].get_all_text(separator="\n", strip=True)[:10000] if main_nodes else ""
    return {
        "profileUrl": response.url,
        "name": name[:200],
        "headline": headline[:500],
        "bio": bio,
        "rawProfile": {"html": response.html_content},
    }


def upsert_candidate_source(cur, workspace_id: str, profile: dict) -> str:
    external_id = profile["profileUrl"].rstrip("/").split("/")[-1]
    cur.execute(
        """
        SELECT id FROM cofounder_candidate_sources
        WHERE workspace_id = %s AND source = 'yc_matching' AND external_id = %s
        LIMIT 1
        """,
        (workspace_id, external_id),
    )
    row = cur.fetchone()
    raw_profile = json.dumps(profile.get("rawProfile") or {})
    if row:
        cur.execute(
            """
            UPDATE cofounder_candidate_sources
            SET profile_url = %s,
                raw_profile = %s,
                updated_at = NOW()
            WHERE id = %s
            """,
            (profile["profileUrl"], raw_profile, row[0]),
        )
        return row[0]

    source_id = str(uuid.uuid4())
    cur.execute(
        """
        INSERT INTO cofounder_candidate_sources
          (id, workspace_id, source, external_id, profile_url, raw_profile, imported_at, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, NOW(), NOW())
        """,
        (source_id, workspace_id, "yc_matching", external_id, profile["profileUrl"], raw_profile),
    )
    return source_id


def upsert_candidate(cur, workspace_id: str, source_id: str, profile: dict) -> None:
    cur.execute(
        """
        SELECT id FROM cofounder_candidates
        WHERE workspace_id = %s AND profile_url = %s
        LIMIT 1
        """,
        (workspace_id, profile["profileUrl"]),
    )
    row = cur.fetchone()
    metadata = json.dumps({"ingestedFrom": "yc_matching"})
    if row:
        cur.execute(
            """
            UPDATE cofounder_candidates
            SET source_id = %s,
                name = %s,
                headline = %s,
                bio = %s,
                metadata = %s,
                updated_at = NOW()
            WHERE id = %s
            """,
            (source_id, profile["name"], profile["headline"], profile["bio"], metadata, row[0]),
        )
        return

    cur.execute(
        """
        INSERT INTO cofounder_candidates
          (id, workspace_id, source_id, name, headline, bio, profile_url, strengths, interests,
           preferred_roles, status, metadata, created_at, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
        """,
        (
            str(uuid.uuid4()),
            workspace_id,
            source_id,
            profile["name"],
            profile["headline"],
            profile["bio"],
            profile["profileUrl"],
            json.dumps([]),
            json.dumps([]),
            json.dumps([]),
            "reviewing",
            metadata,
        ),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="HELM Pilot YC private automation")
    parser.add_argument("--grant-id", required=True, help="Connector grant id for the stored YC session")
    parser.add_argument("--action", choices=["validate", "sync"], default="sync")
    parser.add_argument("--limit", type=int, default=25)
    parser.add_argument("--workspace-id", help="Workspace id for candidate import")
    args = parser.parse_args()

    conn = get_db()
    cur = conn.cursor()

    session_data, session_type = load_session_for_grant(cur, args.grant_id)
    response = fetch_html(
        MATCHING_URL,
        strategy="stealthy",
        session_data=session_data,
        wait_selector="main",
        timeout_ms=45_000,
    )
    if not response_looks_authenticated(response):
        raise RuntimeError("Stored YC session is not valid for authenticated cofounder matching access")

    html_path, html_size, html_checksum = save_text_capture("yc_matching", response.html_content, "session_probe", "html")

    source_id = ensure_crawl_source(
        cur,
        workspace_id=args.workspace_id,
        name="yc-private-matching",
        domain="www.ycombinator.com",
        source_type="yc_matching",
        fetch_strategy="stealthy",
        auth_requirement="session",
        parser_version=PARSER_VERSION,
        config={"grantId": args.grant_id, "sessionType": session_type, "action": args.action},
    )
    ingestion_record_id = create_ingestion_record(
        cur,
        source_origin=MATCHING_URL,
        source_type="authorized_session",
        is_public=False,
        parser_version=PARSER_VERSION,
        metadata={"grantId": args.grant_id, "sessionType": session_type, "action": args.action},
        raw_storage_path=html_path,
    )
    crawl_run_id = create_crawl_run(
        cur,
        source_id=source_id,
        workspace_id=args.workspace_id,
        ingestion_record_id=ingestion_record_id,
        mode="private",
        checkpoint_dir=crawl_dir(f"yc-private-{args.grant_id}"),
        metadata={"action": args.action},
    )

    record_raw_capture(
        cur,
        crawl_run_id=crawl_run_id,
        source_url=MATCHING_URL,
        content_type="text/html",
        storage_path=html_path,
        size_bytes=html_size,
        checksum=html_checksum,
        metadata={"action": args.action},
    )

    if args.action == "validate":
        finalize_ingestion_record(
            cur,
            record_id=ingestion_record_id,
            status="parsed",
            item_count=1,
            raw_storage_path=html_path,
        )
        finalize_crawl_run(cur, run_id=crawl_run_id, status="completed", item_count=1)
        conn.commit()
        print("YC session validation succeeded")
        cur.close()
        conn.close()
        return

    if not args.workspace_id:
        raise RuntimeError("--workspace-id is required for YC matching sync")

    candidates = extract_candidate_cards(response, args.limit)
    enriched: list[dict] = []
    for card in candidates:
        try:
            profile_response = fetch_html(
                card["profileUrl"],
                strategy="stealthy",
                session_data=session_data,
                wait_selector="main",
                timeout_ms=45_000,
            )
            if response_looks_authenticated(profile_response):
                enriched.append(extract_candidate_profile(profile_response))
            else:
                enriched.append(card)
        except Exception:
            enriched.append(card)

    raw_path, raw_size, raw_checksum = save_json_capture("yc_matching", enriched, "candidate_sync")
    record_raw_capture(
        cur,
        crawl_run_id=crawl_run_id,
        source_url=MATCHING_URL,
        content_type="application/json",
        storage_path=raw_path,
        size_bytes=raw_size,
        checksum=raw_checksum,
        metadata={"candidates": len(enriched)},
    )

    inserted = 0
    for profile in enriched:
        if not re.search(r"[A-Za-z]", profile.get("name", "")):
            continue
        source_row_id = upsert_candidate_source(cur, args.workspace_id, profile)
        upsert_candidate(cur, args.workspace_id, source_row_id, profile)
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
    print(f"YC private sync completed: {inserted} candidates")
    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
