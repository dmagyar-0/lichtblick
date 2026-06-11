// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import Logger from "@lichtblick/log";

import { parseTaggedEvents } from "./eventUtils";
import { TaggedEvent } from "./types";

const log = Logger.getLogger(__filename);

/**
 * postMessage type accepted by the Event Tagging panel. External services can
 * inject events into an open Event Tagging panel with:
 *
 * ```js
 * window.postMessage({
 *   type: "lichtblick.eventTagging.addEvents",
 *   events: [{ timestamp: 1700000000.5, beforeSec: 1, afterSec: 2, attributes: { weather: "rain" } }],
 * });
 * ```
 *
 * Alternatively `window.lichtblickEventTagging.addEvents([...])` can be called
 * directly (e.g. from an embedding application or the devtools console), and
 * `window.lichtblickEventTagging.getEvents()` returns the currently tagged
 * events for programmatic export.
 */
const EVENT_TAGGING_MESSAGE_TYPE = "lichtblick.eventTagging.addEvents";

type EventsListener = (events: TaggedEvent[]) => void;
type EventsProvider = () => TaggedEvent[];

declare global {
  interface Window {
    lichtblickEventTagging?: {
      addEvents: (events: unknown) => number;
      getEvents: () => TaggedEvent[];
    };
  }
}

class ExternalEventsApi {
  #listeners = new Set<EventsListener>();
  #providers = new Set<EventsProvider>();
  #installed = false;

  /** Subscribe to events pushed by external services. Returns an unsubscribe function. */
  public subscribe(listener: EventsListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Register a provider for `getEvents()`. Returns an unregister function. */
  public registerEventsProvider(provider: EventsProvider): () => void {
    this.#providers.add(provider);
    return () => {
      this.#providers.delete(provider);
    };
  }

  /** Validate and dispatch externally supplied events to all open panels. */
  public addEvents(data: unknown): number {
    const events = parseTaggedEvents(data);
    for (const listener of this.#listeners) {
      listener(events);
    }
    return events.length;
  }

  public getEvents(): TaggedEvent[] {
    return [...this.#providers].flatMap((provider) => provider());
  }

  /** Install the window-level entry points. Safe to call multiple times. */
  public install(): void {
    if (this.#installed || typeof window === "undefined") {
      return;
    }
    this.#installed = true;

    window.lichtblickEventTagging = {
      addEvents: (events: unknown) => this.addEvents(events),
      getEvents: () => this.getEvents(),
    };

    // The message payload is strictly validated by parseTaggedEvents and only
    // contains tagging data, so messages are accepted from any origin to allow
    // separate services (iframes, openers, automation) to push events.
    window.addEventListener("message", (messageEvent: MessageEvent) => {
      const data = messageEvent.data as { type?: unknown; events?: unknown } | undefined;
      if (data == undefined || data.type !== EVENT_TAGGING_MESSAGE_TYPE) {
        return;
      }
      try {
        this.addEvents(data.events);
      } catch (error) {
        log.error("Ignored invalid event tagging message:", error);
      }
    });
  }
}

export const externalEventsApi = new ExternalEventsApi();
