// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  InitializeResponse,
  MessageFrameJson,
  TimeJson,
  TopicInfoJson,
  TopicStatsJson,
} from "../types/protocol";
import { IDataProvider } from "./IDataProvider";

/** Duration of the demo recording in seconds. */
const RECORDING_DURATION_SEC = 60;

/** Message frequency in Hz for each topic. */
const MESSAGE_RATE_HZ = 10;

/** Total number of messages per topic. */
const TOTAL_MESSAGES_PER_TOPIC = RECORDING_DURATION_SEC * MESSAGE_RATE_HZ;

/** Recording start time (arbitrary fixed epoch). */
const START_TIME: TimeJson = { sec: 1700000000, nsec: 0 };

/** Recording end time. */
const END_TIME: TimeJson = { sec: START_TIME.sec + RECORDING_DURATION_SEC, nsec: 0 };

/**
 * JSON schema for a simple sensor reading.
 * Uses the "jsonschema" encoding which Lichtblick can display in Raw Messages panel.
 */
const SENSOR_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    timestamp: { type: "number" },
    value: { type: "number" },
    label: { type: "string" },
  },
});

/** JSON schema for a pose/position message. */
const POSE_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    timestamp: { type: "number" },
    x: { type: "number" },
    y: { type: "number" },
    z: { type: "number" },
  },
});

const TOPICS: TopicInfoJson[] = [
  {
    name: "/sensor/temperature",
    schemaName: "SensorReading",
    messageEncoding: "json",
    schemaEncoding: "jsonschema",
    schemaData: Buffer.from(SENSOR_SCHEMA).toString("base64"),
  },
  {
    name: "/sensor/velocity",
    schemaName: "SensorReading",
    messageEncoding: "json",
    schemaEncoding: "jsonschema",
    schemaData: Buffer.from(SENSOR_SCHEMA).toString("base64"),
  },
  {
    name: "/vehicle/pose",
    schemaName: "Pose",
    messageEncoding: "json",
    schemaEncoding: "jsonschema",
    schemaData: Buffer.from(POSE_SCHEMA).toString("base64"),
  },
];

/**
 * Compare two TimeJson values. Returns negative if a < b, 0 if equal, positive if a > b.
 */
function compareTime(a: TimeJson, b: TimeJson): number {
  if (a.sec !== b.sec) {
    return a.sec - b.sec;
  }
  return a.nsec - b.nsec;
}

/**
 * Generate a message payload for a given topic at a given index.
 */
function generatePayload(topicName: string, index: number): Record<string, unknown> {
  const t = index / MESSAGE_RATE_HZ;

  switch (topicName) {
    case "/sensor/temperature":
      return {
        timestamp: START_TIME.sec + t,
        value: 20 + 5 * Math.sin((2 * Math.PI * t) / 30),
        label: "ambient_temp",
      };
    case "/sensor/velocity":
      return {
        timestamp: START_TIME.sec + t,
        value: 10 + 3 * Math.sin((2 * Math.PI * t) / 15) + 0.5 * Math.cos((2 * Math.PI * t) / 7),
        label: "longitudinal_vel",
      };
    case "/vehicle/pose":
      return {
        timestamp: START_TIME.sec + t,
        x: 10 * Math.cos((2 * Math.PI * t) / 60),
        y: 10 * Math.sin((2 * Math.PI * t) / 60),
        z: 0,
      };
    default:
      return { timestamp: START_TIME.sec + t, value: index };
  }
}

/**
 * Generate a MessageFrameJson for a topic at a given message index.
 */
function generateMessage(topicName: string, index: number): MessageFrameJson {
  const timeSec = START_TIME.sec + Math.floor(index / MESSAGE_RATE_HZ);
  const timeNsec = (index % MESSAGE_RATE_HZ) * (1_000_000_000 / MESSAGE_RATE_HZ);

  const payload = generatePayload(topicName, index);
  const payloadBytes = Buffer.from(JSON.stringify(payload));

  return {
    topic: topicName,
    receiveTime: { sec: timeSec, nsec: timeNsec },
    data: payloadBytes.toString("base64"),
    sizeInBytes: payloadBytes.byteLength,
  };
}

