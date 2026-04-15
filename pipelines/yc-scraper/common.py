#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psycopg2
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def get_db():
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("ERROR: DATABASE_URL required", file=sys.stderr)
        sys.exit(1)
    return psycopg2.connect(url)


def storage_root() -> Path:
    return Path(os.environ.get("STORAGE_PATH", "./data/storage")).resolve()


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def save_json_capture(namespace: str, payload: Any, filename_hint: str = "capture") -> tuple[str, int, str]:
    capture_dir = ensure_dir(storage_root() / "raw" / namespace)
    timestamp = utcnow().strftime("%Y%m%d_%H%M%S")
    filepath = capture_dir / f"{filename_hint}_{timestamp}.json"
    encoded = json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8")
    filepath.write_bytes(encoded)
    checksum = hashlib.sha256(encoded).hexdigest()
    return str(filepath), len(encoded), checksum


def save_text_capture(namespace: str, payload: str, filename_hint: str = "capture", suffix: str = "html") -> tuple[str, int, str]:
    capture_dir = ensure_dir(storage_root() / "raw" / namespace)
    timestamp = utcnow().strftime("%Y%m%d_%H%M%S")
    filepath = capture_dir / f"{filename_hint}_{timestamp}.{suffix}"
    encoded = payload.encode("utf-8")
    filepath.write_bytes(encoded)
    checksum = hashlib.sha256(encoded).hexdigest()
    return str(filepath), len(encoded), checksum


def crawl_dir(namespace: str) -> str:
    return str(ensure_dir(storage_root() / "crawls" / namespace))


def ensure_crawl_source(
    cur,
    *,
    workspace_id: str | None,
    name: str,
    domain: str,
    source_type: str,
    fetch_strategy: str,
    auth_requirement: str,
    parser_version: str,
    schedule: str | None = None,
    escalation_policy: str = "retry_stealthy",
    config: dict[str, Any] | None = None,
) -> str:
    cur.execute(
        """
        SELECT id
        FROM crawl_sources
        WHERE name = %s
          AND domain = %s
          AND workspace_id IS NOT DISTINCT FROM %s
        LIMIT 1
        """,
        (name, domain, workspace_id),
    )
    row = cur.fetchone()
    if row:
        source_id = row[0]
        cur.execute(
            """
            UPDATE crawl_sources
            SET fetch_strategy = %s,
                auth_requirement = %s,
                parser_version = %s,
                schedule = %s,
                escalation_policy = %s,
                config = %s,
                updated_at = %s
            WHERE id = %s
            """,
            (
                fetch_strategy,
                auth_requirement,
                parser_version,
                schedule,
                escalation_policy,
                json.dumps(config or {}),
                utcnow(),
                source_id,
            ),
        )
        return source_id

    source_id = str(uuid.uuid4())
    cur.execute(
        """
        INSERT INTO crawl_sources
          (id, workspace_id, name, domain, source_type, fetch_strategy, auth_requirement,
           parser_version, schedule, escalation_policy, config)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            source_id,
            workspace_id,
            name,
            domain,
            source_type,
            fetch_strategy,
            auth_requirement,
            parser_version,
            schedule,
            escalation_policy,
            json.dumps(config or {}),
        ),
    )
    return source_id


def create_ingestion_record(
    cur,
    *,
    source_origin: str,
    source_type: str,
    is_public: bool,
    parser_version: str,
    metadata: dict[str, Any] | None = None,
    raw_storage_path: str | None = None,
) -> str:
    record_id = str(uuid.uuid4())
    cur.execute(
        """
        INSERT INTO ingestion_records
          (id, source_origin, source_type, is_public, parser_version,
           fetched_at, status, raw_storage_path, metadata)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            record_id,
            source_origin,
            source_type,
            is_public,
            parser_version,
            utcnow(),
            "pending",
            raw_storage_path,
            json.dumps(metadata or {}),
        ),
    )
    return record_id


def finalize_ingestion_record(
    cur,
    *,
    record_id: str,
    status: str,
    item_count: int,
    raw_storage_path: str | None = None,
    error: str | None = None,
) -> None:
    cur.execute(
        """
        UPDATE ingestion_records
        SET parsed_at = %s,
            item_count = %s,
            status = %s,
            raw_storage_path = COALESCE(%s, raw_storage_path),
            error = %s
        WHERE id = %s
        """,
        (utcnow(), item_count, status, raw_storage_path, error, record_id),
    )


