// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import request from "supertest";

import { DemoDataProvider } from "../providers/DemoDataProvider";
import { IDataProvider } from "../providers/IDataProvider";
import { createApp } from "../server";
import {
  BackfillResponse,
  InitializeResponse,
  MessageFrameJson,
} from "../types/protocol";

function buildApp(providers?: Map<string, IDataProvider>) {
  const map = providers ?? new Map<string, IDataProvider>();
  if (!providers) {
    map.set("demo", new DemoDataProvider());
  }
  return createApp(map);
}

describe("Health endpoint", () => {
  it("returns status ok", async () => {
    const app = buildApp();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("POST /api/sources/:sourceId/initialize", () => {
  it("returns InitializeResponse for a valid sourceId", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/sources/demo/initialize")
      .set("Content-Type", "application/json");

    expect(res.status).toBe(200);

    const body = res.body as InitializeResponse;
    expect(body.start).toHaveProperty("sec");
    expect(body.start).toHaveProperty("nsec");
    expect(body.end).toHaveProperty("sec");
    expect(body.end).toHaveProperty("nsec");
    expect(body.end.sec).toBeGreaterThan(body.start.sec);
    expect(body.topics).toBeInstanceOf(Array);
    expect(body.topics.length).toBeGreaterThan(0);
    expect(body.profile).toBe("demo");

    // Verify topic structure
    const topic = body.topics[0]!;
    expect(topic).toHaveProperty("name");
    expect(topic).toHaveProperty("schemaName");
    expect(topic).toHaveProperty("messageEncoding");
    expect(topic).toHaveProperty("schemaEncoding");
    expect(topic).toHaveProperty("schemaData");

    // Verify schemaData is valid base64
    expect(() => Buffer.from(topic.schemaData, "base64")).not.toThrow();

    // Verify topicStats
    expect(body.topicStats).toBeDefined();
    const stats = body.topicStats[topic.name];
    expect(stats).toBeDefined();
    expect(stats!.numMessages).toBeGreaterThan(0);
  });

  it("returns 404 for unknown sourceId", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/sources/nonexistent/initialize")
      .set("Content-Type", "application/json");

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toContain("nonexistent");
  });
});

describe("POST /api/sources/:sourceId/messages", () => {
  it("streams NDJSON messages for valid request", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/sources/demo/messages")
      .set("Content-Type", "application/json")
      .send({
        topics: { "/sensor/temperature": {} },
        start: { sec: 1700000000, nsec: 0 },
        end: { sec: 1700000001, nsec: 0 },
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/x-ndjson");

    // Parse NDJSON lines
    const lines = res.text
      .split("\n")
      .filter((line) => line.trim().length > 0);

    expect(lines.length).toBeGreaterThan(0);

    // Verify each line is valid JSON
    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);

    // Should contain message frames and possibly stamp lines
    const messageFrames = parsed.filter((p) => p.type !== "stamp") as unknown as MessageFrameJson[];
    const stampLines = parsed.filter((p) => p.type === "stamp");

    expect(messageFrames.length).toBeGreaterThan(0);

    // Verify message frame structure
    const frame = messageFrames[0]!;
    expect(frame.topic).toBe("/sensor/temperature");
    expect(frame.receiveTime).toHaveProperty("sec");
    expect(frame.receiveTime).toHaveProperty("nsec");
    expect(typeof frame.data).toBe("string");

    // Verify data is valid base64 and decodes to valid JSON
    const decoded = Buffer.from(frame.data, "base64").toString("utf-8");
    expect(() => JSON.parse(decoded)).not.toThrow();

    // Should end with a stamp line
    expect(stampLines.length).toBeGreaterThan(0);
  });

  it("returns messages ordered by receiveTime", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/sources/demo/messages")
      .set("Content-Type", "application/json")
      .send({
        topics: {
          "/sensor/temperature": {},
          "/sensor/velocity": {},
        },
        start: { sec: 1700000000, nsec: 0 },
        end: { sec: 1700000002, nsec: 0 },
      });

    const lines = res.text
      .split("\n")
      .filter((line) => line.trim().length > 0);
    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const messages = parsed.filter((p) => p.type !== "stamp") as unknown as MessageFrameJson[];

    // Verify ordering
    for (let i = 1; i < messages.length; i++) {
      const prev = messages[i - 1]!;
      const curr = messages[i]!;
      const prevTime = prev.receiveTime.sec * 1e9 + prev.receiveTime.nsec;
      const currTime = curr.receiveTime.sec * 1e9 + curr.receiveTime.nsec;
      expect(currTime).toBeGreaterThanOrEqual(prevTime);
    }
  });

  it("returns 400 for missing required fields", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/sources/demo/messages")
      .set("Content-Type", "application/json")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns empty stream for unknown topics", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/sources/demo/messages")
      .set("Content-Type", "application/json")
      .send({
        topics: { "/nonexistent/topic": {} },
        start: { sec: 1700000000, nsec: 0 },
        end: { sec: 1700000001, nsec: 0 },
      });

    expect(res.status).toBe(200);

    const lines = res.text
      .split("\n")
      .filter((line) => line.trim().length > 0);
    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const messages = parsed.filter((p) => p.type !== "stamp");

    // No message frames, only possibly a stamp line
    expect(messages.length).toBe(0);
  });
});

