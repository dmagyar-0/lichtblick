// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import cors from "cors";
import express, { Application } from "express";

import { authMiddleware } from "./middleware/auth";
import { errorHandler } from "./middleware/errorHandler";
import { IDataProvider } from "./providers/IDataProvider";
import { createSourcesRouter } from "./routes/sources";

/**
 * Create and configure the Express application.
 *
 * @param providers - Map of sourceId → IDataProvider
 */
export function createApp(providers: Map<string, IDataProvider>): Application {
  const app = express();

  // --- Middleware ---
  app.use(cors());
  app.use(express.json());
  app.use(authMiddleware);

  // --- Health check ---
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // --- API routes ---
  app.use("/api/sources", createSourcesRouter(providers));

  // --- Error handling (must be last) ---
  app.use(errorHandler);

  return app;
}
