// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { MessageEvent } from "@lichtblick/suite-base/players/types";

import { IteratorResult } from "../IIterableSource";
import { BackfillResponse, MessageFrameJson } from "./types";

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
 * Convert a single MessageFrameJson into a MessageEvent<Uint8Array>.
 */
function frameToMessageEvent(frame: MessageFrameJson): MessageEvent<Uint8Array> {
  const message = base64ToUint8Array(frame.data);
  return {
    topic: frame.topic,
    schemaName: "",
    receiveTime: frame.receiveTime,
    publishTime: frame.publishTime,
    sizeInBytes: message.byteLength,
    message,
  };
}

/**
 * Parse an NDJSON ReadableStream from the `/messages` endpoint into an async
 * iterable of IteratorResult<Uint8Array> values.
 *
 * The stream protocol uses newline-delimited JSON with two line types:
 * - Message line: `{"topic":"/imu","receiveTime":{"sec":1700000000,"nsec":500},"data":"base64..."}`
 * - Stamp line: `{"type":"stamp","stamp":{"sec":1700000001,"nsec":0}}`
 *
 * Empty lines are skipped.
 */
export async function* parseMessageStream(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncIterableIterator<Readonly<IteratorResult<Uint8Array>>> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      if (signal?.aborted) {
        await reader.cancel();
        return;
      }

      const { done, value } = await reader.read();

      if (value != null) {
        buffer += decoder.decode(value, { stream: true });
      }

      const lines = buffer.split("\n");

      // If the stream is not done, the last element may be an incomplete line —
      // keep it in the buffer for the next iteration.
      if (done) {
        buffer = "";
      } else {
        buffer = lines.pop() ?? "";
      }

      for (const line of lines) {
        if (signal?.aborted) {
          await reader.cancel();
          return;
        }

        const trimmed = line.trim();
        if (trimmed.length === 0) {
          continue;
        }

        const parsed: Record<string, unknown> = JSON.parse(trimmed);

        if (parsed.type === "stamp" && parsed.stamp != null) {
          yield {
            type: "stamp",
            stamp: parsed.stamp as { sec: number; nsec: number },
          };
        } else {
          const frame = parsed as unknown as MessageFrameJson;
          yield {
            type: "message-event",
            msgEvent: frameToMessageEvent(frame),
          };
        }
      }

      if (done) {
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Convert a BackfillResponse (already-parsed JSON) into an array of
 * MessageEvent<Uint8Array>.
 */
export function parseBackfillResponse(
  response: BackfillResponse,
): MessageEvent<Uint8Array>[] {
  return response.messages.map(frameToMessageEvent);
}
