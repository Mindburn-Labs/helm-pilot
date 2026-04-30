#!/usr/bin/env python3
from __future__ import annotations

import os
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from scrapling import DynamicFetcher, Fetcher, StealthyFetcher
from scrapling.core.storage import SQLiteStorageSystem

SAFE_REDIRECT_MODE = "safe"


def domain_key(url: str) -> str:
    return urlparse(url).netloc.replace(".", "_")


def adaptive_identifier(url: str, label: str) -> str:
    return f"{domain_key(url)}::{label}"


def storage_root() -> Path:
    return Path(os.environ.get("STORAGE_PATH", "./data/storage")).resolve()


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def adaptive_storage_file(url: str, adaptive_domain: str | None = None) -> str:
    key = (adaptive_domain or domain_key(url)).replace("/", "_")
    return str(ensure_dir(storage_root() / "adaptive") / f"{key}.sqlite3")


def selector_config(url: str, adaptive_domain: str | None = None) -> dict[str, Any]:
    domain = adaptive_domain or url
    return {
        "adaptive": True,
        "storage": SQLiteStorageSystem,
        "storage_args": {
            "storage_file": adaptive_storage_file(url, adaptive_domain),
            "url": domain,
        },
        "adaptive_domain": domain,
    }


def follow_redirects_mode() -> str | bool:
    raw = os.environ.get("SCRAPLING_FOLLOW_REDIRECTS", SAFE_REDIRECT_MODE).strip().lower()
    if raw in {"0", "false", "off", "no"}:
        return False
    if raw in {"all", "unsafe"}:
        return "all"
    return SAFE_REDIRECT_MODE


def spider_development_mode(enabled: bool = False) -> bool:
    if os.environ.get("NODE_ENV") == "production":
        return False
    raw = os.environ.get("SCRAPLING_DEVELOPMENT_MODE")
    if raw is not None:
        return raw.strip().lower() in {"1", "true", "yes", "on"}
    return enabled


def cookies_from_session(session_data: Any) -> list[dict[str, Any]] | None:
    if not session_data:
        return None
    if isinstance(session_data, list):
        return [cookie for cookie in session_data if isinstance(cookie, dict)]
    if isinstance(session_data, dict):
        cookies = session_data.get("cookies")
        if isinstance(cookies, list):
            return [cookie for cookie in cookies if isinstance(cookie, dict)]
    return None


def choose_strategy(url: str, requested: str = "auto", *, authenticated: bool = False, interactive: bool = False) -> str:
    if requested != "auto":
        return requested
    if authenticated:
        return "stealthy"
    if interactive:
        return "dynamic"
    if any(host in url for host in ("ycombinator.com/library", "startupschool.org", "producthunt.com")):
        return "dynamic"
    return "fetcher"


def fetch_json(
    url: str,
    *,
    method: str = "GET",
    strategy: str = "fetcher",
    adaptive_domain: str | None = None,
    headers: dict[str, str] | None = None,
    params: dict[str, Any] | None = None,
    data: Any = None,
    json_body: Any = None,
    cookies: list[dict[str, Any]] | None = None,
    timeout: int = 30,
):
    strategy = choose_strategy(url, strategy)
    kwargs: dict[str, Any] = {
        "headers": headers or {},
        "params": params,
        "cookies": cookies,
        "timeout": timeout,
        "selector_config": selector_config(url, adaptive_domain),
        "follow_redirects": follow_redirects_mode(),
    }
    if method.upper() == "POST":
        if json_body is not None:
            kwargs["json"] = json_body
        if data is not None:
            kwargs["data"] = data
        response = Fetcher.post(url, **kwargs)
    else:
        response = Fetcher.get(url, **kwargs)
    return response.json()


def fetch_html(
    url: str,
    *,
    strategy: str = "auto",
    session_data: Any = None,
    adaptive_domain: str | None = None,
    headers: dict[str, str] | None = None,
    wait_selector: str | None = None,
    wait_selector_state: str = "attached",
    timeout_ms: int = 30_000,
    page_action: Any = None,
):
    strategy = choose_strategy(
        url,
        strategy,
        authenticated=bool(session_data),
        interactive=bool(wait_selector or page_action),
    )
    cookies = cookies_from_session(session_data)

    if strategy == "stealthy":
        return StealthyFetcher.fetch(
            url,
            cookies=cookies,
            extra_headers=headers or {},
            selector_config=selector_config(url, adaptive_domain),
            follow_redirects=follow_redirects_mode(),
            timeout=timeout_ms,
            wait_selector=wait_selector,
            wait_selector_state=wait_selector_state,
            solve_cloudflare=True,
            load_dom=True,
            network_idle=True,
            page_action=page_action,
        )

    if strategy == "dynamic":
        return DynamicFetcher.fetch(
            url,
            cookies=cookies,
            extra_headers=headers or {},
            selector_config=selector_config(url, adaptive_domain),
            follow_redirects=follow_redirects_mode(),
            timeout=timeout_ms,
            wait_selector=wait_selector,
            wait_selector_state=wait_selector_state,
            load_dom=True,
            network_idle=True,
            page_action=page_action,
        )

    return Fetcher.get(
        url,
        headers=headers or {},
        cookies=cookies,
        selector_config=selector_config(url, adaptive_domain),
        follow_redirects=follow_redirects_mode(),
        timeout=max(5, int(timeout_ms / 1000)),
    )


def adaptive_css(response, url: str, selector: str, label: str):
    return response.css(
        selector,
        identifier=adaptive_identifier(url, label),
        adaptive=True,
        auto_save=True,
    )
