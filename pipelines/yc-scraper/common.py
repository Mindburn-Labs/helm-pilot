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
    workspace_id: str | None = None,
    metadata: dict[str, Any] | None = None,
    raw_storage_path: str | None = None,
) -> str:
    record_id = str(uuid.uuid4())
    record_metadata = dict(metadata or {})
    if workspace_id:
        record_metadata.setdefault("workspaceId", workspace_id)
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
            json.dumps(record_metadata),
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
    context = load_ingestion_record_evidence_context(cur, record_id)
    if context:
        context["raw_storage_path"] = raw_storage_path or context.get("raw_storage_path")
        append_ingestion_evidence_item(
            cur,
            record_id=record_id,
            status=status,
            item_count=item_count,
            error=error,
            **context,
        )


def load_ingestion_record_evidence_context(cur, record_id: str) -> dict[str, Any] | None:
    cur.execute(
        """
        SELECT source_origin, source_type, is_public, parser_version, raw_storage_path, metadata
        FROM ingestion_records
        WHERE id = %s
        """,
        (record_id,),
    )
    row = cur.fetchone()
    if not row:
        return None
    source_origin, source_type, is_public, parser_version, raw_storage_path, metadata = row
    parsed_metadata = coerce_json_object(metadata)
    return {
        "source_origin": source_origin,
        "source_type": source_type,
        "is_public": bool(is_public),
        "parser_version": parser_version,
        "workspace_id": metadata_workspace_id(parsed_metadata),
        "raw_storage_path": raw_storage_path,
        "metadata": parsed_metadata,
    }


def append_ingestion_evidence_item(
    cur,
    *,
    record_id: str,
    source_origin: str,
    source_type: str,
    is_public: bool,
    parser_version: str,
    workspace_id: str | None,
    status: str,
    item_count: int,
    raw_storage_path: str | None,
    error: str | None,
    metadata: dict[str, Any],
) -> None:
    if not workspace_id:
        return

    evidence_status = normalized_status(status)
    evidence_type = {
        "parsed": "ingestion_record_parsed",
        "failed": "ingestion_record_failed",
    }.get(evidence_status, "ingestion_record_finalized")
    sensitivity = "public" if is_public else "sensitive"
    evidence_metadata = {
        "ingestionRecordId": record_id,
        "sourceOrigin": source_origin,
        "sourceType": source_type,
        "isPublic": is_public,
        "parserVersion": parser_version,
        "status": status,
        "itemCount": item_count,
        "hasError": bool(error),
        "productionReady": False,
        "credentialBoundary": "no_session_or_token_material_in_evidence",
    }
    if "grantId" in metadata:
        evidence_metadata["grantId"] = metadata["grantId"]
    if "sessionType" in metadata:
        evidence_metadata["sessionType"] = metadata["sessionType"]
    if "action" in metadata:
        evidence_metadata["action"] = metadata["action"]

    content_hash = (
        f"sha256:{hashlib.sha256(stable_json(evidence_metadata).encode('utf-8')).hexdigest()}"
    )
    summary = f"YC ingestion record {record_id} finalized with status {status} and {item_count} items."
    if error:
        summary = f"{summary} Error details are retained on ingestion_records and excluded from evidence metadata."

    cur.execute(
        """
        INSERT INTO evidence_items
          (workspace_id, evidence_type, source_type, title, summary, redaction_state,
           sensitivity, content_hash, storage_ref, replay_ref, metadata, observed_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            workspace_id,
            evidence_type,
            "yc_scraper_ingestion",
            f"YC ingestion {status}: {source_type}",
            summary,
            "redacted",
            sensitivity,
            content_hash,
            raw_storage_path,
            f"yc-ingestion:{record_id}:{evidence_status}",
            json.dumps(evidence_metadata),
            utcnow(),
        ),
    )


def coerce_json_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value:
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def metadata_workspace_id(metadata: dict[str, Any]) -> str | None:
    workspace_id = metadata.get("workspaceId") or metadata.get("workspace_id")
    return workspace_id if isinstance(workspace_id, str) and workspace_id else None


def normalized_status(status: str) -> str:
    return "".join(ch if ch.isalnum() else "_" for ch in status.lower()).strip("_")


def stable_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


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
        raw = "pilot-dev-key-do-not-use-in-prod"
    return hashlib.scrypt(raw.encode("utf-8"), salt=b"pilot-salt", n=16384, r=8, p=1, dklen=32)


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
