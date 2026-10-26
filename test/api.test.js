const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server.js");

function start(options) {
  return new Promise((resolve) => {
    const server = createApp(options);
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function stop(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function json(res) {
  return { status: res.status, body: await res.json(), headers: res.headers };
}

test("GET /health and CORS", async (t) => {
  const { server, base } = await start();
  t.after(() => stop(server));

  const res = await json(await fetch(`${base}/health`));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
});

test("OPTIONS preflight is allowed", async (t) => {
  const { server, base } = await start();
  t.after(() => stop(server));

  const res = await fetch(`${base}/api/events`, { method: "OPTIONS" });
  assert.equal(res.status, 204);
  assert.match(res.headers.get("access-control-allow-methods"), /POST/);
});

test("GET /api/events returns the seed events", async (t) => {
  const { server, base } = await start();
  t.after(() => stop(server));

  const res = await json(await fetch(`${base}/api/events`));
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 2);
  assert.equal(res.body[0].title, "Street cleanup");
  assert.deepEqual(res.body[0].attendees, []);
});

test("POST /api/events creates an event and GET by id returns it", async (t) => {
  const { server, base } = await start();
  t.after(() => stop(server));

  const created = await json(
    await fetch(`${base}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Lantern launch",
        when: "2026-12-01T18:00",
        where: "Community hall",
        description: "Bring a dish",
      }),
    })
  );
  assert.equal(created.status, 201);
  assert.equal(created.body.id, 3);
  assert.equal(created.body.title, "Lantern launch");
  assert.equal(created.body.description, "Bring a dish");
  assert.deepEqual(created.body.attendees, []);
  assert.ok(!Number.isNaN(Date.parse(created.body.createdAt)));

  const fetched = await json(await fetch(`${base}/api/events/${created.body.id}`));
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.title, "Lantern launch");
});

test("POST /api/events validates input", async (t) => {
  const { server, base } = await start();
  t.after(() => stop(server));

  const missingTitle = await json(
    await fetch(`${base}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ when: "2026-12-01T18:00", where: "Hall" }),
    })
  );
  assert.equal(missingTitle.status, 400);
  assert.match(missingTitle.body.error, /title/);

  const badDate = await json(
    await fetch(`${base}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "X", when: "not-a-date", where: "Hall" }),
    })
  );
  assert.equal(badDate.status, 400);
  assert.match(badDate.body.error, /when/);

  const badJson = await fetch(`${base}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{oops",
  });
  assert.equal(badJson.status, 400);
});

test("RSVP adds a name once and is idempotent", async (t) => {
  const { server, base } = await start();
  t.after(() => stop(server));

  const first = await json(
    await fetch(`${base}/api/events/1/rsvp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada" }),
    })
  );
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { eventId: 1, attendees: ["Ada"] });

  const second = await json(
    await fetch(`${base}/api/events/1/rsvp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada" }),
    })
  );
  assert.equal(second.status, 200);
  assert.deepEqual(second.body.attendees, ["Ada"]);

  const missingName = await fetch(`${base}/api/events/1/rsvp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(missingName.status, 400);
});

test("unknown routes and missing events return 404 JSON", async (t) => {
  const { server, base } = await start();
  t.after(() => stop(server));

  const route = await json(await fetch(`${base}/nope`));
  assert.equal(route.status, 404);
  assert.deepEqual(route.body, { error: "not found" });

  const event = await json(await fetch(`${base}/api/events/999`));
  assert.equal(event.status, 404);
  assert.deepEqual(event.body, { error: "event not found" });
});

test("events persist to EVENTS_FILE across restarts", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lantern-api-"));
  const dataFile = path.join(dir, "events.json");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const first = await start({ dataFile });
  const created = await json(
    await fetch(`${first.base}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Persisted", when: "2026-12-02T18:00", where: "Hall" }),
    })
  );
  assert.equal(created.status, 201);
  await stop(first.server);

  const second = await start({ dataFile });
  const res = await json(await fetch(`${second.base}/api/events`));
  await stop(second.server);
  assert.equal(res.status, 200);
  assert.ok(res.body.some((event) => event.title === "Persisted"));
});
