// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  applyAttributeChange,
  getVisibleAttributeDefinitions,
  getVisibleAttributeGroups,
  parseAttributeDefinitions,
  parseTaggedEvents,
  positionTaggedEvent,
  serializeTaggedEvents,
  taggedEventRange,
  toDataSourceEvent,
} from "./eventUtils";
import { EventAttributeDefinition, TaggedEvent } from "./types";

const baseEvent: TaggedEvent = {
  id: "event-1",
  timestamp: { sec: 100, nsec: 0 },
  beforeSec: 2,
  afterSec: 3,
  attributes: { weather: "rain" },
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("taggedEventRange", () => {
  it("expands the timestamp by the before and after durations", () => {
    expect(taggedEventRange(baseEvent)).toEqual({
      startTime: { sec: 98, nsec: 0 },
      endTime: { sec: 103, nsec: 0 },
    });
  });

  it("collapses to the timestamp when before and after are omitted", () => {
    const event = { ...baseEvent, beforeSec: undefined, afterSec: undefined };
    expect(taggedEventRange(event)).toEqual({
      startTime: { sec: 100, nsec: 0 },
      endTime: { sec: 100, nsec: 0 },
    });
  });
});

describe("toDataSourceEvent", () => {
  it("maps tagged events to the timeline event shape", () => {
    const dataSourceEvent = toDataSourceEvent(baseEvent);
    expect(dataSourceEvent).toMatchObject({
      id: "event-1",
      metadata: { weather: "rain" },
      startTimeInSeconds: 98,
      endTimeInSeconds: 103,
      timestampNanos: "100000000000",
      durationNanos: "5000000000",
    });
  });
});

describe("positionTaggedEvent", () => {
  it("computes fractional positions relative to the timeline", () => {
    const positioned = positionTaggedEvent(baseEvent, { sec: 90, nsec: 0 }, { sec: 190, nsec: 0 });
    expect(positioned.startPosition).toBeCloseTo(0.08);
    expect(positioned.endPosition).toBeCloseTo(0.13);
    expect(positioned.secondsSinceStart).toBeCloseTo(8);
  });

  it("returns zero positions for an empty timeline", () => {
    const positioned = positionTaggedEvent(baseEvent, { sec: 100, nsec: 0 }, { sec: 100, nsec: 0 });
    expect(positioned.startPosition).toBe(0);
    expect(positioned.endPosition).toBe(0);
  });
});

describe("parseTaggedEvents", () => {
  it("parses a bare array with timestamps in seconds", () => {
    const events = parseTaggedEvents([
      { timestamp: 12.5, beforeSec: 1, attributes: { weather: "fog" } },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      timestamp: { sec: 12, nsec: 500000000 },
      beforeSec: 1,
      attributes: { weather: "fog" },
    });
    expect(events[0]!.id).toEqual(expect.any(String));
  });

  it("parses an object with an events array and { sec, nsec } timestamps", () => {
    const events = parseTaggedEvents({
      events: [{ id: "abc", timestamp: { sec: 5, nsec: 7 } }],
    });
    expect(events).toEqual([
      {
        id: "abc",
        timestamp: { sec: 5, nsec: 7 },
        beforeSec: undefined,
        afterSec: undefined,
        attributes: {},
        createdAt: expect.any(String),
      },
    ]);
  });

  it("round-trips events through the export serialization", () => {
    const serialized = serializeTaggedEvents([baseEvent]);
    const events = parseTaggedEvents(JSON.parse(serialized));
    expect(events).toEqual([baseEvent]);
  });

  it("rejects events without a valid timestamp", () => {
    expect(() => parseTaggedEvents([{ timestamp: "not-a-time" }])).toThrow(/timestamp/);
    expect(() => parseTaggedEvents([{}])).toThrow(/timestamp/);
  });

  it("rejects non-array input", () => {
    expect(() => parseTaggedEvents({ foo: "bar" })).toThrow(/array of events/);
  });

  it("rejects negative before/after durations", () => {
    expect(() => parseTaggedEvents([{ timestamp: 1, beforeSec: -1 }])).toThrow(/beforeSec/);
  });

  it("rejects non-string attribute values", () => {
    expect(() => parseTaggedEvents([{ timestamp: 1, attributes: { speed: 12 } }])).toThrow(
      /attribute "speed"/,
    );
  });
});

describe("parseAttributeDefinitions", () => {
  it("parses a bare array of definitions", () => {
    expect(
      parseAttributeDefinitions([{ key: "weather", label: "Weather", options: ["sunny"] }]),
    ).toEqual([{ key: "weather", label: "Weather", options: ["sunny"] }]);
  });

  it("parses an object with an attributes array", () => {
    expect(
      parseAttributeDefinitions({ attributes: [{ key: "roadType", options: ["urban"] }] }),
    ).toEqual([{ key: "roadType", label: undefined, options: ["urban"] }]);
  });

  it("rejects definitions without options", () => {
    expect(() => parseAttributeDefinitions([{ key: "weather", options: [] }])).toThrow(/options/);
  });

  it("rejects duplicate keys", () => {
    expect(() =>
      parseAttributeDefinitions([
        { key: "weather", options: ["sunny"] },
        { key: "weather", options: ["rain"] },
      ]),
    ).toThrow(/duplicate key/);
  });

  it("rejects empty input", () => {
    expect(() => parseAttributeDefinitions([])).toThrow(/non-empty/);
  });

  it("parses nested options with child definitions", () => {
    const definitions = parseAttributeDefinitions([
      {
        key: "weather",
        options: [
          "sunny",
          { value: "rain", children: [{ key: "intensity", options: ["light", "heavy"] }] },
        ],
      },
    ]);
    expect(definitions).toEqual([
      {
        key: "weather",
        label: undefined,
        options: [
          "sunny",
          {
            value: "rain",
            label: undefined,
            children: [{ key: "intensity", label: undefined, options: ["light", "heavy"] }],
          },
        ],
      },
    ]);
  });

  it("rejects duplicate keys across nesting levels", () => {
    expect(() =>
      parseAttributeDefinitions([
        {
          key: "weather",
          options: [{ value: "rain", children: [{ key: "weather", options: ["x"] }] }],
        },
      ]),
    ).toThrow(/duplicate key/);
  });

  it("parses the optional group field", () => {
    expect(
      parseAttributeDefinitions([{ key: "weather", group: "ODD relevant", options: ["sunny"] }]),
    ).toEqual([{ key: "weather", label: undefined, group: "ODD relevant", options: ["sunny"] }]);
  });

  it("rejects option objects without a value", () => {
    expect(() =>
      parseAttributeDefinitions([{ key: "weather", options: [{ label: "Rain" }] }]),
    ).toThrow(/value/);
  });
});

const cascadingDefinitions: EventAttributeDefinition[] = [
  {
    key: "weather",
    options: [
      "sunny",
      { value: "rain", children: [{ key: "intensity", options: ["light", "heavy"] }] },
    ],
  },
  { key: "roadType", options: ["urban", "highway"] },
];

describe("getVisibleAttributeDefinitions", () => {
  it("shows only top-level definitions when no cascading option is selected", () => {
    const visible = getVisibleAttributeDefinitions(cascadingDefinitions, { weather: "sunny" });
    expect(visible.map((definition) => definition.key)).toEqual(["weather", "roadType"]);
  });

  it("reveals child definitions when their parent option is selected", () => {
    const visible = getVisibleAttributeDefinitions(cascadingDefinitions, { weather: "rain" });
    expect(visible.map((definition) => definition.key)).toEqual([
      "weather",
      "intensity",
      "roadType",
    ]);
  });
});

describe("applyAttributeChange", () => {
  it("keeps child values while the parent option stays selected", () => {
    const result = applyAttributeChange(
      cascadingDefinitions,
      { weather: "rain", intensity: "heavy" },
      "roadType",
      "urban",
    );
    expect(result).toEqual({ weather: "rain", intensity: "heavy", roadType: "urban" });
  });

  it("drops now-hidden child values when the parent option changes", () => {
    const result = applyAttributeChange(
      cascadingDefinitions,
      { weather: "rain", intensity: "heavy" },
      "weather",
      "sunny",
    );
    expect(result).toEqual({ weather: "sunny" });
  });

  it("preserves values for keys not declared in the definitions", () => {
    const result = applyAttributeChange(
      cascadingDefinitions,
      { weather: "rain", intensity: "heavy", imported: "value" },
      "weather",
      "sunny",
    );
    expect(result).toEqual({ weather: "sunny", imported: "value" });
  });
});

const groupedDefinitions: EventAttributeDefinition[] = [
  { key: "weather", group: "ODD relevant", options: ["sunny", "rain"] },
  { key: "feature", group: "Feature based", options: ["ACC", "AEB"] },
  { key: "roadType", group: "ODD relevant", options: ["urban", "highway"] },
  { key: "notes", options: ["a", "b"] },
];

describe("getVisibleAttributeGroups", () => {
  it("merges definitions that share a group, in first-seen order", () => {
    const groups = getVisibleAttributeGroups(groupedDefinitions, {});
    expect(
      groups.map((group) => ({
        label: group.label,
        keys: group.definitions.map((definition) => definition.key),
      })),
    ).toEqual([
      { label: "ODD relevant", keys: ["weather", "roadType"] },
      { label: "Feature based", keys: ["feature"] },
      { label: undefined, keys: ["notes"] },
    ]);
  });

  it("places revealed children in their parent option's group by inheritance", () => {
    const definitions: EventAttributeDefinition[] = [
      {
        key: "weather",
        group: "ODD relevant",
        options: [
          "sunny",
          { value: "rain", children: [{ key: "intensity", options: ["light", "heavy"] }] },
        ],
      },
    ];
    const groups = getVisibleAttributeGroups(definitions, { weather: "rain" });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toEqual("ODD relevant");
    expect(groups[0]!.definitions.map((definition) => definition.key)).toEqual([
      "weather",
      "intensity",
    ]);
  });

  it("lets a child override the inherited group", () => {
    const definitions: EventAttributeDefinition[] = [
      {
        key: "weather",
        group: "ODD relevant",
        options: [
          {
            value: "rain",
            children: [{ key: "feature", group: "Feature based", options: ["ACC"] }],
          },
        ],
      },
    ];
    const groups = getVisibleAttributeGroups(definitions, { weather: "rain" });
    expect(groups.map((group) => group.label)).toEqual(["ODD relevant", "Feature based"]);
  });
});
