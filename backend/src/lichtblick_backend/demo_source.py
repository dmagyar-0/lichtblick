# SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
# SPDX-License-Identifier: MPL-2.0

"""
Demo data source that generates synthetic sensor data for testing
the frontend-backend communication.

Produces three topics:
  /sensor/imu   - 100 Hz IMU readings (accelerometer + gyroscope)
  /sensor/gps   - 10 Hz GPS coordinates
  /diagnostics  - 1 Hz diagnostic status messages

All messages use JSON message encoding with JSON Schema schema encoding.
This is the simplest encoding that the Lichtblick frontend can consume
(via the jsonschema + json pipeline in DeserializingIterableSource).
"""

from __future__ import annotations

import base64
import json
import math
from typing import AsyncIterator

from .models import (
    BackfillRequest,
    InitializeResponse,
    MessageFrameJson,
    MessagesRequest,
    StampMarker,
    TimeJson,
    TopicInfoJson,
    TopicStatsJson,
)

# --- Schema definitions (JSON Schema) ---

IMU_SCHEMA = {
    "type": "object",
    "properties": {
        "timestamp": {"type": "number"},
        "linear_acceleration": {
            "type": "object",
            "properties": {
                "x": {"type": "number"},
                "y": {"type": "number"},
                "z": {"type": "number"},
            },
        },
        "angular_velocity": {
            "type": "object",
            "properties": {
                "x": {"type": "number"},
                "y": {"type": "number"},
                "z": {"type": "number"},
            },
        },
    },
}

GPS_SCHEMA = {
    "type": "object",
    "properties": {
        "timestamp": {"type": "number"},
        "latitude": {"type": "number"},
        "longitude": {"type": "number"},
        "altitude": {"type": "number"},
    },
}

DIAGNOSTICS_SCHEMA = {
    "type": "object",
    "properties": {
        "timestamp": {"type": "number"},
        "level": {"type": "string"},
        "message": {"type": "string"},
        "hardware_id": {"type": "string"},
    },
}


def _b64_schema(schema: dict) -> str:
    """Encode a JSON schema dict to a base64 string."""
    return base64.b64encode(json.dumps(schema).encode("utf-8")).decode("ascii")


def _b64_message(data: dict) -> str:
    """Encode a message dict to base64-encoded JSON bytes."""
    return base64.b64encode(json.dumps(data).encode("utf-8")).decode("ascii")


def _time_to_float(t: TimeJson) -> float:
    return t.sec + t.nsec / 1_000_000_000


def _float_to_time(f: float) -> TimeJson:
    sec = int(f)
    nsec = int(round((f - sec) * 1_000_000_000))
    if nsec < 0:
        sec -= 1
        nsec += 1_000_000_000
    return TimeJson(sec=sec, nsec=nsec)


# Default time range: 60 seconds starting at Unix epoch 1_700_000_000
DEFAULT_START_SEC = 1_700_000_000
DEFAULT_DURATION_SEC = 60


