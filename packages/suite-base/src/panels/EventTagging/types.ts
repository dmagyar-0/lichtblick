// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Time } from "@lichtblick/rostime";

/**
 * Definition of a single event attribute. Each attribute is a "pick one from a
 * list" selection (e.g. weather: sunny | rain | snow).
 */
export type EventAttributeDefinition = {
  /** Unique key used to store the attribute value on an event (e.g. "weather"). */
  key: string;
  /** Human readable label shown in the UI. Falls back to the key when omitted. */
  label?: string;
  /** Available values for this attribute. Exactly one can be selected per event. */
  options: string[];
};

/**
 * A single tagged event. Events are anchored at a timestamp and may optionally
 * extend before and/or after that timestamp to cover a time range.
 */
export type TaggedEvent = {
  id: string;
  /** Absolute time of the event within the data source. */
  timestamp: Time;
  /** Optional number of seconds before the timestamp included in the event range. */
  beforeSec?: number;
  /** Optional number of seconds after the timestamp included in the event range. */
  afterSec?: number;
  /** Selected attribute values, keyed by attribute definition key. */
  attributes: Record<string, string>;
  /** ISO-8601 creation date of the tag itself. */
  createdAt: string;
};

export type EventTaggingConfig = {
  /** The attribute schema used when tagging events. Replaceable from a config file. */
  attributeDefinitions: EventAttributeDefinition[];
  /** Default "seconds before" pre-filled in the tagging form. */
  defaultBeforeSec: number;
  /** Default "seconds after" pre-filled in the tagging form. */
  defaultAfterSec: number;
  /** The tagged events, persisted with the layout. */
  events: TaggedEvent[];
};
