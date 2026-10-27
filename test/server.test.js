"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("../server");

async function withServer(fn) {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const json = (res) => res.json();

test("GET /health", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await json(res), { ok: true });
  });
});

test("GET /events returns seeded events", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/events`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    const events = await json(res);
    assert.equal(events.length, 2);
    assert.equal(events[0].title, "Street cleanup");
    assert.equal(events[0].rsvpCount, 0);
  });
});

test("POST /events creates an event", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Lantern launch",
        when: "2026-12-01T18:00",
        where: "Corner cafe",
        description: "Say hi",
      }),
    });
    assert.equal(res.status, 201);
    const ev = await json(res);
    assert.equal(ev.id, 3);
    assert.equal(ev.rsvpCount, 0);

    const got = await fetch(`${base}/events/3`);
    assert.equal(got.status, 200);
    assert.equal((await json(got)).title, "Lantern launch");
  });
});

test("POST /events rejects bad input", async () => {
  await withServer(async (base) => {
    for (const body of [
      {},
      { title: "", when: "2026-12-01T18:00", where: "x" },
      { title: "t", when: "not a date", where: "x" },
      { title: "t", when: "2026-12-01T18:00", where: "" },
    ]) {
      const res = await fetch(`${base}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.ok((await json(res)).error);
    }
  });
});

test("POST /events rejects invalid JSON", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{nope",
    });
    assert.equal(res.status, 400);
  });
});

test("POST /events/:id/rsvp increments rsvpCount", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/events/1/rsvp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Sam" }),
    });
    assert.equal(res.status, 201);
    const rsvp = await json(res);
    assert.equal(rsvp.eventId, 1);
    assert.equal(rsvp.name, "Sam");

    const ev = await json(await fetch(`${base}/events/1`));
    assert.equal(ev.rsvpCount, 1);
  });
});

test("rsvp and unknown event give 404", async () => {
  await withServer(async (base) => {
    const rsvp = await fetch(`${base}/events/99/rsvp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Sam" }),
    });
    assert.equal(rsvp.status, 404);
    const got = await fetch(`${base}/events/99`);
    assert.equal(got.status, 404);
    const route = await fetch(`${base}/nope`);
    assert.equal(route.status, 404);
  });
});

test("OPTIONS preflight returns CORS headers", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/events`, { method: "OPTIONS" });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-methods"), "GET,POST,OPTIONS");
  });
});
