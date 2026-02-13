// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  InitializeResponse,
  MessageFrameJson,
  TimeJson,
} from "../types/protocol";

/**
 * Abstract interface for data providers.
 *
 * A data provider is responsible for producing metadata (topics, schemas, time
 * range) and messages for a given source. The backend routes delegate to a
 * provider instance to fulfill API requests.
 *
 * Implementations can read from MCAP files, databases, live ROS connections,
 * or — as in DemoDataProvider — generate synthetic data.
 */
export interface IDataProvider {
  /**
   * Return metadata for the source: topics, schemas, time range, stats.
   */
  initialize(): InitializeResponse;

  /**
   * Return messages for the given topics within [start, end), ordered by receiveTime ascending.
   *
   * This returns an iterable so that large result sets can be streamed
   * without buffering the entire dataset in memory.
   */
  getMessages(
    topics: Record<string, { fields?: string[] }>,
    start: TimeJson,
    end: TimeJson,
  ): Iterable<MessageFrameJson>;

  /**
   * Return the most recent message per topic at or before the given time.
   */
  getBackfillMessages(
    topics: Record<string, { fields?: string[] }>,
    time: TimeJson,
  ): MessageFrameJson[];
}
