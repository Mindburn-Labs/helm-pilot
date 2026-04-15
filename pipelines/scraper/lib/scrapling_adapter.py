#!/usr/bin/env python3
from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

from scrapling import DynamicFetcher, Fetcher, StealthyFetcher


def domain_key(url: str) -> str:
    return urlparse(url).netloc.replace(".", "_")


def adaptive_identifier(url: str, label: str) -> str:
    return f"{domain_key(url)}::{label}"


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
        timeout=max(5, int(timeout_ms / 1000)),
    )


def adaptive_css(response, url: str, selector: str, label: str):
    return response.css(
        selector,
        identifier=adaptive_identifier(url, label),
        adaptive=True,
        auto_save=True,
    )
