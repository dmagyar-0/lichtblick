// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  IDataSourceFactory,
  DataSourceFactoryInitializeArgs,
} from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { IterablePlayer } from "@lichtblick/suite-base/players/IterablePlayer";
import { WorkerSerializedIterableSource } from "@lichtblick/suite-base/players/IterablePlayer/WorkerSerializedIterableSource";
import { Player } from "@lichtblick/suite-base/players/types";

class BackendDataSourceFactory implements IDataSourceFactory {
  public id = "backend-api";
  public type: IDataSourceFactory["type"] = "connection";
  public displayName = "Backend API";
  public iconName: IDataSourceFactory["iconName"] = "FileASPX";
  public description = "Load data from a backend service.";

  public formConfig = {
    fields: [
      { id: "url", label: "Backend URL", placeholder: "https://api.example.com" },
      { id: "sourceId", label: "Source ID", placeholder: "recording-123" },
      { id: "auth", label: "Auth token (optional)", placeholder: "Bearer ..." },
    ],
  };

  public initialize(args: DataSourceFactoryInitializeArgs): Player | undefined {
    const baseUrl = args.params?.url;
    const sourceId = args.params?.sourceId;
    if (!baseUrl || !sourceId) {
      return undefined;
    }

    const source = new WorkerSerializedIterableSource({
      initWorker: () => {
        return new Worker(
          // foxglove-depcheck-used: babel-plugin-transform-import-meta
          new URL(
            "@lichtblick/suite-base/players/IterablePlayer/Backend/BackendIterableSourceWorker.worker",
            import.meta.url,
          ),
        );
      },
      initArgs: {
        api: { baseUrl, auth: args.params?.auth },
        params: { sourceId },
      },
    });

    return new IterablePlayer({
      metricsCollector: args.metricsCollector,
      source,
      name: `${baseUrl} / ${sourceId}`,
      sourceId: this.id,
      readAheadDuration: { sec: 30, nsec: 0 },
    });
  }
}

export default BackendDataSourceFactory;
