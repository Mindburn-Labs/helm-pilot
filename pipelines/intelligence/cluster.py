#!/usr/bin/env python3
"""
HELM Pilot — HDBSCAN opportunity clustering with LLM-generated labels.

Generates workspace-scoped market-theme clusters from scored opportunities.
Each cluster gets:
  - A human-readable label (via LLM, fallback to top-3 tags)
  - A summary sentence explaining what binds the members
  - Centroid embedding for future nearest-neighbour queries
  - Member links with distance + representative flags

Usage:
  python -m pipelines.intelligence.cluster \\
    --workspace-id <uuid> \\
    --database-url postgresql://... \\
    [--min-cluster-size 3] \\
    [--min-samples 2] \\
    [--top-representatives 3]

Requires: hdbscan, numpy, scikit-learn, httpx, psycopg2-binary
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from datetime import datetime, timezone
from typing import Any

import numpy as np

log = logging.getLogger("helm-pilot.cluster")

# ─── DB ──────────────────────────────────────────────────────────────────

def get_conn(database_url: str):
    import psycopg2
    return psycopg2.connect(database_url)


def fetch_scored_opportunities(conn, workspace_id: str) -> list[dict[str, Any]]:
    """Fetch opportunities with scores for the workspace."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT o.id, o.title, o.description, o.source,
                   s.overall_score, s.founder_fit_score, s.market_signal,
                   s.feasibility, s.timing
            FROM opportunities o
            LEFT JOIN opportunity_scores s ON s.opportunity_id = o.id
            WHERE o.workspace_id = %s
              AND o.status IN ('discovered', 'scored', 'selected')
            ORDER BY s.overall_score DESC NULLS LAST
            LIMIT 500
        """, (workspace_id,))
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def clear_old_clusters(conn, workspace_id: str):
    """Drop existing clusters for the workspace (full rebuild)."""
    with conn.cursor() as cur:
        cur.execute("""
            DELETE FROM opportunity_cluster_members
            WHERE cluster_id IN (
                SELECT id FROM opportunity_clusters WHERE workspace_id = %s
            )
        """, (workspace_id,))
        cur.execute("DELETE FROM opportunity_clusters WHERE workspace_id = %s", (workspace_id,))


def insert_cluster(conn, workspace_id: str, label: str, summary: str,
                   tags: list[str], avg_score: float | None, method: str,
                   centroid: np.ndarray | None) -> str:
    """Insert a cluster row and return its id."""
    centroid_blob = centroid.tobytes().hex() if centroid is not None else None
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO opportunity_clusters
                (workspace_id, label, summary, tags, member_count, avg_score, method, centroid_blob)
            VALUES (%s, %s, %s, %s, 0, %s, %s, %s)
            RETURNING id
        """, (workspace_id, label, summary, json.dumps(tags), avg_score, method, centroid_blob))
        return cur.fetchone()[0]


def insert_members(conn, cluster_id: str, members: list[dict]):
    """Insert cluster member rows and update the cluster's member_count."""
    with conn.cursor() as cur:
        for m in members:
            cur.execute("""
                INSERT INTO opportunity_cluster_members
                    (cluster_id, opportunity_id, distance, is_representative)
                VALUES (%s, %s, %s, %s)
            """, (cluster_id, m["id"], m.get("distance"), m.get("is_representative", False)))
        cur.execute(
            "UPDATE opportunity_clusters SET member_count = %s WHERE id = %s",
            (len(members), cluster_id),
        )


# ─── Embedding ───────────────────────────────────────────────────────────

def embed_texts(texts: list[str], api_key: str | None = None) -> np.ndarray:
    """Embed texts via OpenAI text-embedding-3-small. Falls back to random
    embeddings in dev mode (no API key)."""
    if not api_key:
        log.warning("No OPENAI_API_KEY — using random embeddings (dev mode)")
        rng = np.random.default_rng(42)
        return rng.random((len(texts), 256)).astype(np.float32)

    import httpx
    batch_size = 100
    all_embeddings = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        resp = httpx.post(
            "https://api.openai.com/v1/embeddings",
            headers={"Authorization": f"Bearer {api_key}"},
            json={"model": "text-embedding-3-small", "input": batch},
            timeout=60,
        )
        resp.raise_for_status()
        data = resp.json()["data"]
        all_embeddings.extend([d["embedding"] for d in sorted(data, key=lambda x: x["index"])])
    return np.array(all_embeddings, dtype=np.float32)


# ─── Clustering ──────────────────────────────────────────────────────────

def cluster_opportunities(
    embeddings: np.ndarray,
    min_cluster_size: int = 3,
    min_samples: int = 2,
) -> np.ndarray:
    """Run HDBSCAN and return cluster labels (-1 = noise)."""
    import hdbscan
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        metric="euclidean",
        cluster_selection_method="eom",  # excess of mass — better for variable-density
    )
    return clusterer.fit_predict(embeddings)


# ─── LLM Labelling ──────────────────────────────────────────────────────

