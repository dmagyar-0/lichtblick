# SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
# SPDX-License-Identifier: MPL-2.0

"""API route handlers for the Lichtblick backend message-level API."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from .models import (
    BackfillRequest,
    BackfillResponse,
    InitializeResponse,
    MessagesRequest,
)
from .ndjson import ndjson_stream

if TYPE_CHECKING:
    from .protocol import DataSource

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")

# Source registry: maps source_id → DataSource instance.
# Populated by main.py at startup.
_sources: dict[str, DataSource] = {}


def register_source(source_id: str, source: DataSource) -> None:
    """Register a data source under the given ID."""
    _sources[source_id] = source


def _get_source(source_id: str) -> DataSource:
    """Look up a source by ID or raise 404."""
    source = _sources.get(source_id)
    if source is None:
        raise HTTPException(status_code=404, detail=f"Source '{source_id}' not found")
    return source


@router.post(
    "/sources/{source_id}/initialize",
    response_model=InitializeResponse,
    response_model_by_alias=True,
)
async def initialize(source_id: str) -> InitializeResponse:
    """Initialize a data source and return its metadata."""
    source = _get_source(source_id)
    try:
        return await source.initialize()
    except Exception:
        logger.exception("Failed to initialize source '%s'", source_id)
        raise HTTPException(status_code=500, detail="Failed to initialize source")


@router.post("/sources/{source_id}/messages")
async def get_messages(source_id: str, request: MessagesRequest) -> StreamingResponse:
    """Stream messages as NDJSON for the given time range and topics."""
    source = _get_source(source_id)
    try:
        # get_messages is an async generator — calling it returns the iterator
        # directly (no await).
        message_iter = source.get_messages(request)
    except Exception:
        logger.exception("Failed to get messages from source '%s'", source_id)
        raise HTTPException(
            status_code=500, detail="Failed to retrieve messages from source"
        )

    return StreamingResponse(
        ndjson_stream(message_iter),
        media_type="application/x-ndjson",
    )


@router.post(
    "/sources/{source_id}/backfill",
    response_model=BackfillResponse,
    response_model_by_alias=True,
)
async def backfill(source_id: str, request: BackfillRequest) -> BackfillResponse:
    """Get the last message per topic at or before the given time."""
    source = _get_source(source_id)
    try:
        messages = await source.get_backfill(request)
    except Exception:
        logger.exception("Failed to get backfill from source '%s'", source_id)
        raise HTTPException(
            status_code=500, detail="Failed to retrieve backfill from source"
        )

    return BackfillResponse(messages=messages)


@router.get("/health")
async def health() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "ok"}
