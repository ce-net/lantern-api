// Lantern API: neighbourhood events. Plain Node, no dependencies.
const http = require("http");
const fs = require("fs");
const path = require("path");

const MAX_BODY = 1024 * 1024;

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const SEED_EVENTS = [
  { title: "Street cleanup", when: "2026-11-01T10:00", where: "Main square", description: "" },
  { title: "Board game night", when: "2026-11-03T19:00", where: "Library", description: "" },
];

function seedEvents() {
  return SEED_EVENTS.map((event, index) => ({
    id: index + 1,
    ...event,
    attendees: [],
    createdAt: new Date().toISOString(),
  }));
}

function loadEvents(file) {
  if (!file) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    if (err.code !== "ENOENT") console.error("could not read events file:", err.message);
    return null;
  }
}

function saveEvents(file, events) {
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(events, null, 2));
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error("could not save events file:", err.message);
  }
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...CORS_HEADERS,
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("invalid JSON body"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validateEvent(body) {
  const title = asText(body.title);
  const when = asText(body.when);
  const where = asText(body.where);
  const description = body.description === undefined ? "" : asText(body.description);

  if (!title) return { error: "title is required" };
  if (!when || Number.isNaN(Date.parse(when))) return { error: "when must be an ISO date string" };
  if (!where) return { error: "where is required" };
  if (body.description !== undefined && typeof body.description !== "string") {
    return { error: "description must be a string" };
  }

  return { value: { title, when, where, description } };
}

function createApp(options = {}) {
  const dataFile = options.dataFile ?? process.env.EVENTS_FILE ?? "";
  const loaded = loadEvents(dataFile);
  const events = loaded || seedEvents();
  let nextId = events.reduce((max, event) => Math.max(max, Number(event.id) || 0), 0) + 1;

  function findEvent(id) {
    return events.find((event) => String(event.id) === String(id));
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS);
      return res.end();
    }

    try {
      if (req.method === "GET" && pathname === "/health") {
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === "GET" && pathname === "/api/events") {
        return sendJson(res, 200, events);
      }

      if (req.method === "POST" && pathname === "/api/events") {
        const body = await readJson(req);
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          return sendJson(res, 400, { error: "body must be a JSON object" });
        }
        const { error, value } = validateEvent(body);
        if (error) return sendJson(res, 400, { error });

        const event = {
          id: nextId++,
          ...value,
          attendees: [],
          createdAt: new Date().toISOString(),
        };
        events.push(event);
        saveEvents(dataFile, events);
        return sendJson(res, 201, event);
      }

      const idMatch = pathname.match(/^\/api\/events\/([^/]+)$/);
      if (idMatch && req.method === "GET") {
        const event = findEvent(decodeURIComponent(idMatch[1]));
        if (!event) return sendJson(res, 404, { error: "event not found" });
        return sendJson(res, 200, event);
      }

      const rsvpMatch = pathname.match(/^\/api\/events\/([^/]+)\/rsvp$/);
      if (rsvpMatch && req.method === "POST") {
        const event = findEvent(decodeURIComponent(rsvpMatch[1]));
        if (!event) return sendJson(res, 404, { error: "event not found" });

        const body = await readJson(req);
        const name = asText(body && body.name);
        if (!name) return sendJson(res, 400, { error: "name is required" });
        if (!Array.isArray(event.attendees)) event.attendees = [];
        if (!event.attendees.includes(name)) {
          event.attendees.push(name);
          saveEvents(dataFile, events);
        }
        return sendJson(res, 200, { eventId: event.id, attendees: event.attendees });
      }

      return sendJson(res, 404, { error: "not found" });
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.status ? err.message : "internal error" });
    }
  });
}

if (require.main === module) {
  const port = +process.env.PORT || 8080;
  createApp().listen(port, () => console.log("lantern-api on", port));
}

module.exports = { createApp };
