// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { produce } from "immer";
import * as _ from "lodash-es";
import { useCallback, useEffect } from "react";

import { SettingsTreeAction, SettingsTreeNodes } from "@lichtblick/suite";
import { usePanelSettingsTreeUpdate } from "@lichtblick/suite-base/providers/PanelStateContextProvider";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";

import { EventTaggingConfig } from "./types";

export const defaultConfig: EventTaggingConfig = {
  attributeDefinitions: [
    {
      key: "weather",
      label: "Weather",
      group: "ODD relevant",
      options: [
        "sunny",
        "cloudy",
        {
          value: "rain",
          // Selecting "rain" reveals a follow-up dropdown (inherits the group).
          children: [
            { key: "rainIntensity", label: "Rain intensity", options: ["light", "moderate", "heavy"] },
          ],
        },
        "snow",
        "fog",
      ],
    },
    {
      key: "roadType",
      label: "Road type",
      group: "ODD relevant",
      options: [
        {
          value: "highway",
          // Selecting "highway" reveals a follow-up dropdown (inherits the group).
          children: [{ key: "highwayLanes", label: "Lanes", options: ["2", "3", "4+"] }],
        },
        "urban",
        "rural",
        "parking",
      ],
    },
    {
      key: "feature",
      label: "Feature under test",
      group: "Feature based",
      options: ["ACC", "AEB", "LKA", "TSR"],
    },
  ],
  defaultBeforeSec: 0,
  defaultAfterSec: 0,
  events: [],
};

const buildSettingsTree = (config: EventTaggingConfig): SettingsTreeNodes => ({
  general: {
    label: "General",
    fields: {
      defaultBeforeSec: {
        label: "Default before (s)",
        input: "number",
        min: 0,
        value: config.defaultBeforeSec,
        help: "Seconds before the tagged timestamp pre-filled for new events",
      },
      defaultAfterSec: {
        label: "Default after (s)",
        input: "number",
        min: 0,
        value: config.defaultAfterSec,
        help: "Seconds after the tagged timestamp pre-filled for new events",
      },
    },
  },
});

export function useEventTaggingSettings(
  config: EventTaggingConfig,
  saveConfig: SaveConfig<EventTaggingConfig>,
): void {
  const updatePanelSettingsTree = usePanelSettingsTreeUpdate();

  const actionHandler = useCallback(
    (action: SettingsTreeAction) => {
      if (action.action !== "update") {
        return;
      }
      const { path, value } = action.payload;
      saveConfig(
        produce<EventTaggingConfig>((draft) => {
          _.set(draft, path.slice(1), value);
        }),
      );
    },
    [saveConfig],
  );

  useEffect(() => {
    updatePanelSettingsTree({
      actionHandler,
      nodes: buildSettingsTree(config),
    });
  }, [actionHandler, config, updatePanelSettingsTree]);
}
