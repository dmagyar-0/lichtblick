# SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
# SPDX-License-Identifier: MPL-2.0

from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from lichtblick_backend.models import (
    BackfillResponse,
    InitializeResponse,
    MessageFrameJson,
    StampMarker,
    TimeJson,
    TopicInfoJson,
    TopicStatsJson,
)


class TestTimeJson:
    def test_valid_time(self) -> None:
        t = TimeJson(sec=100, nsec=500_000_000)
        assert t.sec == 100
        assert t.nsec == 500_000_000

    def test_nsec_zero(self) -> None:
        t = TimeJson(sec=0, nsec=0)
        assert t.nsec == 0

    def test_nsec_max(self) -> None:
        t = TimeJson(sec=0, nsec=999_999_999)
        assert t.nsec == 999_999_999

    def test_nsec_too_large(self) -> None:
        with pytest.raises(ValidationError):
            TimeJson(sec=0, nsec=1_000_000_000)

    def test_nsec_negative(self) -> None:
        with pytest.raises(ValidationError):
            TimeJson(sec=0, nsec=-1)


class TestTopicInfoJson:
    def test_serializes_camel_case(self) -> None:
        topic = TopicInfoJson(
            name="/test",
            schemaName="TestSchema",
            messageEncoding="json",
            schemaEncoding="jsonschema",
            schemaData="dGVzdA==",
        )
        data = json.loads(topic.model_dump_json(by_alias=True))
        assert "schemaName" in data
        assert "messageEncoding" in data
        assert "schemaEncoding" in data
        assert "schemaData" in data
        assert data["schemaName"] == "TestSchema"


class TestTopicStatsJson:
    def test_serializes_camel_case(self) -> None:
        stats = TopicStatsJson(
            numMessages=100,
            firstMessageTime=TimeJson(sec=0, nsec=0),
            lastMessageTime=TimeJson(sec=10, nsec=0),
        )
        data = json.loads(stats.model_dump_json(by_alias=True))
        assert "numMessages" in data
        assert "firstMessageTime" in data
        assert "lastMessageTime" in data

    def test_optional_times(self) -> None:
        stats = TopicStatsJson(numMessages=0)
        data = json.loads(stats.model_dump_json(by_alias=True))
        assert data["firstMessageTime"] is None
        assert data["lastMessageTime"] is None


class TestMessageFrameJson:
    def test_serializes_camel_case(self) -> None:
        frame = MessageFrameJson(
            topic="/test",
            receiveTime=TimeJson(sec=100, nsec=0),
            data="dGVzdA==",
        )
        data = json.loads(frame.model_dump_json(by_alias=True))
        assert "receiveTime" in data
        assert "topic" in data
        assert "data" in data

    def test_optional_publish_time(self) -> None:
        frame = MessageFrameJson(
            topic="/test",
            receiveTime=TimeJson(sec=100, nsec=0),
            data="dGVzdA==",
        )
        data = json.loads(frame.model_dump_json(by_alias=True))
        assert data.get("publishTime") is None

    def test_with_publish_time(self) -> None:
        frame = MessageFrameJson(
            topic="/test",
            receiveTime=TimeJson(sec=100, nsec=0),
            publishTime=TimeJson(sec=99, nsec=999_000_000),
            data="dGVzdA==",
        )
        data = json.loads(frame.model_dump_json(by_alias=True))
        assert data["publishTime"]["sec"] == 99


class TestStampMarker:
    def test_serializes_correctly(self) -> None:
        stamp = StampMarker(stamp=TimeJson(sec=42, nsec=0))
        data = json.loads(stamp.model_dump_json(by_alias=True))
        assert data["type"] == "stamp"
        assert data["stamp"]["sec"] == 42


class TestInitializeResponse:
    def test_serializes_camel_case(self) -> None:
        resp = InitializeResponse(
            start=TimeJson(sec=0, nsec=0),
            end=TimeJson(sec=10, nsec=0),
            topics=[],
            topicStats={},
            profile="ros2",
        )
        data = json.loads(resp.model_dump_json(by_alias=True))
        assert "topicStats" in data
        assert data["profile"] == "ros2"

    def test_optional_fields_absent(self) -> None:
        resp = InitializeResponse(
            start=TimeJson(sec=0, nsec=0),
            end=TimeJson(sec=10, nsec=0),
            topics=[],
            topicStats={},
            profile="",
        )
        data = json.loads(resp.model_dump_json(by_alias=True))
        # Optional fields should be present but None/null
        assert "publishersByTopic" in data


class TestBackfillResponse:
    def test_empty_messages(self) -> None:
        resp = BackfillResponse(messages=[])
        data = json.loads(resp.model_dump_json(by_alias=True))
        assert data["messages"] == []
