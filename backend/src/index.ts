// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { DemoDataProvider } from "./providers/DemoDataProvider";
import { IDataProvider } from "./providers/IDataProvider";
import { createApp } from "./server";

const PORT = parseInt(process.env.PORT ?? "8080", 10);

// Register data providers keyed by sourceId.
// The DemoDataProvider is registered under "demo" by default.
// Additional providers can be registered here as they are implemented.
const providers = new Map<string, IDataProvider>();
providers.set("demo", new DemoDataProvider());

const app = createApp(providers);

app.listen(PORT, () => {
  console.log(`Lichtblick backend listening on http://localhost:${PORT}`);
  console.log(`Available sources: ${[...providers.keys()].join(", ")}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Initialize demo: curl -X POST http://localhost:${PORT}/api/sources/demo/initialize`);
});
