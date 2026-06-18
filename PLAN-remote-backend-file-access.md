# Plan: Backend-Served Remote Data Source (Message-Level API)

## Goal

Enable Lichtblick to read data from a backend service that exposes a
message-level API, rather than reading raw bytes from a file URL. The backend
parses data server-side and serves metadata, messages, and backfill responses.

## Integration Point

The `ISerializedIterableSource` interface (`IIterableSource.ts`) is the seam.
Everything above it — `IterablePlayer`, `DeserializingIterableSource`,
`BufferedIterableSource`, `BlockLoader`, `MessagePipeline`, panels — works
unchanged. We implement a new source that talks HTTP to a backend instead of
reading MCAP bytes.

```
BackendDataSourceFactory
  → WorkerSerializedIterableSource
    → BackendIterableSourceWorker (Web Worker)
      → BackendIterableSource (implements ISerializedIterableSource)
        → BackendApiClient (HTTP + streaming)
          → Backend service
```

---

## Implementation Chunks

The chunks below are designed so that **Chunk 1, 2, and 3 can be built in
parallel**. Chunk 4 wires them together. Chunk 5 and 6 are independent
follow-ups.

---

### Chunk 1: API Client (`BackendApiClient`)

**New file:** `packages/suite-base/src/players/IterablePlayer/Backend/BackendApiClient.ts`

A plain HTTP client encapsulating all communication with the backend. No
Lichtblick-specific types — just request/response shapes.

**Responsibilities:**
- `constructor(baseUrl: string, options?: { auth?: string })`
- `initialize(sourceId: string): Promise<InitializeResponse>` — `POST /api/sources/{id}/initialize`
- `getMessages(sourceId: string, request: MessagesRequest): ReadableStream<Uint8Array>` — `POST /api/sources/{id}/messages`, returns raw streaming body
- `getBackfill(sourceId: string, request: BackfillRequest): Promise<BackfillResponse>` — `POST /api/sources/{id}/backfill`
- Attaches `Authorization` header when `auth` is provided
- Calls `AbortController.abort()` to cancel in-flight requests

**Types to define (in a sibling `types.ts`):**

```typescript
type TimeJson = { sec: number; nsec: number };

type TopicInfoJson = {
  name: string;
  schemaName: string;
  messageEncoding: string;
  schemaEncoding: string;
  schemaData: string;          // base64
};

type TopicStatsJson = {
  numMessages: number;
  firstMessageTime?: TimeJson;
  lastMessageTime?: TimeJson;
};

type InitializeResponse = {
  start: TimeJson;
  end: TimeJson;
  topics: TopicInfoJson[];
  topicStats: Record<string, TopicStatsJson>;
  profile: string;
  metadata?: Array<{ name: string; metadata: Record<string, string> }>;
  publishersByTopic?: Record<string, string[]>;
};

type MessagesRequest = {
  topics: Record<string, { fields?: string[] }>;
  start: TimeJson;
  end: TimeJson;
};

type MessageFrameJson = {
  topic: string;
  receiveTime: TimeJson;
  publishTime?: TimeJson;
  data: string;                // base64-encoded serialized message bytes
};

type BackfillRequest = {
  topics: Record<string, { fields?: string[] }>;
  time: TimeJson;
};

type BackfillResponse = {
  messages: MessageFrameJson[];
};
```

**Validation:** Unit tests using `msw` (or a simple mock fetch) that verify:
- Correct URL construction and headers
- JSON request body serialization
- Streaming response consumption (mock `ReadableStream`)
- Auth header attached when provided
- AbortSignal cancels the fetch

**No dependencies on other chunks.**

---

### Chunk 2: Response Parsing & Streaming Helpers

**New file:** `packages/suite-base/src/players/IterablePlayer/Backend/messageStreamParser.ts`

Responsible for turning a `ReadableStream<Uint8Array>` (the HTTP response body
from `/messages`) into an async iterable of `IteratorResult<Uint8Array>`.

