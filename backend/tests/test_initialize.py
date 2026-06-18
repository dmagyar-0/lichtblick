# SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
# SPDX-License-Identifier: MPL-2.0

from __future__ import annotations

import base64
import json

import pytest
from httpx import AsyncClient


@pytest.mark.anyio
async def test_initialize_demo_source(client: AsyncClient) -> None:
    response = await client.post("/api/sources/demo/initialize")
    assert response.status_code == 200

    data = response.json()

    # Check required top-level fields
    assert "start" in data
    assert "end" in data
    assert "topics" in data
    assert "topicStats" in data
    assert "profile" in data

    # Validate time structure
    assert data["start"]["sec"] == 1_700_000_000
    assert data["start"]["nsec"] == 0
    assert data["end"]["sec"] == 1_700_000_060
    assert data["end"]["nsec"] == 0

    # Validate topics
    topics = data["topics"]
    assert len(topics) == 3

    topic_names = {t["name"] for t in topics}
    assert topic_names == {"/sensor/imu", "/sensor/gps", "/diagnostics"}

    # Validate each topic has required fields
    for topic in topics:
        assert "name" in topic
        assert "schemaName" in topic
        assert "messageEncoding" in topic
        assert "schemaEncoding" in topic
        assert "schemaData" in topic
        # Verify schemaData is valid base64
        schema_bytes = base64.b64decode(topic["schemaData"])
        schema = json.loads(schema_bytes)
        assert "type" in schema  # JSON schema has a "type" field


@pytest.mark.anyio
async def test_initialize_topic_stats(client: AsyncClient) -> None:
    response = await client.post("/api/sources/demo/initialize")
    data = response.json()
    stats = data["topicStats"]

    assert "/sensor/imu" in stats
    assert "/sensor/gps" in stats
    assert "/diagnostics" in stats

    imu_stats = stats["/sensor/imu"]
    assert imu_stats["numMessages"] == 6000  # 60s * 100Hz
    assert "firstMessageTime" in imu_stats
    assert "lastMessageTime" in imu_stats


@pytest.mark.anyio
async def test_initialize_publishers_by_topic(client: AsyncClient) -> None:
    response = await client.post("/api/sources/demo/initialize")
    data = response.json()

    pbt = data.get("publishersByTopic")
    assert pbt is not None
    assert "/sensor/imu" in pbt
    assert "imu_node" in pbt["/sensor/imu"]


@pytest.mark.anyio
async def test_initialize_unknown_source_returns_404(client: AsyncClient) -> None:
    response = await client.post("/api/sources/nonexistent/initialize")
    assert response.status_code == 404
    assert "nonexistent" in response.json()["detail"]