/**
 * Demo data provider that generates synthetic sensor data for testing
 * the frontend-backend communication pipeline.
 *
 * Generates 3 topics at 10 Hz over 60 seconds:
 *   - /sensor/temperature — sine wave (20°C ± 5°C)
 *   - /sensor/velocity — compound sine wave
 *   - /vehicle/pose — circular trajectory
 */
export class DemoDataProvider implements IDataProvider {
  public initialize(): InitializeResponse {
    const topicStats: Record<string, TopicStatsJson> = {};
    for (const topic of TOPICS) {
      const firstMsg = generateMessage(topic.name, 0);
      const lastMsg = generateMessage(topic.name, TOTAL_MESSAGES_PER_TOPIC - 1);
      topicStats[topic.name] = {
        numMessages: TOTAL_MESSAGES_PER_TOPIC,
        firstMessageTime: firstMsg.receiveTime,
        lastMessageTime: lastMsg.receiveTime,
      };
    }

    return {
      start: START_TIME,
      end: END_TIME,
      topics: TOPICS,
      topicStats,
      profile: "demo",
      metadata: [
        {
          name: "recording",
          metadata: {
            description: "Synthetic demo recording for backend communication testing",
            duration: `${RECORDING_DURATION_SEC}s`,
            messageRate: `${MESSAGE_RATE_HZ} Hz per topic`,
          },
        },
      ],
      publishersByTopic: Object.fromEntries(TOPICS.map((t) => [t.name, ["demo-publisher"]])),
    };
  }

  public *getMessages(
    topics: Record<string, { fields?: string[] }>,
    start: TimeJson,
    end: TimeJson,
  ): Iterable<MessageFrameJson> {
    const topicNames = Object.keys(topics);
    if (topicNames.length === 0) {
      return;
    }

    // Generate all messages for requested topics, interleaved by time
    const iterators = topicNames
      .filter((name) => TOPICS.some((t) => t.name === name))
      .map((name) => ({ name, index: 0 }));

    if (iterators.length === 0) {
      return;
    }

    // Simple round-robin interleave: generate messages sorted by time
    // For each topic, find the starting index based on start time
    for (const iter of iterators) {
      const startOffset =
        (start.sec - START_TIME.sec) * MESSAGE_RATE_HZ +
        Math.floor((start.nsec / 1_000_000_000) * MESSAGE_RATE_HZ);
      iter.index = Math.max(0, startOffset);
    }

    // Merge messages from all topics in time order
    for (;;) {
      let bestIter: (typeof iterators)[0] | undefined;
      let bestMsg: MessageFrameJson | undefined;

      for (const iter of iterators) {
        if (iter.index >= TOTAL_MESSAGES_PER_TOPIC) {
          continue;
        }
        const msg = generateMessage(iter.name, iter.index);
        if (compareTime(msg.receiveTime, end) >= 0) {
          continue;
        }
        if (compareTime(msg.receiveTime, start) < 0) {
          iter.index++;
          continue;
        }
        if (!bestMsg || compareTime(msg.receiveTime, bestMsg.receiveTime) < 0) {
          bestIter = iter;
          bestMsg = msg;
        }
      }

      if (!bestIter || !bestMsg) {
        break;
      }

      yield bestMsg;
      bestIter.index++;
    }
  }

  public getBackfillMessages(
    topics: Record<string, { fields?: string[] }>,
    time: TimeJson,
  ): MessageFrameJson[] {
    const results: MessageFrameJson[] = [];
    const topicNames = Object.keys(topics);

    for (const topicName of topicNames) {
      if (!TOPICS.some((t) => t.name === topicName)) {
        continue;
      }

      // Find the message index at or just before the given time
      const offset =
        (time.sec - START_TIME.sec) * MESSAGE_RATE_HZ +
        Math.floor((time.nsec / 1_000_000_000) * MESSAGE_RATE_HZ);
      const index = Math.min(Math.max(0, offset), TOTAL_MESSAGES_PER_TOPIC - 1);

      // Find the message at or before the requested time
      let bestIndex = -1;
      for (let i = index; i >= Math.max(0, index - 1); i--) {
        const msg = generateMessage(topicName, i);
        if (compareTime(msg.receiveTime, time) <= 0) {
          bestIndex = i;
          break;
        }
      }

      if (bestIndex >= 0) {
        results.push(generateMessage(topicName, bestIndex));
      }
    }

    return results;
  }
}
