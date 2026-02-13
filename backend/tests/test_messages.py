# SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
# SPDX-License-Identifier: MPL-2.0

from __future__ import annotations

import base64
import json

import pytest
from httpx import AsyncClient


def _parse_ndjson(text: str) -> list[dict]:
    """Parse NDJSON text into a list of dicts."""
    lines = text.strip().split("\n")
    return [json.loads(line) for line in lines if line.strip()]


@pytest.mark.anyio
async def test_messages_returns_ndjson(client: AsyncClient) -> None:
    response = await client.post(
        "/api/sources/demo/messages",
        json={
            "topics": {"/sensor/imu": {}},
            "start": {"sec": 1_700_000_000, "nsec": 0},
            "end": {"sec": 1_700_000_001, "nsec": 0},
        },
    )
    assert response.status_code == 200
    assert "application/x-ndjson" in response.headers["content-type"]


@pytest.mark.anyio
async def test_messages_contains_message_frames(client: AsyncClient) -> None:
    response = await client.post(
        "/api/sources/demo/messages",
        json={
            "topics": {"/sensor/imu": {}},
            "start": {"sec": 1_700_000_000, "nsec": 0},
            "end": {"sec": 1_700_000_001, "nsec": 0},
        },
    )
    items = _parse_ndjson(response.text)

    # Should have message frames
    message_frames = [i for i in items if "topic" in i and i.get("type") != "stamp"]
    assert len(message_frames) > 0

    # Verify message frame structure
    frame = message_frames[0]
    assert frame["topic"] == "/sensor/imu"
    assert "receiveTime" in frame
    assert "sec" in frame["receiveTime"]
    assert "nsec" in frame["receiveTime"]
    assert "data" in frame

    # Verify data is valid base64 containing JSON
    decoded = base64.b64decode(frame["data"])
    msg = json.loads(decoded)
    assert "linear_acceleration" in msg


@pytest.mark.anyio
async def test_messages_contains_stamp_markers(client: AsyncClient) -> None:
    response = await client.post(
        "/api/sources/demo/messages",
        json={
            "topics": {"/sensor/imu": {}},
            "start": {"sec": 1_700_000_000, "nsec": 0},
            "end": {"sec": 1_700_000_003, "nsec": 0},
        },
    )
    items = _parse_ndjson(response.text)

    stamps = [i for i in items if i.get("type") == "stamp"]
    assert len(stamps) >= 2  # At least 2 stamps for a 3-second range

    # Verify stamp structure
    stamp = stamps[0]
    assert "stamp" in stamp
    assert "sec" in stamp["stamp"]
    assert "nsec" in stamp["stamp"]


@pytest.mark.anyio
async def test_messages_chronological_order(client: AsyncClient) -> None:
    response = await client.post(
        "/api/sources/demo/messages",
        json={
            "topics": {"/sensor/imu": {}},
            "start": {"sec": 1_700_000_000, "nsec": 0},
            "end": {"sec": 1_700_000_002, "nsec": 0},
        },
    )
    items = _parse_ndjson(response.text)

    message_frames = [i for i in items if "receiveTime" in i and i.get("type") != "stamp"]
    times = [
        (f["receiveTime"]["sec"], f["receiveTime"]["nsec"]) for f in message_frames
    ]
    assert times == sorted(times), "Messages should be in chronological order"


@pytest.mark.anyio
async def test_messages_topic_filtering(client: AsyncClient) -> None:
    response = await client.post(
        "/api/sources/demo/messages",
        json={
            "topics": {"/sensor/gps": {}},
            "start": {"sec": 1_700_000_000, "nsec": 0},
            "end": {"sec": 1_700_000_002, "nsec": 0},
        },
    )
    items = _parse_ndjson(response.text)

    message_frames = [i for i in items if "topic" in i and i.get("type") != "stamp"]
    topics_seen = {f["topic"] for f in message_frames}
    assert topics_seen == {"/sensor/gps"}, "Only requested topics should be returned"


@pytest.mark.anyio
async def test_messages_multiple_topics(client: AsyncClient) -> None:
    response = await client.post(
        "/api/sources/demo/messages",
        json={
            "topics": {"/sensor/imu": {}, "/sensor/gps": {}},
            "start": {"sec": 1_700_000_000, "nsec": 0},
            "end": {"sec": 1_700_000_001, "nsec": 0},
        },
    )
    items = _parse_ndjson(response.text)

    message_frames = [i for i in items if "topic" in i and i.get("type") != "stamp"]
    topics_seen = {f["topic"] for f in message_frames}
    assert "/sensor/imu" in topics_seen
    assert "/sensor/gps" in topics_seen


@pytest.mark.anyio
async def test_messages_empty_range(client: AsyncClient) -> None:
    """Range entirely before data start → no messages."""
    response = await client.post(
        "/api/sources/demo/messages",
        json={
            "topics": {"/sensor/imu": {}},
            "start": {"sec": 0, "nsec": 0},
            "end": {"sec": 1, "nsec": 0},
        },
    )
    assert response.status_code == 200
    # No content or empty
    text = response.text.strip()
    if text:
        items = _parse_ndjson(text)
        message_frames = [i for i in items if "topic" in i and i.get("type") != "stamp"]
        assert len(message_frames) == 0


@pytest.mark.anyio
async def test_messages_unknown_source_returns_404(client: AsyncClient) -> None:
    response = await client.post(
        "/api/sources/nonexistent/messages",
        json={
            "topics": {"/sensor/imu": {}},
            "start": {"sec": 0, "nsec": 0},
            "end": {"sec": 1, "nsec": 0},
        },
    )
    assert response.status_code == 404