**Protocol (NDJSON for v1):**
Each line is a JSON object:
```json
{"topic":"/imu","receiveTime":{"sec":1700000000,"nsec":500},"data":"base64..."}
```
A special stamp line:
```json
{"type":"stamp","stamp":{"sec":1700000001,"nsec":0}}
```

**Responsibilities:**
- `async function* parseMessageStream(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncIterableIterator<IteratorResult<Uint8Array>>`
- Reads the stream line-by-line (text decoder + split on `\n`)
- For each line, parses JSON, base64-decodes `data` into `Uint8Array`
- Yields `{ type: "message-event", msgEvent: { topic, receiveTime, sizeInBytes, message } }`
- Yields `{ type: "stamp", stamp }` for stamp lines
- Respects `AbortSignal` to stop iteration

**Also define a helper:**
- `function parseBackfillResponse(response: BackfillResponse): MessageEvent<Uint8Array>[]`

**Validation:** Unit tests with canned NDJSON strings:
- Single message line → yields one `message-event`
- Multiple lines → yields in order
- Stamp line → yields `stamp`
- Malformed line → yields `alert` (or throws — decide on error policy)
- Aborted signal → iteration stops
- Base64 round-trip: encode known bytes, decode, compare

**No dependencies on other chunks.**

---

### Chunk 3: Data Source Factory + Worker Boilerplate

**New file:** `packages/suite-base/src/dataSources/BackendDataSourceFactory.ts`

Follows the exact pattern of `RemoteDataSourceFactory` / `McapLocalDataSourceFactory`.

```typescript
class BackendDataSourceFactory implements IDataSourceFactory {
  id = "backend-api";
  type: IDataSourceFactory["type"] = "connection";
  displayName = "Backend API";
  iconName: IDataSourceFactory["iconName"] = "Cloud";
  description = "Load data from a backend service.";

  formConfig = {
    fields: [
      { id: "url",      label: "Backend URL",  placeholder: "https://api.example.com" },
      { id: "sourceId", label: "Source ID",     placeholder: "recording-123" },
      { id: "auth",     label: "Auth token",    placeholder: "Bearer ..." },
    ],
  };

  initialize(args: DataSourceFactoryInitializeArgs): Player | undefined {
    const baseUrl  = args.params?.url;
    const sourceId = args.params?.sourceId;
    if (!baseUrl || !sourceId) return undefined;

    const source = new WorkerSerializedIterableSource({
      initWorker: () => new Worker(
        new URL(
          "@lichtblick/suite-base/players/IterablePlayer/Backend/BackendIterableSourceWorker.worker",
          import.meta.url,
        ),
      ),
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
```

**New file:** `packages/suite-base/src/players/IterablePlayer/Backend/BackendIterableSourceWorker.worker.ts`

Thin worker entry point (follows `McapIterableSourceWorker.worker.ts` pattern):

```typescript
import * as Comlink from "@lichtblick/comlink";
import { IterableSourceInitializeArgs } from "../IIterableSource";
import { WorkerSerializedIterableSourceWorker } from "../WorkerSerializedIterableSourceWorker";
import { BackendIterableSource } from "./BackendIterableSource";

export function initialize(
  args: IterableSourceInitializeArgs,
): WorkerSerializedIterableSourceWorker {
  if (!args.api?.baseUrl || !args.params?.sourceId) {
    throw new Error("api.baseUrl and params.sourceId are required");
  }
  const source = new BackendIterableSource(
    args.api.baseUrl,
    args.params.sourceId,
    args.api.auth,
  );
  return Comlink.proxy(new WorkerSerializedIterableSourceWorker(source));
}

Comlink.expose(initialize);
```

**Validation:**
- Factory unit test: given params, returns an `IterablePlayer` instance; missing params returns `undefined`
- Worker file compiles and exports `initialize`
- Verify `initArgs` shape passes through `WorkerSerializedIterableSource` correctly

