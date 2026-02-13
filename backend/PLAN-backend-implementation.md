# Plan: Lichtblick Python Backend Service

## Overview

Implement a Python backend service that fulfills the message-level API contract
defined by the Lichtblick frontend's `BackendApiClient`. The backend serves as
the bridge between the frontend visualization layer and data sources (MCAP files,
databases, live streams, etc.). This plan focuses exclusively on the
**communication layer** — the HTTP API, streaming protocol, CORS, error handling,
and a demo data source for validation. Real production data source adapters are
out of scope.

---

## Technology Stack

| Component          | Choice                  | Rationale                                                    |
|--------------------|-------------------------|--------------------------------------------------------------|
| Language           | Python 3.12+            | Requested by user                                            |
| Package Manager    | uv                      | Requested by user; fast, modern Python package manager       |
| Web Framework      | FastAPI                 | Async-native, automatic OpenAPI docs, streaming support      |
| ASGI Server        | uvicorn                 | Standard ASGI server, works with FastAPI streaming responses |
| Data Validation    | Pydantic v2             | Built into FastAPI, enforces API contract types              |
| Testing            | pytest + httpx          | httpx for async test client, pytest for test runner          |
| CORS               | FastAPI CORSMiddleware  | Built-in, configurable                                       |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Lichtblick Frontend (Browser / Electron)                     │
│                                                              │
│  BackendApiClient ──── HTTP POST ────┐                       │
│                                      │                       │
└──────────────────────────────────────┼───────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────┐
│ Python Backend Service (FastAPI)                             │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ API Router (/api/sources/{source_id}/...)               │ │
│  │                                                         │ │
│  │  POST /initialize  → InitializeResponse (JSON)         │ │
│  │  POST /messages    → StreamingResponse (NDJSON)        │ │
│  │  POST /backfill    → BackfillResponse (JSON)           │ │
│  │  GET  /health      → Health check                      │ │
│  └────────────────┬────────────────────────────────────────┘ │
│                   │                                          │
│  ┌────────────────▼────────────────────────────────────────┐ │
│  │ DataSource Interface (Protocol)                         │ │
│  │                                                         │ │
│  │  initialize() → metadata, topics, stats                 │ │
│  │  get_messages(topics, start, end) → async generator     │ │
│  │  get_backfill(topics, time) → list of messages          │ │
│  └────────────────┬────────────────────────────────────────┘ │
│                   │                                          │
│  ┌────────────────▼────────────────────────────────────────┐ │
│  │ DemoDataSource (mock/synthetic data for testing)        │ │
│  │                                                         │ │
│  │  Generates synthetic sensor messages:                   │ │
│  │  - /sensor/imu (IMU data)                               │ │
│  │  - /sensor/gps (GPS coordinates)                        │ │
│  │  - /camera/info (camera metadata)                       │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
backend/
├── pyproject.toml              # Project config, dependencies (uv)
├── README.md                   # (not created — out of scope)
├── PLAN-backend-implementation.md
├── src/
│   └── lichtblick_backend/
│       ├── __init__.py
│       ├── main.py             # FastAPI app entry point
│       ├── config.py           # Configuration (host, port, CORS)
│       ├── models.py           # Pydantic models matching frontend types.ts
│       ├── protocol.py         # DataSource protocol (interface)
│       ├── router.py           # API route handlers
│       ├── ndjson.py           # NDJSON streaming helpers
│       └── demo_source.py      # Demo data source (synthetic data)
└── tests/
    ├── __init__.py
    ├── conftest.py             # Shared fixtures (test client, demo source)
    ├── test_initialize.py      # Tests for /initialize endpoint
    ├── test_messages.py        # Tests for /messages endpoint (streaming)
    ├── test_backfill.py        # Tests for /backfill endpoint
    ├── test_health.py          # Tests for /health endpoint
    ├── test_errors.py          # Tests for error cases
    └── test_models.py          # Tests for Pydantic model validation
