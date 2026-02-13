// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Router, Request, Response } from "express";

import { IDataProvider } from "../providers/IDataProvider";
import { writeMessageLine, writeStampLine } from "../streaming/ndjson";
import { BackfillRequest, MessagesRequest } from "../types/protocol";

/** Number of messages between stamp lines during streaming. */
const STAMP_INTERVAL = 100;

/**
 * Create an Express router for the /api/sources/:sourceId endpoints.
 *
 * @param providers - Map of sourceId → IDataProvider. When a sourceId is not
 *   found in the map, the route returns 404.
 */
export function createSourcesRouter(providers: Map<string, IDataProvider>): Router {
  const router = Router();

  /**
   * Middleware: resolve sourceId to a provider instance.
   */
  router.use("/:sourceId", (req: Request, res: Response, next) => {
    const sourceId = req.params.sourceId as string;
    const provider = providers.get(sourceId);
    if (!provider) {
      res.status(404).json({ error: `Source "${sourceId}" not found` });
      return;
    }
    // Attach provider to request for downstream handlers
    (req as Request & { provider: IDataProvider }).provider = provider;
    next();
  });

  /**
   * POST /api/sources/:sourceId/initialize
   *
   * Returns metadata: topics, schemas, time range, stats.
   */
  router.post("/:sourceId/initialize", (req: Request, res: Response) => {
    const provider = (req as Request & { provider: IDataProvider }).provider;
    const response = provider.initialize();
    res.json(response);
  });

  /**
   * POST /api/sources/:sourceId/messages
   *
   * Streams messages as NDJSON (newline-delimited JSON).
   * Request body: { topics, start, end }
   *
   * Each line is either:
   *   - A message frame: {"topic":"/imu","receiveTime":{"sec":...},"data":"base64..."}
   *   - A stamp line:    {"type":"stamp","stamp":{"sec":...,"nsec":...}}
   */
  router.post("/:sourceId/messages", (req: Request, res: Response) => {
    const provider = (req as Request & { provider: IDataProvider }).provider;
    const body = req.body as MessagesRequest;

    if (!body.topics || !body.start || !body.end) {
      res.status(400).json({ error: "Request body must include topics, start, and end" });
      return;
    }

    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let closed = false;
    req.on("close", () => {
      closed = true;
    });

    let count = 0;
    for (const frame of provider.getMessages(body.topics, body.start, body.end)) {
      if (closed) {
        break;
      }

      const ok = writeMessageLine(res, frame);
      if (!ok) {
        break;
      }

      count++;

      // Emit a stamp line periodically so the frontend can track progress
      if (count % STAMP_INTERVAL === 0) {
        writeStampLine(res, frame.receiveTime);
      }
    }

    // Final stamp at the end time
    if (!closed && !res.writableEnded) {
      writeStampLine(res, body.end);
    }

    res.end();
  });

  /**
   * POST /api/sources/:sourceId/backfill
   *
   * Returns the most recent message per topic at or before the given time.
   * Request body: { topics, time }
   */
  router.post("/:sourceId/backfill", (req: Request, res: Response) => {
    const provider = (req as Request & { provider: IDataProvider }).provider;
    const body = req.body as BackfillRequest;

    if (!body.topics || !body.time) {
      res.status(400).json({ error: "Request body must include topics and time" });
      return;
    }

    const messages = provider.getBackfillMessages(body.topics, body.time);
    res.json({ messages });
  });

  return router;
}