**Depends on:** Chunk 4's `BackendIterableSource` to exist (but a stub/empty
class is enough for the worker to compile, so this chunk can use a placeholder).

---

### Chunk 4: `BackendIterableSource` (Core Adapter)

**New file:** `packages/suite-base/src/players/IterablePlayer/Backend/BackendIterableSource.ts`

Implements `ISerializedIterableSource`. This is the glue between Chunks 1+2 and
the rest of Lichtblick.

```typescript
class BackendIterableSource implements ISerializedIterableSource {
  readonly sourceType = "serialized";

  #client: BackendApiClient;
  #sourceId: string;
  #start: Time | undefined;

  constructor(baseUrl: string, sourceId: string, auth?: string) {
    this.#client = new BackendApiClient(baseUrl, { auth });
    this.#sourceId = sourceId;
  }

  async initialize(): Promise<Initialization> {
    const resp = await this.#client.initialize(this.#sourceId);
    this.#start = resp.start;

    // Transform InitializeResponse → Initialization
    return {
      start: resp.start,
      end: resp.end,
      topics: resp.topics.map(t => ({
        name: t.name,
        schemaName: t.schemaName,
        messageEncoding: t.messageEncoding,
        schemaEncoding: t.schemaEncoding,
        schemaData: base64ToUint8Array(t.schemaData),
      })),
      topicStats: new Map(Object.entries(resp.topicStats).map(
        ([k, v]) => [k, { numMessages: v.numMessages, ... }]
      )),
      datatypes: new Map(),  // populated from schemas by DeserializingIterableSource
      profile: resp.profile,
      metadata: resp.metadata,
      publishersByTopic: new Map(Object.entries(resp.publishersByTopic ?? {})),
      alerts: [],
    };
  }

  async *messageIterator(args: MessageIteratorArgs):
    AsyncIterableIterator<Readonly<IteratorResult<Uint8Array>>> {
    const stream = this.#client.getMessages(this.#sourceId, {
      topics: args.topics as Record<string, { fields?: string[] }>,
      start: args.start ?? this.#start!,
      end: args.end ?? { sec: Number.MAX_SAFE_INTEGER, nsec: 0 },
    });
    yield* parseMessageStream(stream);
  }

  async getBackfillMessages(args: GetBackfillMessagesArgs):
    Promise<MessageEvent<Uint8Array>[]> {
    const resp = await this.#client.getBackfill(this.#sourceId, {
      topics: args.topics as Record<string, { fields?: string[] }>,
      time: args.time,
    });
    return parseBackfillResponse(resp);
  }

  getStart(): Time | undefined {
    return this.#start;
  }
}
```

**Validation:** Integration-style unit tests with mocked `BackendApiClient`:
- `initialize()` transforms response to correct `Initialization` shape
- `messageIterator()` yields messages from a mocked stream
- `getBackfillMessages()` returns parsed messages
- `getStart()` returns time after initialization
- Error from client propagates as `PlayerAlert`-compatible error

**Depends on:** Chunk 1 (API Client) and Chunk 2 (stream parser).

---

### Chunk 5: Registration & End-to-End Wiring

**Modified files:**
- `packages/suite-desktop/src/renderer/Root.tsx` — add `new BackendDataSourceFactory()` to `sources` array
- `packages/suite-web/src/WebRoot.tsx` — add `new BackendDataSourceFactory()` to `sources` array

