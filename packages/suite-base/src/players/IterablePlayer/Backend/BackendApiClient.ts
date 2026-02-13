// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type {
  BackfillRequest,
  BackfillResponse,
  InitializeResponse,
  MessagesRequest,
} from "./types";

/** Set of HTTP status codes considered transient (eligible for retry). */
const TRANSIENT_STATUS_CODES = new Set([502, 503, 504]);

/** Default request timeout in milliseconds for non-streaming requests. */
const REQUEST_TIMEOUT_MS = 30_000;

/** Maximum number of retry attempts for transient failures. */
const DEFAULT_MAX_RETRIES = 3;

/**
 * Returns a promise that resolves after `ms` milliseconds.
 * Used for exponential backoff between retries.
 */
function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Creates an AbortSignal that will abort after the given timeout in milliseconds.
 * Uses AbortSignal.timeout when available, otherwise falls back to a manual
 * setTimeout + AbortController pattern.
 */
function createTimeoutSignal(timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  // Use AbortSignal.timeout if available (modern browsers)
  if (typeof AbortSignal.timeout === "function") {
    return { signal: AbortSignal.timeout(timeoutMs), cleanup: () => {} };
  }

  // Fallback: manual timeout via AbortController
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
    },
  };
}

/**
 * Plain HTTP client for the backend message-level API.
 */
export default class BackendApiClient {
  #baseUrl: string;
  #auth: string | undefined;

  public constructor(baseUrl: string, options?: { auth?: string }) {
    this.#baseUrl = baseUrl;
    this.#auth = options?.auth;
  }

  public async initialize(sourceId: string): Promise<InitializeResponse> {
    const url = `${this.#baseUrl}/api/sources/${sourceId}/initialize`;
    const { signal: timeoutSignal, cleanup } = createTimeoutSignal(REQUEST_TIMEOUT_MS);
    try {
      const response = await this.#fetchWithRetry(url, {
        method: "POST",
        headers: this.#headers(),
        signal: timeoutSignal,
      });
      return (await response.json()) as InitializeResponse;
    } catch (error) {
      throw this.#wrapTimeoutError(error, url);
    } finally {
      cleanup();
    }
  }

  public getMessages(
    sourceId: string,
    request: MessagesRequest,
    signal?: AbortSignal,
  ): ReadableStream<Uint8Array> {
    const url = `${this.#baseUrl}/api/sources/${sourceId}/messages`;

    // We need to return a ReadableStream synchronously, but fetch is async.
    // Create a pass-through stream that pulls from the fetch response.
    // The initial fetch uses #fetchWithRetry so transient connection errors
    // are retried, but once streaming begins, mid-stream errors are not retried.
    const fetchWithRetry = this.#fetchWithRetry.bind(this);
    const headers = this.#headers();
    return new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          const response = await fetchWithRetry(url, {
            method: "POST",
            headers,
            body: JSON.stringify(request),
            signal,
          });
          if (response.body == undefined) {
            controller.error(
              new Error(`Backend messages response body is null. <${url}>`),
            );
            return;
          }
          const reader = response.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) {
              controller.close();
              return;
            }
            controller.enqueue(value);
          }
        } catch (error) {
          // AbortError is expected when the signal is aborted.
          if (error instanceof DOMException && error.name === "AbortError") {
            controller.close();
            return;
          }
          controller.error(error);
        }
      },
    });
  }

  public async getBackfill(
    sourceId: string,
    request: BackfillRequest,
  ): Promise<BackfillResponse> {
    const url = `${this.#baseUrl}/api/sources/${sourceId}/backfill`;
    const { signal: timeoutSignal, cleanup } = createTimeoutSignal(REQUEST_TIMEOUT_MS);
    try {
      const response = await this.#fetchWithRetry(url, {
        method: "POST",
        headers: this.#headers(),
        body: JSON.stringify(request),
        signal: timeoutSignal,
      });
      return (await response.json()) as BackfillResponse;
    } catch (error) {
      throw this.#wrapTimeoutError(error, url);
    } finally {
      cleanup();
    }
  }

  /**
   * Fetch with automatic retry for transient errors.
   *
   * Retries on HTTP 502, 503, 504 and network-level errors (TypeError from fetch)
   * using exponential backoff (1s, 2s, 4s). Non-transient HTTP errors (e.g. 400,
   * 401, 404, 500) throw immediately without retry. If the request signal is
   * aborted, no further retries are attempted.
   */
  async #fetchWithRetry(
    url: string,
    options: RequestInit,
    maxRetries: number = DEFAULT_MAX_RETRIES,
  ): Promise<Response> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // If the signal has been aborted before this attempt, stop immediately.
      if (options.signal?.aborted === true) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }

      try {
        const response = await fetch(url, options);

        if (response.ok) {
          return response;
        }

        // Non-transient HTTP error: throw immediately, do not retry.
        if (!TRANSIENT_STATUS_CODES.has(response.status)) {
          const bodyText = await response.text().catch(() => "");
          throw new Error(
            `Backend ${url} failed (${response.status} ${response.statusText}): ${bodyText}`.trim(),
          );
        }

        // Transient HTTP error: record it and potentially retry.
        const bodyText = await response.text().catch(() => "");
        lastError = new Error(
          `Backend ${url} failed (${response.status} ${response.statusText}): ${bodyText}`.trim(),
        );
      } catch (error) {
        // If the signal was aborted, propagate immediately (no retry).
        if (error instanceof DOMException && error.name === "AbortError") {
          throw error;
        }

        // Network-level errors from fetch surface as TypeError.
        // These are transient and eligible for retry.
        if (error instanceof TypeError) {
          lastError = error;
        } else {
          // Non-transient fetch errors (including our own thrown errors above)
          // propagate immediately.
          throw error;
        }
      }

      // If we have retries remaining, wait with exponential backoff.
      if (attempt < maxRetries) {
        const backoffMs = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
        await delay(backoffMs);
      }
    }

    // All retries exhausted.
    const message = lastError?.message ?? "unknown error";
    throw new Error(
      `Backend request to ${url} failed after ${maxRetries} retries: ${message}`,
    );
  }

  /**
   * Wraps timeout-related abort errors into a more descriptive message.
   * Re-throws non-timeout errors unchanged.
   */
  #wrapTimeoutError(error: unknown, url: string): Error {
    if (
      error instanceof DOMException &&
      error.name === "AbortError"
    ) {
      return new Error(`Backend request to ${url} timed out after 30s`);
    }
    // AbortSignal.timeout() throws a TimeoutError DOMException in some browsers.
    if (
      error instanceof DOMException &&
      error.name === "TimeoutError"
    ) {
      return new Error(`Backend request to ${url} timed out after 30s`);
    }
    if (error instanceof Error) {
      return error;
    }
    return new Error(String(error));
  }

  #headers(): HeadersInit {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.#auth != undefined) {
      headers["Authorization"] = this.#auth;
    }
    return headers;
  }
}