describe("POST /api/sources/:sourceId/backfill", () => {
  it("returns messages at the given time", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/sources/demo/backfill")
      .set("Content-Type", "application/json")
      .send({
        topics: { "/sensor/temperature": {} },
        time: { sec: 1700000010, nsec: 0 },
      });

    expect(res.status).toBe(200);

    const body = res.body as BackfillResponse;
    expect(body.messages).toBeInstanceOf(Array);
    expect(body.messages.length).toBe(1);

    const msg = body.messages[0]!;
    expect(msg.topic).toBe("/sensor/temperature");
    expect(msg.receiveTime.sec).toBeLessThanOrEqual(1700000010);
    expect(typeof msg.data).toBe("string");
  });

  it("returns messages for multiple topics", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/sources/demo/backfill")
      .set("Content-Type", "application/json")
      .send({
        topics: {
          "/sensor/temperature": {},
          "/sensor/velocity": {},
          "/vehicle/pose": {},
        },
        time: { sec: 1700000030, nsec: 0 },
      });

    expect(res.status).toBe(200);

    const body = res.body as BackfillResponse;
    expect(body.messages.length).toBe(3);

    const topicNames = body.messages.map((m) => m.topic).sort();
    expect(topicNames).toEqual(["/sensor/temperature", "/sensor/velocity", "/vehicle/pose"]);
  });

  it("returns 400 for missing required fields", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/sources/demo/backfill")
      .set("Content-Type", "application/json")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

describe("CORS", () => {
  it("includes CORS headers in responses", async () => {
    const app = buildApp();
    const res = await request(app).get("/health");

    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("responds to preflight OPTIONS requests", async () => {
    const app = buildApp();
    const res = await request(app)
      .options("/api/sources/demo/initialize")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "POST");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });
});

describe("Auth middleware", () => {
  const originalEnv = process.env.AUTH_TOKEN;

  afterEach(() => {
    if (originalEnv != null) {
      process.env.AUTH_TOKEN = originalEnv;
    } else {
      delete process.env.AUTH_TOKEN;
    }
  });

  it("allows requests when AUTH_TOKEN is not set", async () => {
    delete process.env.AUTH_TOKEN;
    const app = buildApp();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
  });

  it("rejects requests without auth header when AUTH_TOKEN is set", async () => {
    process.env.AUTH_TOKEN = "test-secret-token";
    const app = buildApp();
    const res = await request(app).get("/health");
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  it("rejects requests with wrong token", async () => {
    process.env.AUTH_TOKEN = "test-secret-token";
    const app = buildApp();
    const res = await request(app)
      .get("/health")
      .set("Authorization", "Bearer wrong-token");
    expect(res.status).toBe(401);
  });

  it("accepts requests with correct Bearer token", async () => {
    process.env.AUTH_TOKEN = "test-secret-token";
    const app = buildApp();
    const res = await request(app)
      .get("/health")
      .set("Authorization", "Bearer test-secret-token");
    expect(res.status).toBe(200);
  });

  it("accepts requests with raw token (without Bearer prefix)", async () => {
    process.env.AUTH_TOKEN = "test-secret-token";
    const app = buildApp();
    const res = await request(app)
      .get("/health")
      .set("Authorization", "test-secret-token");
    expect(res.status).toBe(200);
  });
});

describe("DemoDataProvider", () => {
  it("generates valid base64 schema data", () => {
    const provider = new DemoDataProvider();
    const init = provider.initialize();

    for (const topic of init.topics) {
      const decoded = Buffer.from(topic.schemaData, "base64").toString("utf-8");
      const schema = JSON.parse(decoded) as Record<string, unknown>;
      expect(schema).toHaveProperty("type", "object");
      expect(schema).toHaveProperty("properties");
    }
  });

  it("generates messages with valid base64 data", () => {
    const provider = new DemoDataProvider();
    const messages = [
      ...provider.getMessages(
        { "/sensor/temperature": {} },
        { sec: 1700000000, nsec: 0 },
        { sec: 1700000001, nsec: 0 },
      ),
    ];

    expect(messages.length).toBeGreaterThan(0);

    for (const msg of messages) {
      const decoded = Buffer.from(msg.data, "base64").toString("utf-8");
      const payload = JSON.parse(decoded) as Record<string, unknown>;
      expect(payload).toHaveProperty("timestamp");
      expect(payload).toHaveProperty("value");
    }
  });

  it("respects time range boundaries", () => {
    const provider = new DemoDataProvider();
    const start = { sec: 1700000010, nsec: 0 };
    const end = { sec: 1700000011, nsec: 0 };

    const messages = [
      ...provider.getMessages({ "/sensor/temperature": {} }, start, end),
    ];

    for (const msg of messages) {
      const msgTime = msg.receiveTime.sec * 1e9 + msg.receiveTime.nsec;
      const startTime = start.sec * 1e9 + start.nsec;
      const endTime = end.sec * 1e9 + end.nsec;
      expect(msgTime).toBeGreaterThanOrEqual(startTime);
      expect(msgTime).toBeLessThan(endTime);
    }
  });
});
