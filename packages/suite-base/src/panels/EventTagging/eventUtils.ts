// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { v4 as uuidv4 } from "uuid";

import {
  add,
  fromRFC3339String,
  fromSec,
  subtract,
  Time,
  toNanoSec,
  toSec,
} from "@lichtblick/rostime";
import {
  DataSourceEvent,
  TimelinePositionedEvent,
} from "@lichtblick/suite-base/context/EventsContext";

import { EventAttributeDefinition, EventAttributeOption, TaggedEvent } from "./types";

/** Coerce the string-shorthand option form into the object form. */
export function normalizeOption(option: string | EventAttributeOption): EventAttributeOption {
  return typeof option === "string" ? { value: option } : option;
}

/**
 * Flatten the attribute definition tree into the list of dropdowns that should
 * currently be visible, given the selected attribute values. A definition is
 * always visible; its option's child definitions become visible (depth-first)
 * once that option is selected.
 */
export function getVisibleAttributeDefinitions(
  definitions: readonly EventAttributeDefinition[],
  attributes: Record<string, string>,
): EventAttributeDefinition[] {
  const visible: EventAttributeDefinition[] = [];
  for (const definition of definitions) {
    visible.push(definition);
    const selected = attributes[definition.key];
    if (selected == undefined || selected === "") {
      continue;
    }
    const option = definition.options.map(normalizeOption).find((opt) => opt.value === selected);
    if (option?.children && option.children.length > 0) {
      visible.push(...getVisibleAttributeDefinitions(option.children, attributes));
    }
  }
  return visible;
}

/** Collect every attribute key declared anywhere in the (possibly nested) tree. */
function collectAttributeKeys(
  definitions: readonly EventAttributeDefinition[],
  keys: Set<string> = new Set<string>(),
): Set<string> {
  for (const definition of definitions) {
    keys.add(definition.key);
    for (const option of definition.options) {
      const { children } = normalizeOption(option);
      if (children) {
        collectAttributeKeys(children, keys);
      }
    }
  }
  return keys;
}

/**
 * Apply a single attribute change and drop values for child attributes that are
 * no longer reachable from the new selection (i.e. their parent option changed).
 * Values for keys not declared in the definitions (e.g. imported data) are kept.
 */
export function applyAttributeChange(
  definitions: readonly EventAttributeDefinition[],
  attributes: Record<string, string>,
  key: string,
  value: string,
): Record<string, string> {
  const next: Record<string, string> = { ...attributes, [key]: value };
  const visibleKeys = new Set(
    getVisibleAttributeDefinitions(definitions, next).map((definition) => definition.key),
  );
  const knownKeys = collectAttributeKeys(definitions);
  const pruned: Record<string, string> = {};
  for (const [attributeKey, attributeValue] of Object.entries(next)) {
    if (visibleKeys.has(attributeKey) || !knownKeys.has(attributeKey)) {
      pruned[attributeKey] = attributeValue;
    }
  }
  return pruned;
}

/** Absolute start and end times covered by a tagged event. */
export function taggedEventRange(event: TaggedEvent): { startTime: Time; endTime: Time } {
  const beforeSec = Math.max(event.beforeSec ?? 0, 0);
  const afterSec = Math.max(event.afterSec ?? 0, 0);
  return {
    startTime: subtract(event.timestamp, fromSec(beforeSec)),
    endTime: add(event.timestamp, fromSec(afterSec)),
  };
}

/** Convert a tagged event into the DataSourceEvent shape used by the timeline overlay. */
export function toDataSourceEvent(event: TaggedEvent): DataSourceEvent {
  const { startTime, endTime } = taggedEventRange(event);
  return {
    id: event.id,
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
    deviceId: "",
    metadata: event.attributes,
    startTime,
    startTimeInSeconds: toSec(startTime),
    endTime,
    endTimeInSeconds: toSec(endTime),
    timestampNanos: toNanoSec(event.timestamp).toString(),
    durationNanos: (toNanoSec(endTime) - toNanoSec(startTime)).toString(),
  };
}

