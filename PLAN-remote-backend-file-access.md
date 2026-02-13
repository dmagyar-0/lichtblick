# Architectural Plan: Backend-Served Remote File Access

## Problem Statement

Currently, Lichtblick supports reading MCAP files over HTTP using range requests
directly against a static file server. The goal is to enable a similar experience
where, instead of fetching byte ranges from a file URL, Lichtblick communicates
with a **backend service** that can serve the data. This backend would sit between
the client and the actual data storage, enabling richer query capabilities,
authentication, access control, and data transformation.

---

## Current Architecture (HTTP MCAP Reading)

### Data Flow

```
User enters URL
  → RemoteDataSourceFactory.initialize()
    → WorkerSerializedIterableSource (spawns Web Worker)
      → McapIterableSource({ type: "url", url })
        → RemoteFileReadable(url)
          → BrowserHttpReader (HTTP Range requests)
            → CachedFilelike (500 MiB LRU cache)
              → VirtualLRUBuffer (virtual memory management)
        → McapIndexedReader (random access via index)
          OR McapUnindexedIterableSource (streaming fallback)
    → IterablePlayer (playback orchestration, 10s read-ahead)
```

### Key Interfaces in the Stack

| Layer | Interface | File | Role |
|-------|-----------|------|------|
| Factory | `IDataSourceFactory` | `PlayerSelectionContext.ts` | Creates Player from user input |
| Source | `ISerializedIterableSource` | `IIterableSource.ts` | Provides messages as `Uint8Array` via iterators |
| Readable | `McapTypes.IReadable` | `@mcap/core` | `size()` + `read(offset, size)` for random access |
| HTTP I/O | `FileReader` | `CachedFilelike.ts` | `open()` + `fetch(offset, length)` for streaming |
| Cache | `CachedFilelike` | `CachedFilelike.ts` | LRU block cache with intelligent prefetch |
| Player | `Player` | `types.ts` | Unified playback API for all sources |

### What Makes HTTP MCAP Work

1. **HTTP Range requests** (`Range: bytes=start-end`) allow random access into the file
2. **MCAP index** at the end of the file enables seeking without scanning
3. **CachedFilelike** minimizes redundant downloads with 500 MiB LRU cache
4. **Web Worker** offloads parsing from the main thread

---

## Proposed Architecture: Backend-Served Data Source

### Concept

Replace the direct HTTP-to-file path with a **backend API** that exposes
operations at a higher level than raw byte ranges. The backend knows the file
format internally and can serve:
- Metadata (topics, schemas, time ranges)
- Messages filtered by topic and time range
- Summary statistics

This is fundamentally different from the current HTTP approach, which treats the
remote resource as a dumb byte store.

### Two Possible Approaches

#### Approach A: Backend as a Byte-Range Proxy (Thin Backend)

The backend implements an API equivalent to HTTP Range requests but routed
through an authenticated endpoint. The client-side architecture stays nearly
identical.

```
Lichtblick Client                          Backend
─────────────────                          ───────
RemoteFileReadable                    ←→   /api/files/{id}/open  → { size, etag }
  └─ BackendHttpReader.open()         ←→   /api/files/{id}/read?offset=X&length=Y → bytes
  └─ BackendHttpReader.fetch(off,len) ←→   (same endpoint, streaming response)
```

**What to implement:**
- `BackendHttpReader` implementing `FileReader` interface (replaces `BrowserHttpReader`)
- `BackendDataSourceFactory` implementing `IDataSourceFactory`
- Auth token handling (headers, refresh)

**Pros:** Minimal client-side changes; reuses CachedFilelike, McapIndexedReader, etc.
**Cons:** Backend must still serve raw bytes; no semantic awareness; client does
all parsing; high bandwidth for large files.

#### Approach B: Backend as a Message-Level API (Thick Backend)

The backend parses the data server-side and exposes a message-level API. The
client implements `IIterableSource` directly against this API, bypassing the MCAP
reader entirely.

```
Lichtblick Client                          Backend
─────────────────                          ───────
BackendIterableSource.initialize()    ←→   GET /api/sources/{id}/init
                                           → { start, end, topics, datatypes, ... }

BackendIterableSource.messageIterator ←→   GET /api/sources/{id}/messages
  ({ topics, start, end })                   ?topics=...&start=...&end=...
                                           → streaming JSON/binary messages

BackendIterableSource.getBackfillMessages ←→ GET /api/sources/{id}/backfill
  ({ topics, time })                         ?topics=...&time=...
                                           → last message per topic before time
```

