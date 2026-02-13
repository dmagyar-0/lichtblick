# SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
# SPDX-License-Identifier: MPL-2.0

"""
Pydantic models matching the frontend wire-protocol types defined in
packages/suite-base/src/players/IterablePlayer/Backend/types.ts

All models use camelCase field aliases to match the JSON wire format.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class TimeJson(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    sec: int
    nsec: int = Field(ge=0, le=999_999_999)


class TopicInfoJson(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str
    schema_name: str = Field(alias="schemaName")
    message_encoding: str = Field(alias="messageEncoding")
    schema_encoding: str = Field(alias="schemaEncoding")
    schema_data: str = Field(alias="schemaData")  # base64-encoded


class TopicStatsJson(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    num_messages: int = Field(alias="numMessages")
    first_message_time: TimeJson | None = Field(default=None, alias="firstMessageTime")
    last_message_time: TimeJson | None = Field(default=None, alias="lastMessageTime")


class InitializeResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    start: TimeJson
    end: TimeJson
    topics: list[TopicInfoJson]
    topic_stats: dict[str, TopicStatsJson] = Field(alias="topicStats")
    profile: str
    metadata: list[dict[str, object]] | None = None
    publishers_by_topic: dict[str, list[str]] | None = Field(
        default=None, alias="publishersByTopic"
    )


class TopicFilter(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    fields: list[str] | None = None


class MessagesRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    topics: dict[str, TopicFilter]
    start: TimeJson
    end: TimeJson


class MessageFrameJson(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    topic: str
    receive_time: TimeJson = Field(alias="receiveTime")
    publish_time: TimeJson | None = Field(default=None, alias="publishTime")
    data: str  # base64-encoded serialized message bytes
    size_in_bytes: int | None = Field(default=None, alias="sizeInBytes")


class StampMarker(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    type: str = "stamp"
    stamp: TimeJson


class BackfillRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    topics: dict[str, TopicFilter]
    time: TimeJson


class BackfillResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    messages: list[MessageFrameJson]
