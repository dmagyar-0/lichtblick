// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/**
 * JSON wire-protocol types for the backend message-level API.
 * These represent what goes over the wire (JSON), not internal Lichtblick types.
 */

export type TimeJson = {
  sec: number;
  nsec: number;
};

export type TopicInfoJson = {
  name: string;
  schemaName: string;
  messageEncoding: string;
  schemaEncoding: string;
  /** Base64-encoded schema bytes */
  schemaData: string;
};

export type TopicStatsJson = {
  numMessages: number;
  firstMessageTime?: TimeJson;
  lastMessageTime?: TimeJson;
};

export type InitializeResponse = {
  start: TimeJson;
  end: TimeJson;
  topics: TopicInfoJson[];
  topicStats: Record<string, TopicStatsJson>;
  profile: string;
  metadata?: Array<{ name: string; metadata: Record<string, string> }>;
  publishersByTopic?: Record<string, string[]>;
};

export type MessagesRequest = {
  topics: Record<string, { fields?: string[] }>;
  start: TimeJson;
  end: TimeJson;
};

export type MessageFrameJson = {
  topic: string;
  receiveTime: TimeJson;
  publishTime?: TimeJson;
  /** Base64-encoded serialized message bytes */
  data: string;
  sizeInBytes?: number;
};

export type BackfillRequest = {
  topics: Record<string, { fields?: string[] }>;
  time: TimeJson;
};

export type BackfillResponse = {
  messages: MessageFrameJson[];
};