```

---

## API Contract (matching frontend `types.ts`)

### `POST /api/sources/{source_id}/initialize`

**Request:** Empty body (source_id in path)

**Response (200):**
```json
{
  "start": { "sec": 1700000000, "nsec": 0 },
  "end": { "sec": 1700000060, "nsec": 0 },
  "topics": [
    {
      "name": "/sensor/imu",
      "schemaName": "sensor_msgs/Imu",
      "messageEncoding": "cdr",
      "schemaEncoding": "ros2msg",
      "schemaData": "<base64-encoded schema bytes>"
    }
  ],
  "topicStats": {
    "/sensor/imu": {
      "numMessages": 6000,
      "firstMessageTime": { "sec": 1700000000, "nsec": 0 },
      "lastMessageTime": { "sec": 1700000059, "nsec": 990000000 }
    }
  },
  "profile": "ros2",
  "metadata": [],
  "publishersByTopic": { "/sensor/imu": ["imu_node"] }
}
```

**Error responses:**
- `404` — source_id not found
- `500` — internal error during initialization

---

### `POST /api/sources/{source_id}/messages`

**Request body:**
```json
{
  "topics": { "/sensor/imu": { "fields": null } },
  "start": { "sec": 1700000000, "nsec": 0 },
  "end": { "sec": 1700000010, "nsec": 0 }
}
```

**Response (200):** `Content-Type: application/x-ndjson`, streamed line-by-line:

```
{"topic":"/sensor/imu","receiveTime":{"sec":1700000000,"nsec":0},"data":"base64..."}
{"topic":"/sensor/imu","receiveTime":{"sec":1700000000,"nsec":10000000},"data":"base64..."}
{"type":"stamp","stamp":{"sec":1700000001,"nsec":0}}
{"topic":"/sensor/imu","receiveTime":{"sec":1700000001,"nsec":0},"data":"base64..."}
```

**Streaming behavior:**
- Messages are yielded as they become available (async generator)
- Stamp lines are emitted periodically (every N messages or every second of data time)
- Connection can be cancelled by the client via abort (server detects disconnect)

**Error responses:**
- `404` — source_id not found
- `422` — invalid request body
- `500` — internal error during message retrieval

---

### `POST /api/sources/{source_id}/backfill`

**Request body:**
```json
{
  "topics": { "/sensor/imu": { "fields": null } },
  "time": { "sec": 1700000005, "nsec": 0 }
}
```

**Response (200):**
```json
{
  "messages": [
    {
      "topic": "/sensor/imu",
      "receiveTime": { "sec": 1700000004, "nsec": 990000000 },
      "data": "base64..."
    }
  ]
}
```

**Error responses:**
- `404` — source_id not found
- `422` — invalid request body
- `500` — internal error during backfill

---

### `GET /api/health`

**Response (200):**
```json
{ "status": "ok" }
```

---

## Implementation Chunks

### Chunk 1: Project Setup & Configuration

**Files:** `pyproject.toml`, `src/lichtblick_backend/__init__.py`, `config.py`

**Tasks:**
- Initialize `uv` project with `pyproject.toml`
- Define dependencies: `fastapi`, `uvicorn`, `pydantic`
- Define dev dependencies: `pytest`, `httpx`, `pytest-asyncio`
- Create `config.py` with environment-based configuration

**Acceptance Criteria:**
- [ ] `uv sync` installs all dependencies without errors
- [ ] `uv run python -c "import lichtblick_backend"` succeeds
- [ ] Configuration loads default values and respects environment overrides

---

### Chunk 2: Pydantic Models

**File:** `models.py`

**Tasks:**
- Define all request/response models matching `types.ts` exactly:
  - `TimeJson`, `TopicInfoJson`, `TopicStatsJson`
  - `InitializeResponse`, `MessagesRequest`, `MessageFrameJson`
  - `BackfillRequest`, `BackfillResponse`
- Ensure field names match the camelCase JSON wire format (using Pydantic aliases or `model_config`)

**Acceptance Criteria:**
- [ ] All model fields match `types.ts` exactly (names, types, optionality)
- [ ] Models serialize to camelCase JSON matching frontend expectations
- [ ] `TimeJson` has `sec: int` and `nsec: int` with `nsec` constrained to `[0, 999999999]`
- [ ] `schemaData` and `data` fields accept/produce base64 strings
- [ ] Optional fields (`publishTime`, `sizeInBytes`, `metadata`, `publishersByTopic`) serialize correctly when absent

---

### Chunk 3: DataSource Protocol

**File:** `protocol.py`

**Tasks:**
- Define a `DataSource` Protocol class with methods:
  - `async def initialize() -> InitializeResult`
  - `async def get_messages(topics, start, end) -> AsyncIterator[MessageFrame | StampMarker]`
  - `async def get_backfill(topics, time) -> list[MessageFrame]`
- Define internal types (`MessageFrame`, `StampMarker`, `InitializeResult`) separate from wire types

**Acceptance Criteria:**
- [ ] Protocol is runtime-checkable
- [ ] DemoDataSource (Chunk 5) satisfies the Protocol without errors
- [ ] Internal types cleanly convert to/from wire Pydantic models

---

### Chunk 4: NDJSON Streaming Helper

**File:** `ndjson.py`

**Tasks:**
- Implement `ndjson_stream(async_generator)` that yields newline-delimited JSON bytes
- Each message is serialized using Pydantic's `.model_dump_json()` + `\n`
- Stamp markers serialized as `{"type": "stamp", "stamp": {"sec": N, "nsec": N}}`

**Acceptance Criteria:**
- [ ] Each line is valid JSON terminated by `\n`
- [ ] Message lines contain `topic`, `receiveTime`, `data` (base64)
- [ ] Stamp lines contain `type: "stamp"` and `stamp` object
- [ ] Empty generators produce empty response (no trailing newline)
- [ ] Generator cancellation (client disconnect) is handled gracefully

---

### Chunk 5: Demo Data Source

**File:** `demo_source.py`

**Tasks:**
- Implement `DemoDataSource` that satisfies the `DataSource` protocol
- Generates synthetic sensor data for topics:
  - `/sensor/imu` — 100 Hz, simple JSON-encoded IMU readings
  - `/sensor/gps` — 10 Hz, lat/lon/alt
  - `/diagnostics` — 1 Hz, status strings
- Time range: configurable (default 60 seconds)
- Messages use JSON encoding with `jsonschema` schema encoding for simplicity
- Schema data is base64-encoded JSON schema strings

**Acceptance Criteria:**
- [ ] `initialize()` returns valid metadata with 3 topics and correct stats
- [ ] `get_messages()` yields messages in chronological order within the requested range
- [ ] `get_messages()` only yields messages for requested topics
- [ ] `get_messages()` emits stamp markers every 1 second of data time
- [ ] `get_backfill()` returns the last message per topic at or before the requested time
- [ ] All message `data` fields are valid base64
- [ ] Schema data is valid base64

---

### Chunk 6: API Router & Endpoints

**File:** `router.py`

**Tasks:**
- Implement the three endpoints registered under `/api/sources/{source_id}/...`
- `/initialize`: Look up source, call `initialize()`, return JSON
- `/messages`: Look up source, call `get_messages()`, return `StreamingResponse` with NDJSON
- `/backfill`: Look up source, call `get_backfill()`, return JSON
- Source registry: simple dict mapping source_id → DataSource
- Return 404 with descriptive message for unknown source_id

**Acceptance Criteria:**
- [ ] All three endpoints return correct status codes and response shapes
- [ ] `/messages` returns `Content-Type: application/x-ndjson`
- [ ] `/messages` streams data incrementally (does not buffer entire response)
- [ ] Unknown source_id returns 404 with `{"detail": "Source '<id>' not found"}`
- [ ] Invalid request bodies return 422 with validation details
- [ ] Client disconnect during streaming does not cause server errors

---

### Chunk 7: FastAPI App Assembly & CORS

**File:** `main.py`

**Tasks:**
- Create FastAPI app instance
- Add CORS middleware (configurable origins, default `*` for development)
- Include API router
- Register the demo data source under source_id `"demo"`
- Add `/api/health` endpoint
- Configure uvicorn runner

**Acceptance Criteria:**
- [ ] `uv run python -m lichtblick_backend.main` starts the server on port 8000
- [ ] `GET /api/health` returns `{"status": "ok"}`
- [ ] CORS headers present on responses (`Access-Control-Allow-Origin`, etc.)
- [ ] Preflight `OPTIONS` requests return correct CORS headers
- [ ] Frontend at `http://localhost:8080` can connect without CORS errors

