#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from typing import Any
from unittest import TestCase, main


def load_common():
    spec = importlib.util.spec_from_file_location(
        "yc_scraper_common",
        Path(__file__).with_name("common.py"),
    )
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


common = load_common()

WORKSPACE_ID = "00000000-0000-4000-8000-000000000001"
RECORD_ID = "00000000-0000-4000-8000-000000000002"


class FakeCursor:
    def __init__(self, ingestion_row: tuple[Any, ...] | None = None):
        self.ingestion_row = ingestion_row
        self.calls: list[tuple[str, tuple[Any, ...] | None]] = []
        self._fetchone: tuple[Any, ...] | None = None

    def execute(self, sql: str, params: tuple[Any, ...] | None = None) -> None:
        normalized = " ".join(sql.split())
        self.calls.append((normalized, params))
        if normalized.startswith("SELECT source_origin, source_type, is_public"):
            self._fetchone = self.ingestion_row
        else:
            self._fetchone = None

    def fetchone(self) -> tuple[Any, ...] | None:
        return self._fetchone

    def calls_containing(self, fragment: str) -> list[tuple[str, tuple[Any, ...] | None]]:
        return [(sql, params) for sql, params in self.calls if fragment in sql]


class IngestionEvidenceTests(TestCase):
    def test_create_ingestion_record_stores_workspace_in_metadata(self) -> None:
        cur = FakeCursor()

        common.create_ingestion_record(
            cur,
            source_origin="https://www.ycombinator.com/companies",
            source_type="scrape",
            is_public=True,
            parser_version="0.3.0-scrapling",
            workspace_id=WORKSPACE_ID,
            metadata={"batch": "W26"},
            raw_storage_path="/tmp/capture.json",
        )

        insert_call = cur.calls_containing("INSERT INTO ingestion_records")[0]
        metadata = json.loads(insert_call[1][-1])
        self.assertEqual(metadata["workspaceId"], WORKSPACE_ID)
        self.assertEqual(metadata["batch"], "W26")

    def test_finalize_ingestion_record_appends_sanitized_evidence_for_workspace_record(self) -> None:
        cur = FakeCursor(
            (
                "https://www.ycombinator.com/cofounder-matching",
                "authorized_session",
                False,
                "0.3.0-scrapling",
                "/tmp/session_probe.html",
                json.dumps(
                    {
                        "workspaceId": WORKSPACE_ID,
                        "grantId": "grant_123",
                        "sessionType": "browser",
                        "action": "sync",
                        "token": "do-not-index",
                    }
                ),
            )
        )

        common.finalize_ingestion_record(
            cur,
            record_id=RECORD_ID,
            status="parsed",
            item_count=7,
            raw_storage_path="/tmp/candidate_sync.json",
        )

        insert_call = cur.calls_containing("INSERT INTO evidence_items")[0]
        params = insert_call[1]
        assert params is not None
        metadata = json.loads(params[10])

        self.assertEqual(params[0], WORKSPACE_ID)
        self.assertEqual(params[1], "ingestion_record_parsed")
        self.assertEqual(params[2], "yc_scraper_ingestion")
        self.assertEqual(params[5], "redacted")
        self.assertEqual(params[6], "sensitive")
        self.assertEqual(params[8], "/tmp/candidate_sync.json")
        self.assertEqual(params[9], f"yc-ingestion:{RECORD_ID}:parsed")
        self.assertEqual(metadata["ingestionRecordId"], RECORD_ID)
        self.assertEqual(metadata["grantId"], "grant_123")
        self.assertEqual(metadata["itemCount"], 7)
        self.assertNotIn("token", metadata)
        self.assertNotIn("do-not-index", json.dumps(metadata))

    def test_finalize_ingestion_record_skips_evidence_without_workspace_scope(self) -> None:
        cur = FakeCursor(
            (
                "https://www.ycombinator.com/library",
                "scrape",
                True,
                "0.3.0-scrapling",
                "/tmp/library.json",
                json.dumps({"limit": 10}),
            )
        )

        common.finalize_ingestion_record(
            cur,
            record_id=RECORD_ID,
            status="parsed",
            item_count=10,
        )

        self.assertEqual(cur.calls_containing("INSERT INTO evidence_items"), [])

    def test_failed_ingestion_evidence_excludes_error_text(self) -> None:
        cur = FakeCursor(
            (
                "https://www.ycombinator.com/companies",
                "scrape",
                True,
                "0.3.0-scrapling",
                "/tmp/companies.json",
                json.dumps({"workspace_id": WORKSPACE_ID}),
            )
        )

        common.finalize_ingestion_record(
            cur,
            record_id=RECORD_ID,
            status="failed",
            item_count=0,
            error="token=secret should stay only on ingestion_records",
        )

        insert_call = cur.calls_containing("INSERT INTO evidence_items")[0]
        params = insert_call[1]
        assert params is not None
        metadata = json.loads(params[10])

        self.assertEqual(params[1], "ingestion_record_failed")
        self.assertEqual(params[6], "public")
        self.assertTrue(metadata["hasError"])
        self.assertNotIn("secret", params[4])
        self.assertNotIn("secret", json.dumps(metadata))


if __name__ == "__main__":
    main()