def create_crawl_run(
    cur,
    *,
    source_id: str,
    workspace_id: str | None,
    ingestion_record_id: str,
    mode: str,
    checkpoint_dir: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> str:
    run_id = str(uuid.uuid4())
    cur.execute(
        """
        INSERT INTO crawl_runs
          (id, source_id, ingestion_record_id, workspace_id, mode, status, checkpoint_dir, metadata, started_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
          run_id,
          source_id,
          ingestion_record_id,
          workspace_id,
          mode,
          "running",
          checkpoint_dir,
          json.dumps(metadata or {}),
          utcnow(),
        ),
    )
    return run_id


def finalize_crawl_run(cur, *, run_id: str, status: str, item_count: int, error: str | None = None) -> None:
    cur.execute(
        """
        UPDATE crawl_runs
        SET status = %s,
            item_count = %s,
            error = %s,
            completed_at = %s
        WHERE id = %s
        """,
        (status, item_count, error, utcnow(), run_id),
    )


def touch_checkpoint(
    cur,
    *,
    run_id: str,
    checkpoint_key: str,
    storage_path: str | None = None,
    cursor: str | None = None,
    last_seen_url: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    cur.execute(
        """
        SELECT id FROM crawl_checkpoints
        WHERE crawl_run_id = %s AND checkpoint_key = %s
        LIMIT 1
        """,
        (run_id, checkpoint_key),
    )
    row = cur.fetchone()
    if row:
        cur.execute(
            """
            UPDATE crawl_checkpoints
            SET storage_path = %s,
                cursor = %s,
                last_seen_url = %s,
                metadata = %s,
                updated_at = %s
            WHERE id = %s
            """,
            (
                storage_path,
                cursor,
                last_seen_url,
                json.dumps(metadata or {}),
                utcnow(),
                row[0],
            ),
        )
        return

    cur.execute(
        """
        INSERT INTO crawl_checkpoints
          (id, crawl_run_id, checkpoint_key, storage_path, cursor, last_seen_url, metadata, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            str(uuid.uuid4()),
            run_id,
            checkpoint_key,
            storage_path,
            cursor,
            last_seen_url,
            json.dumps(metadata or {}),
            utcnow(),
        ),
    )


def record_raw_capture(
    cur,
    *,
    crawl_run_id: str,
    source_url: str,
    content_type: str,
    storage_path: str,
    size_bytes: int,
    checksum: str,
    metadata: dict[str, Any] | None = None,
) -> None:
    cur.execute(
        """
        INSERT INTO raw_captures
          (id, crawl_run_id, source_url, content_type, storage_path, checksum, size_bytes, metadata, captured_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            str(uuid.uuid4()),
            crawl_run_id,
            source_url,
            content_type,
            storage_path,
            checksum,
            size_bytes,
            json.dumps(metadata or {}),
            utcnow(),
        ),
    )


def get_encryption_key() -> bytes:
    raw = os.environ.get("ENCRYPTION_KEY")
    if not raw:
        if os.environ.get("NODE_ENV") == "production":
            raise RuntimeError("ENCRYPTION_KEY is required in production")
        raw = "helm-pilot-dev-key-do-not-use-in-prod"
    return hashlib.scrypt(raw.encode("utf-8"), salt=b"helm-pilot-salt", n=16384, r=8, p=1, dklen=32)


def decrypt_session_payload(encoded: str) -> Any:
    raw = Path(encoded).read_text() if encoded.startswith("/") and Path(encoded).exists() else encoded
    packed = bytes.fromhex(raw) if raw.startswith("0x") else None
    if packed is None:
        import base64
        packed = base64.b64decode(raw)

    iv = packed[:16]
    tag = packed[16:32]
    ciphertext = packed[32:]
    plaintext = AESGCM(get_encryption_key()).decrypt(iv, ciphertext + tag, None)
    return json.loads(plaintext.decode("utf-8"))


def load_session_for_grant(cur, grant_id: str) -> tuple[Any, str | None]:
    cur.execute(
        """
        SELECT session_data_enc, session_type
        FROM connector_sessions
        WHERE grant_id = %s
        LIMIT 1
        """,
        (grant_id,),
    )
    row = cur.fetchone()
    if not row:
        raise RuntimeError(f"No stored connector session found for grant {grant_id}")
    return decrypt_session_payload(row[0]), row[1]
