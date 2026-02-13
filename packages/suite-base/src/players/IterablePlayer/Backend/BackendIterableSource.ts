// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Time } from "@lichtblick/rostime";
import { Immutable, MessageEvent } from "@lichtblick/suite";
import { TopicSelection, TopicStats } from "@lichtblick/suite-base/players/types";

import BackendApiClient from "./BackendApiClient";
import { parseBackfillResponse, parseMessageStream } from "./messageStreamParser";
import {
  GetBackfillMessagesArgs,
  ISerializedIterableSource,
  Initialization,
  IteratorResult,
  MessageIteratorArgs,
  TopicWithDecodingInfo,
} from "../IIterableSource";

/**
 * Decode a base64 string into a Uint8Array.
 */
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert a TopicSelection (Map<string, SubscribePayload>) into the
 * Record<string, { fields?: string[] }> shape expected by the backend API.
 */
function convertTopics(
  topics: Immutable<TopicSelection>,
): Record<string, { fields?: string[] }> {
  const result: Record<string, { fields?: string[] }> = {};
  for (const [name, payload] of topics) {
    result[name] = { fields: payload.fields };
  }
  return result;
}

/**
 * An ISerializedIterableSource that fetches data from a backend HTTP service
 * via BackendApiClient, parsing streaming NDJSON responses into the
 * IteratorResult<Uint8Array> format consumed by the IterablePlayer pipeline.
 */
export class BackendIterableSource implements ISerializedIterableSource {
  public readonly sourceType = "serialized";

  #client: BackendApiClient;
  #sourceId: string;
  #start: Time | undefined;

  public constructor(baseUrl: string, sourceId: string, auth?: string) {
    this.#client = new BackendApiClient(baseUrl, { auth });
    this.#sourceId = sourceId;
  }

  public async initialize(): Promise<Initialization> {
    const resp = await this.#client.initialize(this.#sourceId);
    this.#start = resp.start;

    const topics: TopicWithDecodingInfo[] = resp.topics.map((t) => ({
      name: t.name,
      schemaName: t.schemaName,
      messageEncoding: t.messageEncoding,
      schemaEncoding: t.schemaEncoding,
      schemaData: base64ToUint8Array(t.schemaData),
    }));

    const topicStats = new Map<string, TopicStats>(
      Object.entries(resp.topicStats).map(([name, stats]) => [
        name,
        {
          numMessages: stats.numMessages,
          firstMessageTime: stats.firstMessageTime,
          lastMessageTime: stats.lastMessageTime,
        },
      ]),
    );

    const publishersByTopic = new Map<string, Set<string>>(
      Object.entries(resp.publishersByTopic ?? {}).map(([name, publishers]) => [
        name,
        new Set(publishers),
      ]),
    );

    return {
      start: resp.start,
      end: resp.end,
      topics,
      topicStats,
      datatypes: new Map(), // populated from schemas by DeserializingIterableSource
      profile: resp.profile,
      metadata: resp.metadata ?? [],
      publishersByTopic,
      alerts: [],
    };
  }

  public async *messageIterator(
    args: Immutable<MessageIteratorArgs>,
  ): AsyncIterableIterator<Readonly<IteratorResult<Uint8Array>>> {
    const topics = args.topics != undefined ? convertTopics(args.topics) : {};

    const stream = this.#client.getMessages(this.#sourceId, {
      topics,
      start: args.start ?? this.#start!,
      end: args.end ?? { sec: Number.MAX_SAFE_INTEGER, nsec: 0 },
    });

    yield* parseMessageStream(stream);
  }

  public async getBackfillMessages(
    args: Immutable<GetBackfillMessagesArgs>,
  ): Promise<MessageEvent<Uint8Array>[]> {
    const topics = args.topics != undefined ? convertTopics(args.topics) : {};

    const resp = await this.#client.getBackfill(this.#sourceId, {
      topics,
      time: args.time,
    });

    return parseBackfillResponse(resp);
  }

  public getStart(): Time | undefined {
    return this.#start;
  }
}