/**
 * Position a tagged event on the timeline spanned by [timelineStart, timelineEnd],
 * producing the fractional positions consumed by the playback bar events overlay.
 */
export function positionTaggedEvent(
  event: TaggedEvent,
  timelineStart: Time,
  timelineEnd: Time,
): TimelinePositionedEvent {
  const dataSourceEvent = toDataSourceEvent(event);
  const timelineDurationSec = toSec(subtract(timelineEnd, timelineStart));
  const startSecondsSinceStart = toSec(subtract(dataSourceEvent.startTime, timelineStart));
  const endSecondsSinceStart = toSec(subtract(dataSourceEvent.endTime, timelineStart));
  return {
    event: dataSourceEvent,
    startPosition: timelineDurationSec > 0 ? startSecondsSinceStart / timelineDurationSec : 0,
    endPosition: timelineDurationSec > 0 ? endSecondsSinceStart / timelineDurationSec : 0,
    secondsSinceStart: startSecondsSinceStart,
  };
}

function parseTimestamp(value: unknown): Time | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return fromSec(value);
  }
  if (typeof value === "string") {
    return fromRFC3339String(value);
  }
  if (
    typeof value === "object" &&
    value != undefined &&
    typeof (value as Partial<Time>).sec === "number" &&
    typeof (value as Partial<Time>).nsec === "number"
  ) {
    return { sec: (value as Time).sec, nsec: (value as Time).nsec };
  }
  return undefined;
}

function parseOptionalSeconds(value: unknown, field: string, index: number): number | undefined {
  if (value == undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Event #${index + 1}: "${field}" must be a non-negative number`);
  }
  return value;
}

function parseAttributes(value: unknown, index: number): Record<string, string> {
  if (value == undefined) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Event #${index + 1}: "attributes" must be an object of string values`);
  }
  const attributes: Record<string, string> = {};
  for (const [key, attributeValue] of Object.entries(value)) {
    if (typeof attributeValue !== "string") {
      throw new Error(`Event #${index + 1}: attribute "${key}" must be a string`);
    }
    attributes[key] = attributeValue;
  }
  return attributes;
}

/**
 * Parse tagged events from external data (imported file or external service).
 * Accepts either a bare array of events or an object with an "events" array.
 * Timestamps may be given in seconds (number), RFC-3339 strings, or { sec, nsec }.
 * Throws an Error with a human readable message when the data is invalid.
 */
export function parseTaggedEvents(data: unknown): TaggedEvent[] {
  const rawEvents = Array.isArray(data)
    ? data
    : Array.isArray((data as { events?: unknown[] } | undefined)?.events)
      ? (data as { events: unknown[] }).events
      : undefined;
  if (rawEvents == undefined) {
    throw new Error(`Expected an array of events or an object with an "events" array`);
  }

  return rawEvents.map((raw, index) => {
    if (typeof raw !== "object" || raw == undefined || Array.isArray(raw)) {
      throw new Error(`Event #${index + 1}: expected an object`);
    }
    const record = raw as Record<string, unknown>;
    const timestamp = parseTimestamp(record.timestamp);
    if (!timestamp) {
      throw new Error(
        `Event #${index + 1}: "timestamp" must be seconds (number), an RFC-3339 string, or { sec, nsec }`,
      );
    }
    return {
      id: typeof record.id === "string" && record.id.length > 0 ? record.id : uuidv4(),
      timestamp,
      beforeSec: parseOptionalSeconds(record.beforeSec, "beforeSec", index),
      afterSec: parseOptionalSeconds(record.afterSec, "afterSec", index),
      attributes: parseAttributes(record.attributes, index),
      createdAt:
        typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString(),
    };
  });
}

