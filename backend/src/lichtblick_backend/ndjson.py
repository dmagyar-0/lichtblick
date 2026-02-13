# SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
# SPDX-License-Identifier: MPL-2.0

"""NDJSON streaming helper for FastAPI StreamingResponse."""

from __future__ import annotations

from typing import AsyncIterator

from .models import MessageFrameJson, StampMarker


async def ndjson_stream(
    source: AsyncIterator[MessageFrameJson | StampMarker],
) -> AsyncIterator[bytes]:
    """Convert an async iterator of messages/stamps into newline-delimited JSON bytes.

    Each item is serialized to a single JSON line terminated by ``\\n``.
    Message frames use their Pydantic serialization (camelCase aliases).
    Stamp markers are serialized as ``{"type":"stamp","stamp":{...}}``.
    """
    async for item in source:
        line = item.model_dump_json(by_alias=True) + "\n"
        yield line.encode("utf-8")
