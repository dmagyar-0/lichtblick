// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Response } from "express";

import { MessageFrameJson, TimeJson } from "../types/protocol";

/**
 * Write a single NDJSON message line to the response.
 * Returns false if the response is no longer writable (client disconnected).
 */
export function writeMessageLine(res: Response, frame: MessageFrameJson): boolean {
  if (res.writableEnded) {
    return false;
  }
  return res.write(JSON.stringify(frame) + "\n");
}

/**
 * Write a stamp line to indicate progress to the client.
 * The frontend uses stamp lines to know how far the stream has progressed.
 */
export function writeStampLine(res: Response, stamp: TimeJson): boolean {
  if (res.writableEnded) {
    return false;
  }
  return res.write(JSON.stringify({ type: "stamp", stamp }) + "\n");
}