/**
 * Parse a single option, which may be a plain string (no children) or an object
 * with a `value`, optional `label`, and optional nested `children` definitions.
 * Plain strings are preserved as strings so existing flat configs round-trip.
 */
function parseAttributeOption(
  raw: unknown,
  definitionKey: string,
  seenKeys: Set<string>,
): string | EventAttributeOption {
  if (typeof raw === "string") {
    if (raw.length === 0) {
      throw new Error(`Attribute "${definitionKey}": option values must be non-empty strings`);
    }
    return raw;
  }
  if (typeof raw !== "object" || raw == undefined || Array.isArray(raw)) {
    throw new Error(`Attribute "${definitionKey}": each option must be a string or an object`);
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.value !== "string" || record.value.length === 0) {
    throw new Error(`Attribute "${definitionKey}": option "value" must be a non-empty string`);
  }
  return {
    value: record.value,
    label: typeof record.label === "string" ? record.label : undefined,
    children:
      record.children != undefined
        ? parseDefinitions(record.children, seenKeys, `option "${record.value}"`)
        : undefined,
  };
}

/**
 * Recursively parse a list of attribute definitions. Accepts either a bare array
 * or an object with an "attributes" array. `seenKeys` is shared across the whole
 * tree because attribute values are stored in a single flat map per event, so
 * keys must be globally unique.
 */
function parseDefinitions(
  data: unknown,
  seenKeys: Set<string>,
  context: string,
): EventAttributeDefinition[] {
  const rawDefinitions = Array.isArray(data)
    ? data
    : Array.isArray((data as { attributes?: unknown[] } | undefined)?.attributes)
      ? (data as { attributes: unknown[] }).attributes
      : undefined;
  if (rawDefinitions == undefined || rawDefinitions.length === 0) {
    throw new Error(
      `${context}: expected a non-empty array of attribute definitions or an object with an "attributes" array`,
    );
  }

  return rawDefinitions.map((raw, index) => {
    if (typeof raw !== "object" || raw == undefined || Array.isArray(raw)) {
      throw new Error(`Attribute #${index + 1}: expected an object`);
    }
    const record = raw as Record<string, unknown>;
    if (typeof record.key !== "string" || record.key.length === 0) {
      throw new Error(`Attribute #${index + 1}: "key" must be a non-empty string`);
    }
    const key = record.key;
    if (seenKeys.has(key)) {
      throw new Error(`Attribute #${index + 1}: duplicate key "${key}"`);
    }
    seenKeys.add(key);
    if (!Array.isArray(record.options) || record.options.length === 0) {
      throw new Error(`Attribute "${key}": "options" must be a non-empty array of strings`);
    }
    return {
      key,
      label: typeof record.label === "string" ? record.label : undefined,
      options: record.options.map((option) => parseAttributeOption(option, key, seenKeys)),
    };
  });
}

/**
 * Parse attribute definitions from a config file. Accepts either a bare array
 * or an object with an "attributes" array, e.g.
 * `{ "attributes": [{ "key": "weather", "label": "Weather", "options": ["sunny", "rain"] }] }`.
 * Options may nest child definitions to build cascading (multi-level) dropdowns.
 */
export function parseAttributeDefinitions(data: unknown): EventAttributeDefinition[] {
  return parseDefinitions(data, new Set<string>(), "Attribute config");
}

/** Serialize tagged events for export (and for sending to external systems). */
export function serializeTaggedEvents(events: readonly TaggedEvent[]): string {
  const serialized = JSON.stringify(
    {
      version: 1,
      exportedAt: new Date().toISOString(),
      events: events.map((event) => ({
        id: event.id,
        timestamp: event.timestamp,
        timestampSec: toSec(event.timestamp),
        beforeSec: event.beforeSec,
        afterSec: event.afterSec,
        attributes: event.attributes,
        createdAt: event.createdAt,
      })),
    },
    undefined,
    2,
  );
  return serialized ?? "";
}
