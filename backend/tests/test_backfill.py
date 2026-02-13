# SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
# SPDX-License-Identifier: MPL-2.0

from __future__ import annotations

import base64
import json

import pytest
from httpx import AsyncClient


@pytest.mark.anyio
async def test_backfill_returns_messages(client: AsyncClient) -> None:
    response = await client.post(
        "/api/sources/demo/backfill",
        json={
            "topics": {"/sensor/imu": {}},
            "time": {"sec": 1_700_000_005, "nsec": 0},
        },
    )
    assert response.status_code == 200

    data = response.json()
    assert "messages" in data
    assert len(data["messages"]) == 1

    msg = data["messages"][0]
    assert msg["topic"] == "/sensor/imu"
    assert "receiveTime" in msg
    assert "data" in msg

    # receiveTime should be <= requested time
    rt = msg["receiveTime"]
    assert (rt["sec"], rt["nsec"]) <= (1_700_000_005, 0)


@pytest.mark.anyio
async def test_backfill_multiple_topics(client: AsyncClient) -> None:
    response = await client.post(
        "/api/sources/demo/backfill",
        json={
            "topics": {"/sensor/imu": {}, "/sensor/gps": {}, "/diagnostics": {}},
            "time": {"sec": 1_700_000_010, "nsec": 0},
        },
    )
    assert response.status_code == 200

    data = response.json()
    topics = {m["topic"] for m in data["messages"]}
    assert topics == {"/sensor/imu", "/sensor/gps", "/diagnostics"}


@pytest.mark.anyio
async def test_backfill_data_is_valid_base64(client: AsyncClient) -> None:
    response = await client.post(
        "/api/sources/demo/backfill",
        json={
            "topics": {"/sensor/gps": {}},
            "time": {"sec": 1_700_000_005, "nsec": 0},
        },
    )
    data = response.json()
    msg = data["messages"][0]

    decoded = base64.b64decode(msg["data"])
    parsed = json.loads(decoded)
    assert "latitude" in parsed
    assert "longitude" in parsed


@pytest.mark.anyio
async def test_backfill_before_data_start_returns_empty(client: AsyncClient) -> None:
    response = await client.post(
        "/api/sources/demo/backfill",
        json={
            "topics": {"/sensor/imu": {}},
            "time": {"sec": 0, "nsec": 0},
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["messages"] == []


@pytest.mark.anyio
async def test_backfill_unknown_source_returns_404(client: AsyncClient) -> None:
    response = await client.post(
        "/api/sources/nonexistent/backfill",
        json={
            "topics": {"/sensor/imu": {}},
            "time": {"sec": 1_700_000_005, "nsec": 0},
        },
    )
    assert response.status_code == 404
