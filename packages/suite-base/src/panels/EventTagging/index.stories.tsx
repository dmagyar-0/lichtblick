// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { StoryObj } from "@storybook/react";

import EventsProvider from "@lichtblick/suite-base/providers/EventsProvider";
import PanelSetup from "@lichtblick/suite-base/stories/PanelSetup";

import EventTagging from "./index";
import { defaultConfig } from "./settings";
import { EventTaggingConfig } from "./types";

const activeData = {
  startTime: { sec: 0, nsec: 0 },
  endTime: { sec: 120, nsec: 0 },
  currentTime: { sec: 35, nsec: 0 },
};

const taggedConfig: EventTaggingConfig = {
  ...defaultConfig,
  events: [
    {
      id: "event-1",
      timestamp: { sec: 12, nsec: 0 },
      attributes: { weather: "rain", roadType: "highway" },
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "event-2",
      timestamp: { sec: 60, nsec: 0 },
      beforeSec: 5,
      afterSec: 10,
      attributes: { weather: "fog" },
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
};

export default {
  title: "panels/EventTagging",
  component: EventTagging,
};

export const Empty: StoryObj = {
  render: () => {
    return (
      <EventsProvider>
        <PanelSetup fixture={{ activeData }}>
          <EventTagging />
        </PanelSetup>
      </EventsProvider>
    );
  },
};

export const WithEvents: StoryObj = {
  render: () => {
    return (
      <EventsProvider>
        <PanelSetup fixture={{ activeData }}>
          <EventTagging overrideConfig={taggedConfig} />
        </PanelSetup>
      </EventsProvider>
    );
  },
};

export const WithEventsLight: StoryObj = {
  ...WithEvents,
  parameters: { colorScheme: "light" },
};

// An event whose selected option ("rain") reveals a nested child dropdown
// ("Rain intensity"), demonstrating the cascading multi-level configuration.
const cascadingConfig: EventTaggingConfig = {
  ...defaultConfig,
  events: [
    {
      id: "event-cascade",
      timestamp: { sec: 30, nsec: 0 },
      attributes: {
        weather: "rain",
        rainIntensity: "heavy",
        roadType: "highway",
        highwayLanes: "3",
        feature: "AEB",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
};

export const CascadingAttributes: StoryObj = {
  render: () => {
    return (
      <EventsProvider>
        <PanelSetup fixture={{ activeData }}>
          <EventTagging overrideConfig={cascadingConfig} />
        </PanelSetup>
      </EventsProvider>
    );
  },
};
