#!/usr/bin/env python3
"""Markdown conversion for ingested content (microsoft/markitdown, MIT).

Wraps markitdown so the Scrapling bridge can emit LLM-friendly markdown
alongside raw HTML. Converts HTML in memory (no temp file) so the
pipeline stays stream-based like scrapling_adapter.py.
"""

from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from typing import Optional

from markitdown import MarkItDown


@dataclass(frozen=True)
class MarkdownResult:
    markdown: str
    title: Optional[str]


_converter: Optional[MarkItDown] = None


def _instance() -> MarkItDown:
    global _converter
    if _converter is None:
        _converter = MarkItDown(enable_plugins=False)
    return _converter


def html_to_markdown(html: str, *, source_url: Optional[str] = None) -> MarkdownResult:
    stream = BytesIO(html.encode("utf-8"))
    result = _instance().convert_stream(
        stream,
        file_extension=".html",
        url=source_url,
    )
    return MarkdownResult(markdown=result.text_content, title=result.title)


def file_to_markdown(path: str) -> MarkdownResult:
    result = _instance().convert(path)
    return MarkdownResult(markdown=result.text_content, title=result.title)
