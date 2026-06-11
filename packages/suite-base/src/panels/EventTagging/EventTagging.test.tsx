/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { render, screen } from "@testing-library/react";

import EventTagging from "@lichtblick/suite-base/panels/EventTagging";
import EventsProvider from "@lichtblick/suite-base/providers/EventsProvider";
import PanelSetup from "@lichtblick/suite-base/stories/PanelSetup";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

import { defaultConfig } from "./settings";
import { EventTaggingConfig } from "./types";

const activeData = {
  startTime: { sec: 0, nsec: 0 },
  endTime: { sec: 120, nsec: 0 },
  currentTime: { sec: 35, nsec: 0 },
};

function setup(configOverride?: Partial<EventTaggingConfig>) {
  const config: EventTaggingConfig = { ...defaultConfig, ...configOverride };
  return render(
    <ThemeProvider isDark>
      <EventsProvider>
        <PanelSetup fixture={{ activeData }}>
          <EventTagging overrideConfig={config} />
        </PanelSetup>
      </EventsProvider>
    </ThemeProvider>,
  );
}

describe("EventTagging panel", () => {
  it("renders the tagging form and empty state", async () => {
    setup();
    expect(await screen.findByText("Tag at current time")).toBeDefined();
    expect(await screen.findByText("Tag event")).toBeDefined();
    expect(await screen.findByText("No tagged events")).toBeDefined();
  });

  it("renders a row for each tagged event", async () => {
    setup({
      events: [
        {
          id: "event-1",
          timestamp: { sec: 12, nsec: 0 },
          attributes: { weather: "rain" },
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
    });
    expect(await screen.findAllByTestId("tagged-event-row")).toHaveLength(2);
  });
});