class DemoDataSource:
    """Synthetic data source for testing frontend-backend communication."""

    def __init__(
        self,
        start_sec: int = DEFAULT_START_SEC,
        duration_sec: int = DEFAULT_DURATION_SEC,
    ) -> None:
        self._start_sec = start_sec
        self._duration_sec = duration_sec
        self._end_sec = start_sec + duration_sec

    # -- Topic metadata --

    def _topics(self) -> list[TopicInfoJson]:
        return [
            TopicInfoJson(
                name="/sensor/imu",
                schemaName="ImuData",
                messageEncoding="json",
                schemaEncoding="jsonschema",
                schemaData=_b64_schema(IMU_SCHEMA),
            ),
            TopicInfoJson(
                name="/sensor/gps",
                schemaName="GpsData",
                messageEncoding="json",
                schemaEncoding="jsonschema",
                schemaData=_b64_schema(GPS_SCHEMA),
            ),
            TopicInfoJson(
                name="/diagnostics",
                schemaName="DiagnosticStatus",
                messageEncoding="json",
                schemaEncoding="jsonschema",
                schemaData=_b64_schema(DIAGNOSTICS_SCHEMA),
            ),
        ]

    def _topic_stats(self) -> dict[str, TopicStatsJson]:
        start = TimeJson(sec=self._start_sec, nsec=0)
        end = TimeJson(sec=self._end_sec - 1, nsec=990_000_000)
        return {
            "/sensor/imu": TopicStatsJson(
                numMessages=self._duration_sec * 100,
                firstMessageTime=start,
                lastMessageTime=end,
            ),
            "/sensor/gps": TopicStatsJson(
                numMessages=self._duration_sec * 10,
                firstMessageTime=start,
                lastMessageTime=end,
            ),
            "/diagnostics": TopicStatsJson(
                numMessages=self._duration_sec,
                firstMessageTime=start,
                lastMessageTime=TimeJson(sec=self._end_sec - 1, nsec=0),
            ),
        }

    # -- Protocol methods --

    async def initialize(self) -> InitializeResponse:
        return InitializeResponse(
            start=TimeJson(sec=self._start_sec, nsec=0),
            end=TimeJson(sec=self._end_sec, nsec=0),
            topics=self._topics(),
            topicStats=self._topic_stats(),
            profile="",
            metadata=[],
            publishersByTopic={
                "/sensor/imu": ["imu_node"],
                "/sensor/gps": ["gps_node"],
                "/diagnostics": ["diagnostics_node"],
            },
        )

    async def get_messages(
        self, request: MessagesRequest
    ) -> AsyncIterator[MessageFrameJson | StampMarker]:
        requested_topics = set(request.topics.keys())
        start_f = _time_to_float(request.start)
        end_f = _time_to_float(request.end)

        # Clamp to data range
        data_start = float(self._start_sec)
        data_end = float(self._end_sec)
        start_f = max(start_f, data_start)
        end_f = min(end_f, data_end)

        if start_f >= end_f:
            return

        # Generate all messages in time order across all requested topics.
        # We use a simple approach: iterate millisecond by millisecond over the
        # range, generating messages at the appropriate frequencies.
        last_stamp_sec = int(start_f) - 1

        t = start_f
        # Step at 10ms (100 Hz = highest frequency topic)
        step = 0.01

        while t < end_f:
            time_obj = _float_to_time(t)
            elapsed = t - data_start
            ms_index = round(elapsed * 1000)

            # IMU at 100 Hz (every 10ms)
            if "/sensor/imu" in requested_topics and ms_index % 10 == 0:
                yield self._make_imu_message(time_obj, elapsed)

            # GPS at 10 Hz (every 100ms)
            if "/sensor/gps" in requested_topics and ms_index % 100 == 0:
                yield self._make_gps_message(time_obj, elapsed)

            # Diagnostics at 1 Hz (every 1000ms)
            if "/diagnostics" in requested_topics and ms_index % 1000 == 0:
                yield self._make_diagnostics_message(time_obj, elapsed)

            # Emit stamp marker every second of data time
            if time_obj.sec > last_stamp_sec:
                last_stamp_sec = time_obj.sec
                yield StampMarker(stamp=TimeJson(sec=time_obj.sec, nsec=0))

            t += step

    async def get_backfill(self, request: BackfillRequest) -> list[MessageFrameJson]:
        requested_topics = set(request.topics.keys())
        target_f = _time_to_float(request.time)
        data_start = float(self._start_sec)

        messages: list[MessageFrameJson] = []

        for topic in requested_topics:
            msg = self._last_message_at(topic, target_f, data_start)
            if msg is not None:
                messages.append(msg)

        return messages

    # -- Message generators --

    def _make_imu_message(self, time: TimeJson, elapsed: float) -> MessageFrameJson:
        data = {
            "timestamp": time.sec + time.nsec / 1e9,
            "linear_acceleration": {
                "x": 0.1 * math.sin(elapsed * 2),
                "y": 0.05 * math.cos(elapsed * 1.5),
                "z": 9.81 + 0.02 * math.sin(elapsed * 3),
            },
            "angular_velocity": {
                "x": 0.01 * math.sin(elapsed),
                "y": 0.01 * math.cos(elapsed),
                "z": 0.005 * math.sin(elapsed * 0.5),
            },
        }
        return MessageFrameJson(
            topic="/sensor/imu",
            receiveTime=time,
            data=_b64_message(data),
        )

    def _make_gps_message(self, time: TimeJson, elapsed: float) -> MessageFrameJson:
        # Simulate a slow circular path
        data = {
            "timestamp": time.sec + time.nsec / 1e9,
            "latitude": 48.1351 + 0.001 * math.sin(elapsed * 0.1),
            "longitude": 11.5820 + 0.001 * math.cos(elapsed * 0.1),
            "altitude": 520.0 + 2.0 * math.sin(elapsed * 0.05),
        }
        return MessageFrameJson(
            topic="/sensor/gps",
            receiveTime=time,
            data=_b64_message(data),
        )

    def _make_diagnostics_message(
        self, time: TimeJson, elapsed: float
    ) -> MessageFrameJson:
        level = "OK" if int(elapsed) % 10 != 0 else "WARN"
        data = {
            "timestamp": time.sec + time.nsec / 1e9,
            "level": level,
            "message": f"System status at t+{int(elapsed)}s",
            "hardware_id": "demo-vehicle-001",
        }
        return MessageFrameJson(
            topic="/diagnostics",
            receiveTime=time,
            data=_b64_message(data),
        )

    def _last_message_at(
        self, topic: str, target_f: float, data_start: float
    ) -> MessageFrameJson | None:
        """Find the last message for a topic at or before target_f."""
        if target_f < data_start:
            return None

        elapsed = target_f - data_start

        if topic == "/sensor/imu":
            # 100 Hz → last message at floor to nearest 10ms
            msg_elapsed = math.floor(elapsed * 100) / 100
            if msg_elapsed < 0:
                return None
            return self._make_imu_message(
                _float_to_time(data_start + msg_elapsed), msg_elapsed
            )
        elif topic == "/sensor/gps":
            # 10 Hz → last message at floor to nearest 100ms
            msg_elapsed = math.floor(elapsed * 10) / 10
            if msg_elapsed < 0:
                return None
            return self._make_gps_message(
                _float_to_time(data_start + msg_elapsed), msg_elapsed
            )
        elif topic == "/diagnostics":
            # 1 Hz → last message at floor to nearest second
            msg_elapsed = math.floor(elapsed)
            if msg_elapsed < 0:
                return None
            return self._make_diagnostics_message(
                _float_to_time(data_start + msg_elapsed), float(msg_elapsed)
            )

        return None