**Validation:**
- App starts without errors
- "Backend API" appears in the connection dialog
- Entering a URL + source ID attempts to connect (will fail without a real backend — that's OK)
- Error is surfaced as a `PlayerAlert` in the UI

**Depends on:** All previous chunks.

---

### Chunk 6: Error Handling & Retry Logic

**Modified file:** `BackendApiClient.ts`

Add resilience to the API client:
- Retry transient errors (HTTP 502/503/504, network errors) with exponential backoff (3 attempts, 1s/2s/4s)
- Timeout for `/initialize` and `/backfill` (e.g. 30s)
- No timeout for `/messages` streaming (but respect `AbortSignal`)
- Map HTTP error codes to user-friendly messages
- `PlayerAlert` generation for persistent failures

**Validation:**
- Unit test: transient 503 → retry → success on 2nd attempt
- Unit test: persistent 500 → fails after retries with descriptive error
- Unit test: timeout fires and rejects promise
- Unit test: abort signal cancels in-flight request

**No dependencies beyond Chunk 1.**

---

## Chunk Dependency Graph

```
Chunk 1 (API Client)  ─────────────┐
                                    ├──→ Chunk 4 (BackendIterableSource) ──→ Chunk 5 (Registration)
Chunk 2 (Stream Parser) ───────────┘

Chunk 3 (Factory + Worker) ─────────────→ Chunk 5 (Registration)

Chunk 6 (Retry Logic) ← can start after Chunk 1
```

**Parallel work:**
- **Phase 1** (parallel): Chunk 1, Chunk 2, Chunk 3 (stub source)
- **Phase 2**: Chunk 4 (connects 1+2), Chunk 6 (extends 1)
- **Phase 3**: Chunk 5 (wires everything, manual verification)

---

## Known Problems & How Each Chunk Addresses Them

| Problem | Relevant Chunk | How It's Handled |
|---------|---------------|------------------|
| **Streaming latency** | Chunk 2, 4 | `messageIterator` yields progressively from NDJSON stream; `readAheadDuration: 30s` buffers ahead |
| **Seek performance** | Chunk 4 | Each seek creates a new iterator; `BufferedIterableSource` (existing) caches already-fetched ranges; previous stream aborted via `AbortSignal` |
| **Message encoding mismatch** | Chunk 4 | `initialize()` must return accurate `messageEncoding`/`schemaEncoding`; backend contract requires original encoding preserved |
| **Large responses** | Chunk 2 | NDJSON streaming — one line at a time, never buffered fully in memory |
| **Connection failures** | Chunk 6 | Retry with backoff for transient errors; `PlayerAlert` for persistent ones |
| **Worker RPC overhead** | Chunk 4 | Can add `getMessageCursor()` later as optimization (not blocking for v1 — the async iterator path works) |
| **Schema compatibility** | Chunk 1, 4 | `schemaData` sent as base64, decoded to `Uint8Array`; existing `DeserializingIterableSource` handles the rest |
| **CORS** | Chunk 1 | Fetch calls go through standard browser fetch; CORS is a backend config concern; desktop Electron bypasses it |
| **Auth** | Chunk 1, 3 | Token passed via factory form → `initArgs.api.auth` → `Authorization` header on every request |
| **Time precision** | Chunk 1, 2 | `{sec, nsec}` as separate integer fields in JSON; both fit safely in JS `number` (nsec < 1e9) |

---

## Files Summary

### New Files (4)

| File | Chunk | Lines (est.) |
|------|-------|-------------|
| `.../Backend/types.ts` | 1 | ~60 |
| `.../Backend/BackendApiClient.ts` | 1, 6 | ~120 |
| `.../Backend/messageStreamParser.ts` | 2 | ~80 |
| `.../Backend/BackendIterableSource.ts` | 4 | ~100 |
| `.../Backend/BackendIterableSourceWorker.worker.ts` | 3 | ~25 |
| `.../dataSources/BackendDataSourceFactory.ts` | 3 | ~50 |

### Modified Files (2)

| File | Chunk | Change |
|------|-------|--------|
| `suite-desktop/src/renderer/Root.tsx` | 5 | Add factory to array |
| `suite-web/src/WebRoot.tsx` | 5 | Add factory to array |

### Unchanged (reused as-is)

`WorkerSerializedIterableSource`, `WorkerSerializedIterableSourceWorker`,
`IterablePlayer`, `DeserializingIterableSource`, `BufferedIterableSource`,
`BlockLoader`, `MessagePipeline`, `TopicAliasingPlayer`, `UserScriptPlayer`
