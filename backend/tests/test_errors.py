# SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
# SPDX-License-Identifier: MPL-2.0

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.anyio
async def test_messages_invalid_body_returns_422(client: AsyncClient) -> None:
    response = await client.post(
        "/api/sources/demo/messages",
        json={"invalid": "body"},
    )
    assert response.status_code == 422


@pytest.mark.anyio
async def test_backfill_invalid_body_returns_422(client: AsyncClient) -> None:
    response = await client.post(
        "/api/sources/demo/backfill",
        json={"bad": "request"},
    )
    assert response.status_code == 422


@pytest.mark.anyio
async def test_messages_invalid_time_returns_422(client: AsyncClient) -> None:
    response = await client.post(
        "/api/sources/demo/messages",
        json={
            "topics": {"/sensor/imu": {}},
            "start": {"sec": 0, "nsec": -1},  # nsec must be >= 0
            "end": {"sec": 1, "nsec": 0},
        },
    )
    assert response.status_code == 422


@pytest.mark.anyio
async def test_backfill_invalid_nsec_returns_422(client: AsyncClient) -> None:
    response = await client.post(
        "/api/sources/demo/backfill",
        json={
            "topics": {"/sensor/imu": {}},
            "time": {"sec": 0, "nsec": 2_000_000_000},  # nsec too large
        },
    )
    assert response.status_code == 422
