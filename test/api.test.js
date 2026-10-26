const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server.js");

function start(options = {}) {
  return new Promise((resolve) => {
    const server = createApp({ dataFile: null, ...options });
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function stop(server) {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(resolve);
  });
}

async function request(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
}

function postJson(url, body) {
  return request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("GET /health answers ok and enables CORS", async (t) => {
  const { server, base } = await start();
  t.after(() => stop(server));

  const res = await request(`${base}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.match(res.headers.get("content-type"), /application\/json/);
});

test("OPTIONS preflight allows the frontend's methods", async (t) => {
  const { server, base } = await start();
  t.after(() => stop(server));

  const res = await request(`${base}/api/events`, { method: "OPTIONS" });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.match(res.headers.get("access-control-allow-methods"), /POST/);
  assert.match(res.headers.get("access-control-allow-methods"), /GET/);
});

test("GET /api/events returns the seeded events in date order", async (t) => {
  const { server, base } = await start();
  t.after(() => stop(server));

  const res = await request(`${base}/api/events`);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
  assert.equal(res.body.length, 2);
  assert.equal(res.body[0].title, "Street cleanup");
  assert.equal(res.body[0].id, 1);
  assert.deepEqual(res.body[0].attendees, []);
  assert.equal(typeof res.body[0].createdAt, "string");
  assert.ok(Date.parse(res.body[0].createdAt));
});

test("POST creates an event; GET by id returns the same shape", async (t) => {
  const { server, base } = await start();
  t.after(() => stop(server));

  const created = await postJson(`${base}/api/events`, {
    title: "  Lantern launch  ",
    when: "2026-12-01T18:00",
    where: "Community hall",
    description: "Bring a dish",
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.id, 3);
  assert.equal(created.body.title, "Lantern launch");
  assert.equal(created.body.when, "2026-12-01T18:00");
  assert.equal(created.body.where, "Community hall");
  assert.equal(created.body.description, "Bring a dish");
  assert.deepEqual(created.body.attendees, []);
  assert.ok(Date.parse(created.body.createdAt));
  assert.equal(created.headers.get("location"), "/api/events/3");

  const fetched = await request(`${base}/api/events/3`);
  assert.equal(fetched.status, 200);
  assert.deepEqual(fetched.body, created.body);

  const listed = await request(`${base}/api/events`);
  assert.equal(listed.body.length, 3);
  assert.equal(listed.body[2].id, 3);
});

test("POST validates the contract and returns JSON errors", async (t) => {
  const { server, base } = await start();
  t.after(() => stop(server));

  const cases = [
    [{ when: "2026-12-01T18:00", where: "Hall" }, /title/],
    [{ title: "X", when: "not-a-date", where: "Hall" }, /when/],
    [{ title: "X", when: "2026-12-01T18:00" }, /where/],
    [
      { title: "X", when: "2026-12-01T18:00", where: "Hall", description: 42 },
      /description/,
    ],
    [
      { title: "x".repeat(121), when: "2026-12-01T18:00", where: "Hall" },
      /title/,
    ],
  ];

  for (const [body, pattern] of cases) {
    const res = await postJson(`${base}/api/events`, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match(res.body.error, pattern);
  }

  const badJson = await postJson(`${base}/api/events`, "{oops");
  assert.equal(badJson.status, 400);
  assert.match(badJson.body.error, /JSON/);

  const arrayBody = await postJson(`${base}/api/events`, "[]");
  assert.equal(arrayBody.status, 400);

  const empty = await postJson(`${base}/api/events`, "");
  assert.equal(empty.status, 400);
  assert.match(empty.body.error, /title/);
});

test("RSVP is idempotent per name and validates the name", async (t) => {
  const { server, base } = await start();
  t.after(() => stop(server));

  const first = await postJson(`${base}/api/events/1/rsvp`, { name: "Ada" });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { eventId: 1, attendees: ["Ada"] });

  const second = await postJson(`${base}/api/events/1/rsvp`, { name: "Ada" });
  assert.equal(second.status, 200);
  assert.deepEqual(second.body.attendees, ["Ada"]);

  const third = await postJson(`${base}/api/events/1/rsvp`, { name: "Grace" });
  assert.deepEqual(third.body.attendees, ["Ada", "Grace"]);

  const missing = await postJson(`${base}/api/events/1/rsvp`, {});
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /name/);

  const unknown = await postJson(`${base}/api/events/999/rsvp`, { name: "Ada" });
  assert.equal(unknown.status, 404);
  assert.match(unknown.body.error, /not found/);
});

test("unknown routes and wrong methods return JSON errors", async (t) => {
  const { server, base } = await start();
  t.after(() => stop(server));

  const route = await request(`${base}/nope`);
  assert.equal(route.status, 404);
  assert.deepEqual(route.body, { error: "not found" });

  const missing = await request(`${base}/api/events/999`);
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.body, { error: "event not found" });

  const wrongMethod = await request(`${base}/api/events/1`, { method: "DELETE" });
  assert.equal(wrongMethod.status, 405);
  assert.match(wrongMethod.body.error, /method/);

  const wrongListMethod = await request(`${base}/api/events`, { method: "PUT" });
  assert.equal(wrongListMethod.status, 405);
});

test("the original /events path remains an alias", async (t) => {
  const { server, base } = await start();
  t.after(() => stop(server));

  const res = await request(`${base}/events`);
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 2);
});

test("events and RSVPs persist across restarts with EVENTS_FILE", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lantern-api-"));
  const dataFile = path.join(dir, "events.json");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const first = await start({ dataFile });
  const created = await postJson(`${first.base}/api/events`, {
    title: "Persisted",
    when: "2026-12-02T18:00",
    where: "Hall",
  });
  assert.equal(created.status, 201);
  await postJson(`${first.base}/api/events/${created.body.id}/rsvp`, { name: "Ada" });
  await stop(first.server);

  const second = await start({ dataFile });
  const res = await request(`${second.base}/api/events`);
  await stop(second.server);

  assert.equal(res.status, 200);
  const persisted = res.body.find((event) => event.title === "Persisted");
  assert.ok(persisted);
  assert.deepEqual(persisted.attendees, ["Ada"]);
});

test("requests with an oversized body are refused", async (t) => {
  const { server, base } = await start();
  t.after(() => stop(server));

  const res = await request(`${base}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "x".repeat(70 * 1024) }),
  });
  assert.equal(res.status, 413);
  assert.match(res.body.error, /too large/);
});