---

### Chunk 8: Tests

**Files:** `tests/`

**Tests to implement:**

| Test File              | What It Validates                                                |
|------------------------|------------------------------------------------------------------|
| `test_models.py`       | Pydantic models serialize/deserialize correctly, camelCase JSON   |
| `test_health.py`       | Health endpoint returns 200 + correct body                       |
| `test_initialize.py`   | Initialize returns valid metadata; 404 for unknown source        |
| `test_messages.py`     | Streaming NDJSON response; messages in order; stamp markers; topic filtering; empty range |
| `test_backfill.py`     | Returns last message per topic; 404 for unknown source           |
| `test_errors.py`       | Invalid bodies → 422; unknown sources → 404                     |

**Acceptance Criteria:**
- [ ] All tests pass with `uv run pytest`
- [ ] Tests use `httpx.AsyncClient` with FastAPI test transport (no real server needed)
- [ ] Streaming tests verify line-by-line NDJSON parsing
- [ ] At least one test per endpoint per error scenario

---

## Validation & Acceptance Criteria (End-to-End)

### Functional Criteria

1. **Server starts cleanly**
   - `uv run python -m lichtblick_backend.main` binds to `0.0.0.0:8000`
   - No import errors, no startup warnings

2. **Health check works**
   - `curl http://localhost:8000/api/health` → `{"status":"ok"}`

