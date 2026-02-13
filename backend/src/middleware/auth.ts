// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Request, Response, NextFunction } from "express";

/**
 * Express middleware that validates Bearer tokens when AUTH_TOKEN is configured.
 *
 * When the AUTH_TOKEN environment variable is set, all requests must include
 * a matching Authorization header. When AUTH_TOKEN is not set, all requests
 * are allowed through (open access mode).
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const expectedToken = process.env.AUTH_TOKEN;

  // If no AUTH_TOKEN is configured, skip authentication
  if (!expectedToken) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({ error: "Authorization header required" });
    return;
  }

  if (authHeader !== expectedToken && authHeader !== `Bearer ${expectedToken}`) {
    res.status(401).json({ error: "Invalid authorization token" });
    return;
  }

  next();
}