**What to implement:**
- `BackendIterableSource` implementing `ISerializedIterableSource`
- `BackendDataSourceFactory` implementing `IDataSourceFactory`
- Backend API service with endpoints for init, messages, backfill
- Message serialization protocol (binary preferred for efficiency)

**Pros:** Semantic queries; lower bandwidth (only requested data); server-side
filtering; supports data sources beyond MCAP files.
**Cons:** Larger implementation surface; new protocol to design; server must
parse and serve messages.

---

## Recommended Approach: B (Message-Level API)

Approach B is more aligned with the stated goal ("communicate with a backend
which can serve the requests") and provides more value long-term. The backend
gains the ability to:
- Serve data from databases, not just files
- Apply access control per-topic
- Pre-compute statistics
- Cache parsed data server-side
- Support data formats the client doesn't understand

---

## Detailed Implementation Plan (Approach B)

### 1. Backend API Contract

#### `POST /api/sources/{id}/initialize`

Returns metadata needed for `Initialization`:

```typescript
// Response
{
  start: { sec: number, nsec: number },
  end: { sec: number, nsec: number },
  topics: Array<{
    name: string,
    schemaName: string,
    messageEncoding: string,     // "ros1", "cdr", "json", "protobuf"
    schemaEncoding: string,      // "ros1msg", "ros2msg", "jsonschema", "protobuf"
    schemaData: string,          // base64-encoded schema bytes
  }>,
  topicStats: Record<string, { numMessages: number, firstMessageTime?: Time, lastMessageTime?: Time }>,
  datatypes: Record<string, { definitions: MessageDefinitionField[] }>,
  profile: string,               // "ros1", "ros2", etc.
  metadata: Array<{ name: string, metadata: Record<string, string> }>,
  publishersByTopic: Record<string, string[]>,
}
```

#### `POST /api/sources/{id}/messages`

Streams messages for playback:

```typescript
// Request
{
  topics: Record<string, { fields?: string[] }>,
  start: { sec: number, nsec: number },
  end: { sec: number, nsec: number },
}

// Response: streaming binary frames, each containing:
// [4 bytes topic name length][topic name][8 bytes timestamp sec][4 bytes timestamp nsec]
// [4 bytes payload length][payload bytes (serialized message)]
// OR: Newline-delimited JSON for simplicity during prototyping
```

#### `POST /api/sources/{id}/backfill`

Returns the last message per topic at or before a given time:

```typescript
// Request
{
  topics: Record<string, { fields?: string[] }>,
  time: { sec: number, nsec: number },
}

// Response: array of message events (same binary framing or JSON)
```

### 2. Client-Side Components to Create

#### a. `BackendIterableSource` (new file)

Location: `packages/suite-base/src/players/IterablePlayer/Backend/BackendIterableSource.ts`

Implements `ISerializedIterableSource`:

```
initialize()        → calls POST /api/sources/{id}/initialize
                      transforms response to Initialization type

messageIterator()   → calls POST /api/sources/{id}/messages with topics + time range
                      returns AsyncIterableIterator<IteratorResult<Uint8Array>>
                      reads streaming response and yields message-events

getBackfillMessages() → calls POST /api/sources/{id}/backfill
                        returns Promise<MessageEvent<Uint8Array>[]>

getMessageCursor()  → (optional) wraps messageIterator with batch support
                      for worker RPC efficiency
```

#### b. `BackendDataSourceFactory` (new file)

Location: `packages/suite-base/src/dataSources/BackendDataSourceFactory.ts`

Implements `IDataSourceFactory`:
- `id`: `"backend-api"`
- `type`: `"connection"`
- `displayName`: `"Backend API"`
- `formConfig.fields`: `[{ id: "url", label: "Backend URL" }, { id: "sourceId", label: "Source ID" }]`
- `initialize()`: Creates `WorkerSerializedIterableSource` wrapping a new `BackendIterableSourceWorker`

#### c. `BackendIterableSourceWorker` (new file)

Location: `packages/suite-base/src/players/IterablePlayer/Backend/BackendIterableSourceWorker.worker.ts`

Web Worker entry point, same pattern as `McapIterableSourceWorker.worker.ts`:
- Receives init args via Comlink
- Creates `BackendIterableSource`
- Exposes `ISerializedIterableSource` methods

#### d. Registration

Add `BackendDataSourceFactory` to the data sources array in:
- `packages/suite-desktop/src/renderer/Root.tsx`
- `packages/suite-web/src/Root.tsx` (if web app supported)

### 3. Wire Protocol Considerations

| Option | Pros | Cons |
|--------|------|------|
| **JSON over HTTP** | Simple to implement & debug | Verbose; slow for large payloads |
| **NDJSON streaming** | Simple; streamable; debuggable | Still text-based overhead |
| **Binary frames over HTTP** | Efficient; streamable via `ReadableStream` | Custom framing; harder to debug |
| **WebSocket** | Bidirectional; natural streaming | More complex lifecycle; not cacheable |
| **gRPC-Web** | Typed; streaming; efficient | Requires protobuf tooling; proxy needed |
| **Server-Sent Events** | Simple streaming; auto-reconnect | Text-only; unidirectional |

**Recommendation for prototyping:** NDJSON over HTTP with `ReadableStream` for
message streaming. Upgrade to binary framing if bandwidth becomes an issue.

**Recommendation for production:** Binary frames over HTTP or gRPC-Web, depending
on existing infrastructure.

### 4. Authentication & Authorization

The backend connection needs auth support. Options:

- **Bearer token in form config**: User pastes a token; sent as `Authorization` header
- **OAuth2/OIDC flow**: Factory opens auth popup, stores token, refreshes automatically
- **API key**: Simplest; passed as header or query parameter

Implementation: Add an `auth` field to `IterableSourceInitializeArgs.api` (the
interface already has an `api?: { baseUrl, auth? }` field at line 218-221 of
`IIterableSource.ts`), and thread it through to the worker.

### 5. What the Backend Must Implement

The backend is out of scope for the Lichtblick codebase, but its contract is:

1. **Data ingestion**: Accept MCAP files (or other formats) and index them
2. **`/initialize`**: Return parsed metadata (topics, schemas, time range)
3. **`/messages`**: Stream messages filtered by topic + time range, in log-time order
4. **`/backfill`**: Return last message per topic at a given time
5. **Auth**: Validate tokens/keys on every request
6. **CORS**: Proper headers for browser-based access

---

## Potential Problems & Challenges

### P1: Streaming Latency

**Problem:** The IterablePlayer expects message iterators to yield data
relatively quickly. If the backend has high latency (network round trips, query
time), playback will stutter.

**Mitigation:**
- The `readAheadDuration` parameter (currently 10s for remote) buffers ahead.
  May need to increase for high-latency backends.
- Backend should support streaming responses so the client receives data
  progressively rather than waiting for the full response.
- Consider prefetching the next time window while the current one plays.

### P2: Seek Performance

**Problem:** When the user seeks to a new time, the player calls
`getBackfillMessages()` and then creates a new `messageIterator()`. Each of these
is a network round trip to the backend. If seeking is frequent (scrubbing the
timeline), this generates many requests.

**Mitigation:**
- Debounce seek requests (IterablePlayer already has some of this logic)
- Backend should support fast indexed lookups
- Consider a client-side cache of recently fetched time ranges
- `BufferedIterableSource` (existing) already caches deserialized messages in
  memory and avoids re-fetching cached ranges

### P3: Message Serialization Format

**Problem:** The `ISerializedIterableSource` interface yields `Uint8Array` for
each message. The backend needs to send messages in a format that the existing
deserialization pipeline (`DeserializingIterableSource`) can handle. This means
the bytes must match the `messageEncoding` declared during initialization (e.g.,
`ros1`, `cdr`, `json`, `protobuf`).

**Mitigation:**
- Backend must preserve original message encoding from the source file
- The `initialize()` response must include accurate `messageEncoding` and
  `schemaEncoding` per topic, matching what the backend will send in `/messages`
- Do NOT re-encode messages server-side unless you also update the schema info

### P4: Large Response Handling

**Problem:** A single `/messages` request covering a wide time range could return
gigabytes of data. The client cannot buffer this in memory.

**Mitigation:**
- Use streaming HTTP responses (the client reads via `ReadableStream`)
- The `messageIterator` yields one message at a time from the stream
- Backend should support `AbortSignal` (client closes connection when seeking)
- Consider pagination or chunked time windows in the protocol

### P5: Connection Lifecycle & Error Recovery

**Problem:** Unlike a static file (which doesn't change), a backend connection
can fail, timeout, or return errors mid-stream. The existing `CachedFilelike`
has retry logic for HTTP streams, but `BackendIterableSource` would need its own.

**Mitigation:**
- Implement retry with exponential backoff on transient errors
- Use `PlayerAlert` to surface connection issues to the user
- Support reconnection without losing playback state
- The `IterablePlayer` already handles source errors and can show alerts

### P6: Worker Communication Overhead

**Problem:** The `IMessageCursor` interface exists specifically because
per-message RPC calls over Comlink (to the Web Worker) are expensive for large
datasets. The backend source must also support batched reading.

**Mitigation:**
- Implement `getMessageCursor()` with `nextBatch()` and `readUntil()` methods
- Accumulate messages from the streaming response into batches before yielding
  across the worker boundary
- Transfer `Uint8Array` buffers using `Comlink.transfer()` for zero-copy

### P7: Schema Compatibility

**Problem:** The existing deserialization pipeline (`DeserializingIterableSource`)
expects schemas in specific formats (ROS message definitions, JSON Schema,
Protobuf descriptors, etc.). The backend must return schemas in the exact format
that the client expects.

**Mitigation:**
- Backend should extract and return raw schema bytes from the original data
- The `TopicWithDecodingInfo` type already carries `messageEncoding`,
  `schemaEncoding`, and `schemaData`—these must be populated correctly
- Test with all supported encodings: `ros1msg`, `ros2msg`, `jsonschema`,
  `protobuf`, `flatbuffer`

### P8: State Consistency

**Problem:** If the backend data changes while the client is viewing it (e.g.,
new data appended, file replaced), the client's cached state becomes stale.

**Mitigation:**
- Include an ETag/version in the initialize response
- Backend can reject requests with stale versions
- Client re-initializes when version mismatch detected
- For append-only data, consider an "end time update" notification mechanism

### P9: CORS & Browser Security

**Problem:** Browser-based access requires proper CORS configuration on the
backend. This is a common source of bugs.

**Mitigation:**
- Document required CORS headers
- Desktop app (Electron) bypasses CORS restrictions
- Consider providing a CORS proxy configuration option

### P10: Time Synchronization

**Problem:** The `Time` type uses `{ sec, nsec }` throughout. JSON serialization
of these values must be lossless. JavaScript's `number` type can lose precision
for large nanosecond values.

**Mitigation:**
- Use string or integer pair representation in the wire protocol
- Validate round-trip precision in tests
- Consider using `BigInt` for nanosecond timestamps in the protocol

---

## Files That Would Need Changes

### New Files

| File | Purpose |
|------|---------|
| `.../Backend/BackendIterableSource.ts` | Implements `ISerializedIterableSource` against backend API |
| `.../Backend/BackendIterableSourceWorker.worker.ts` | Web Worker entry point |
| `.../Backend/BackendApiClient.ts` | HTTP client for backend API with auth, retry, streaming |
| `.../dataSources/BackendDataSourceFactory.ts` | Factory creating player from backend URL |

### Modified Files

| File | Change |
|------|--------|
| `packages/suite-desktop/src/renderer/Root.tsx` | Register `BackendDataSourceFactory` |
| `packages/suite-web/src/Root.tsx` | Register `BackendDataSourceFactory` (if applicable) |

### Existing Files to Reuse (No Changes Needed)

| File | Why |
|------|-----|
| `WorkerSerializedIterableSource.ts` | Worker wrapper pattern—reusable as-is |
| `IterablePlayer.ts` | Orchestrates any `IIterableSource`—works unchanged |
| `DeserializingIterableSource.ts` | Deserializes `Uint8Array` → objects—works if encoding matches |
| `BufferedIterableSource.ts` | In-memory cache—works unchanged |
| `BlockLoader.ts` | Preloading blocks—works unchanged |
| `MessagePipeline/index.tsx` | Message distribution—works unchanged |
| `TopicAliasingPlayer.ts` | Topic aliasing—works unchanged |
| `UserScriptPlayer/index.ts` | User scripts—works unchanged |

---

## Summary

The Lichtblick architecture is well-layered. The `IIterableSource` /
`ISerializedIterableSource` interface is the right integration point. A new
`BackendIterableSource` that speaks HTTP to a backend API, wrapped in the
existing `WorkerSerializedIterableSource` → `IterablePlayer` → `MessagePipeline`
chain, would work with zero changes to the playback, caching, deserialization,
and panel layers.

The main implementation effort is:
1. Designing and implementing the backend API contract
2. Writing `BackendIterableSource` (the client-side adapter)
3. Handling streaming, auth, error recovery, and seek performance
4. Writing a `BackendDataSourceFactory` and registering it

The main risks are around latency (seek performance), message encoding
compatibility, and streaming reliability.