3. **Initialize endpoint**
   - `curl -X POST http://localhost:8000/api/sources/demo/initialize`
   - Returns 200 with valid `InitializeResponse` JSON
   - Response contains `start`, `end`, `topics`, `topicStats`, `profile`
   - Topic schemas are valid base64

4. **Messages endpoint streams correctly**
   - `curl -X POST http://localhost:8000/api/sources/demo/messages -H 'Content-Type: application/json' -d '{"topics":{"/sensor/imu":{}},"start":{"sec":0,"nsec":0},"end":{"sec":5,"nsec":0}}'`
   - Returns streaming NDJSON (lines arrive incrementally)
   - Each line is valid JSON with `topic`, `receiveTime`, `data`
   - Stamp lines appear periodically
   - Messages are in chronological order

5. **Backfill endpoint**
   - `curl -X POST http://localhost:8000/api/sources/demo/backfill -H 'Content-Type: application/json' -d '{"topics":{"/sensor/imu":{}},"time":{"sec":5,"nsec":0}}'`
   - Returns 200 with `{"messages": [...]}`
   - Messages have `receiveTime` ≤ requested time

6. **Error handling**
   - Unknown source → 404 with descriptive message
   - Malformed body → 422 with validation errors
   - Server handles client disconnect gracefully during streaming

7. **CORS**
   - Preflight `OPTIONS` returns `Access-Control-Allow-Origin`
   - Actual requests include CORS headers
   - Browser-based frontend can connect without CORS errors

### Non-Functional Criteria

8. **Streaming performance**
   - Messages endpoint does not buffer entire response in memory
   - First message arrives before entire range is computed

9. **Clean shutdown**
   - Ctrl+C / SIGTERM shuts down gracefully
   - No "connection reset" errors in client

10. **Code quality**
    - All tests pass (`uv run pytest`)
    - Type annotations on all public functions
    - Pydantic models enforce constraints

### Integration Criteria (Manual Verification)

11. **Frontend connects to backend**
    - Start backend: `uv run python -m lichtblick_backend.main`
    - Start Lichtblick web: `yarn web:serve`
    - Open connection dialog → select "Backend API"
    - Enter URL: `http://localhost:8000`, Source ID: `demo`
    - Topics appear in sidebar
    - Messages play back in timeline
    - Seeking (backfill) works correctly

---

## Chunk Dependency Graph

```
Chunk 1 (Project Setup) ──→ ALL chunks
Chunk 2 (Models) ──→ Chunks 3, 4, 5, 6
Chunk 3 (Protocol) ──→ Chunks 5, 6
Chunk 4 (NDJSON) ──→ Chunk 6
Chunk 5 (Demo Source) ──→ Chunks 6, 7
Chunk 6 (Router) ──→ Chunk 7
Chunk 7 (App Assembly) ──→ Chunk 8

Parallel work:
- Phase 1: Chunks 1, 2 (no deps)
- Phase 2: Chunks 3, 4 (depend on 2)
- Phase 3: Chunks 5, 6 (depend on 2, 3, 4)
- Phase 4: Chunk 7 (depends on 5, 6)
- Phase 5: Chunk 8 (depends on 7)
```