def label_cluster_via_llm(
    titles: list[str],
    api_key: str | None = None,
    model: str = "anthropic/claude-sonnet-4",
) -> dict[str, str]:
    """Generate a human label + summary for a cluster from its member titles."""
    if not api_key:
        # Heuristic fallback: use the first title as label
        return {
            "label": titles[0][:60] if titles else "Unlabelled",
            "summary": f"Cluster of {len(titles)} similar opportunities",
        }

    import httpx
    prompt = (
        "Given these startup opportunity titles, generate a concise market-theme "
        "label (max 6 words) and a one-sentence summary.\n\n"
        "Titles:\n" + "\n".join(f"- {t}" for t in titles[:10]) + "\n\n"
        'Respond JSON only: {"label": "...", "summary": "..."}'
    )
    resp = httpx.post(
        os.getenv("HELM_GOVERNANCE_URL", "https://openrouter.ai/api/v1") + "/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "X-Helm-Principal": "system:cluster-generator",
        },
        json={"model": model, "messages": [{"role": "user", "content": prompt}], "max_tokens": 200},
        timeout=30,
    )
    if resp.status_code != 200:
        return {"label": titles[0][:60] if titles else "Unlabelled", "summary": f"Cluster of {len(titles)} opportunities"}
    try:
        content = resp.json()["choices"][0]["message"]["content"]
        return json.loads(content.strip().removeprefix("```json").removesuffix("```").strip())
    except Exception:
        return {"label": titles[0][:60] if titles else "Unlabelled", "summary": f"Cluster of {len(titles)} opportunities"}


# ─── Orchestration ───────────────────────────────────────────────────────

def run(
    workspace_id: str,
    database_url: str,
    min_cluster_size: int = 3,
    min_samples: int = 2,
    top_representatives: int = 3,
):
    conn = get_conn(database_url)
    try:
        # 1. Fetch scored opportunities
        opps = fetch_scored_opportunities(conn, workspace_id)
        if len(opps) < min_cluster_size:
            log.info(f"Only {len(opps)} opportunities — too few to cluster (min={min_cluster_size})")
            return

        log.info(f"Clustering {len(opps)} opportunities for workspace {workspace_id}")

        # 2. Embed titles + descriptions
        texts = [f"{o['title']}. {o['description'][:500]}" for o in opps]
        openai_key = os.getenv("OPENAI_API_KEY")
        embeddings = embed_texts(texts, openai_key)

        # 3. HDBSCAN clustering
        labels = cluster_opportunities(embeddings, min_cluster_size, min_samples)
        unique_labels = set(labels)
        unique_labels.discard(-1)  # remove noise label

        if not unique_labels:
            log.info("HDBSCAN found no clusters (all noise) — try lowering min_cluster_size")
            return

        log.info(f"Found {len(unique_labels)} clusters, {sum(labels == -1)} noise points")

        # 4. Clear old clusters and rebuild
        clear_old_clusters(conn, workspace_id)

        llm_key = os.getenv("OPENROUTER_API_KEY") or openai_key
        created = 0

        for cluster_label in sorted(unique_labels):
            member_indices = np.where(labels == cluster_label)[0]
            member_opps = [opps[i] for i in member_indices]
            member_embeddings = embeddings[member_indices]

            # Centroid
            centroid = member_embeddings.mean(axis=0)

            # Distances from centroid
            diffs = member_embeddings - centroid
            distances = np.linalg.norm(diffs, axis=1)
            sorted_by_distance = np.argsort(distances)

            # Top tags from members (based on source)
            sources = [o["source"] for o in member_opps]
            tag_counts: dict[str, int] = {}
            for s in sources:
                tag_counts[s] = tag_counts.get(s, 0) + 1
            top_tags = sorted(tag_counts, key=tag_counts.get, reverse=True)[:5]

            # Average score
            scores = [o.get("overall_score") for o in member_opps if o.get("overall_score") is not None]
            avg_score = sum(scores) / len(scores) if scores else None

            # LLM label
            titles = [o["title"] for o in member_opps]
            label_result = label_cluster_via_llm(titles, llm_key)

            # Insert cluster
            cluster_id = insert_cluster(
                conn, workspace_id,
                label=label_result.get("label", f"Cluster {cluster_label}"),
                summary=label_result.get("summary", f"{len(member_opps)} opportunities"),
                tags=top_tags,
                avg_score=avg_score,
                method="hdbscan",
                centroid=centroid,
            )

            # Insert members
            members = []
            for rank, idx in enumerate(sorted_by_distance):
                members.append({
                    "id": member_opps[idx]["id"],
                    "distance": float(distances[idx]),
                    "is_representative": rank < top_representatives,
                })
            insert_members(conn, cluster_id, members)
            created += 1

        conn.commit()
        log.info(f"Created {created} clusters for workspace {workspace_id}")

    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ─── CLI ─────────────────────────────────────────────────────────────────

def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")
    parser = argparse.ArgumentParser(description="HELM Pilot — HDBSCAN opportunity clustering")
    parser.add_argument("--workspace-id", required=True)
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    parser.add_argument("--min-cluster-size", type=int, default=3)
    parser.add_argument("--min-samples", type=int, default=2)
    parser.add_argument("--top-representatives", type=int, default=3)
    args = parser.parse_args()

    if not args.database_url:
        print("DATABASE_URL is required", file=sys.stderr)
        sys.exit(1)

    run(
        workspace_id=args.workspace_id,
        database_url=args.database_url,
        min_cluster_size=args.min_cluster_size,
        min_samples=args.min_samples,
        top_representatives=args.top_representatives,
    )


if __name__ == "__main__":
    main()
