#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def check(condition: bool, name: str, detail: str) -> dict[str, object]:
    return {"name": name, "ok": condition, "detail": detail}


def main() -> int:
    checks: list[dict[str, object]] = []
    checks.append(
        check(
            sys.version_info >= (3, 10),
            "python_version",
            f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
        )
    )

    try:
        import scrapling  # noqa: F401
        from scrapling import DynamicFetcher, Fetcher, StealthyFetcher  # noqa: F401

        version = getattr(scrapling, "__version__", "unknown")
        checks.append(check(True, "scrapling_import", version))
    except Exception as exc:  # pragma: no cover - runtime path
        checks.append(check(False, "scrapling_import", str(exc)))

    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as playwright:
            executable = playwright.chromium.executable_path
        checks.append(check(Path(executable).exists(), "playwright_chromium", executable))
    except Exception as exc:  # pragma: no cover - runtime path
        checks.append(check(False, "playwright_chromium", str(exc)))

    try:
        from patchright.sync_api import sync_playwright as sync_patchright

        with sync_patchright() as playwright:
            executable = playwright.chromium.executable_path
        checks.append(check(Path(executable).exists(), "patchright_chromium", executable))
    except Exception as exc:  # pragma: no cover - runtime path
        checks.append(check(False, "patchright_chromium", str(exc)))

    storage_root = Path(os.environ.get("STORAGE_PATH", "./data/storage")).resolve()
    (storage_root / "adaptive").mkdir(parents=True, exist_ok=True)
    checks.append(check(True, "storage_root", str(storage_root)))
    checks.append(check((storage_root / "adaptive").exists(), "adaptive_dir", str(storage_root / "adaptive")))

    print(json.dumps({"ok": all(item["ok"] for item in checks), "checks": checks}, indent=2))
    return 0 if all(item["ok"] for item in checks) else 1


if __name__ == "__main__":
    raise SystemExit(main())
