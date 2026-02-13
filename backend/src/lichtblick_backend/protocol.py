# SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
# SPDX-License-Identifier: MPL-2.0

"""
DataSource protocol defining the interface that all data source
implementations must satisfy.
"""

from __future__ import annotations

from typing import AsyncIterator, Protocol, runtime_checkable

from .models import (
    BackfillRequest,
    InitializeResponse,
    MessageFrameJson,
    MessagesRequest,
    StampMarker,
)


@runtime_checkable
class DataSource(Protocol):
    """Protocol for backend data sources.

    Implementations provide metadata via initialize(), streaming messages
    via get_messages(), and point-in-time backfill via get_backfill().
    """

    async def initialize(self) -> InitializeResponse: ...

    async def get_messages(
        self, request: MessagesRequest
    ) -> AsyncIterator[MessageFrameJson | StampMarker]: ...

    async def get_backfill(self, request: BackfillRequest) -> list[MessageFrameJson]: ...
