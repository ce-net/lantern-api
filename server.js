// Lantern API: neighbourhood events. Plain Node, no dependencies.
//
// Contract (agreed with the Lantern frontend):
//   GET  /api/events                 -> [Event]
//   POST /api/events                 -> 201 Event
//   GET  /api/events/:id             -> Event | 404
//   POST /api/events/:id/rsvp        -> {eventId, attendees}
//   GET  /health                     -> {ok:true}
//
// Event: {id, title, when, where, description, attendees:[name], createdAt}
// Errors: {error:"message"} with a 4xx/5xx status. CORS is open for the
// static frontend, which is served from a different origin.

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const MAX_BODY = 64 * 1024;
const MAX_TITLE = 120;
const MAX_WHERE = 120;
const MAX_DESCRIPTION = 1000;
const MAX_NAME = 80;

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

const SEED_EVENTS = [
  {
    title: "Street cleanup",
    when: "2026-11-01T10:00",
    where: "Main square",
    description: "Gloves and bags provided. Meet by the fountain.",
  },
  {
    title: "Board game night",
    when: "2026-11-03T19:00",
    where: "Library",
    description: "Bring a favourite game if you have one.",
  },
];

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function seedEvents() {
  const createdAt = new Date().toISOString();
  return SEED_EVENTS.map((event, index) => ({
    id: index + 1,
    title: event.title,
    when: event.when,
    where: event.where,
    description: event.description,
    attendees: [],
    createdAt,
  }));
}

function normaliseEvent(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const id = Number(raw.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  return {
    id,
    title: typeof raw.title === "string" ? raw.title : "",
    when: typeof raw.when === "string" ? raw.when : "",
    where: typeof raw.where === "string" ? raw.where : "",
    description: typeof raw.description === "string" ? raw.description : "",
    attendees: Array.isArray(raw.attendees)
      ? raw.attendees.filter((name) => typeof name === "string")
      : [],
    createdAt:
      typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
  };
}

function loadEvents(file) {
  if (!file) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(parsed)) return null;
    return parsed.map(normaliseEvent).filter(Boolean);
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error("lantern-api: could not read events file:", err.message);
    }
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
    // A read-only data directory must not make the API unusable; the
    // in-memory copy still answers, and the failure is visible in the log.
    console.error("lantern-api: could not save events file:", err.message);
  }
}

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...CORS_HEADERS,
    ...extraHeaders,
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

function sendEmpty(res, status, extraHeaders = {}) {
  res.writeHead(status, { ...CORS_HEADERS, ...extraHeaders });
  res.end();
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let done = false;
    const chunks = [];
    req.on("data", (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        done = true;
        // Keep draining so the client can read the 413 instead of seeing a
        // reset connection; the oversized bytes are not buffered.
        reject(httpError(413, "body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (done) return;
      done = true;
      if (chunks.length === 0) return resolve({});
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return reject(httpError(400, "JSON body must be an object"));
        }
        resolve(value);
      } catch {
        reject(httpError(400, "invalid JSON body"));
      }
    });
    req.on("error", (err) => {
      if (done) return;
      done = true;
      reject(err);
    });
  });
}

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validateEvent(body) {
  const title = asText(body.title);
  const when = asText(body.when);
  const where = asText(body.where);
  const description =
    body.description === undefined || body.description === null
      ? ""
      : asText(body.description);

  if (!title) return { error: "title is required" };
  if (title.length > MAX_TITLE) {
    return { error: `title must be at most ${MAX_TITLE} characters` };
  }
  if (!when) return { error: "when is required" };
  if (Number.isNaN(Date.parse(when))) {
    return { error: "when must be an ISO date string" };
  }
  if (!where) return { error: "where is required" };
  if (where.length > MAX_WHERE) {
    return { error: `where must be at most ${MAX_WHERE} characters` };
  }
  if (description.length > MAX_DESCRIPTION) {
    return { error: `description must be at most ${MAX_DESCRIPTION} characters` };
  }
  if (
    body.description !== undefined &&
    body.description !== null &&
    typeof body.description !== "string"
  ) {
    return { error: "description must be a string" };
  }
  return { value: { title, when, where, description } };
}

function validateName(body) {
  const name = asText(body.name);
  if (!name) return { error: "name is required" };
  if (name.length > MAX_NAME) {
    return { error: `name must be at most ${MAX_NAME} characters` };
  }
  return { value: name };
}

function byWhen(a, b) {
  return String(a.when).localeCompare(String(b.when)) || a.id - b.id;
}

function createApp(options = {}) {
  const dataFile =
    options.dataFile !== undefined
      ? options.dataFile
      : process.env.EVENTS_FILE || null;

  let events = loadEvents(dataFile);
  if (events === null) events = seedEvents();

  function findEvent(id) {
    return events.find((event) => String(event.id) === id) || null;
  }

  function nextId() {
    return events.reduce((max, event) => Math.max(max, Number(event.id) || 0), 0) + 1;
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const pathname = url.pathname.replace(/\/+$/, "") || "/";

      if (req.method === "OPTIONS") {
        return sendEmpty(res, 204);
      }

      if (pathname === "/health") {
        if (req.method !== "GET") {
          return sendJson(res, 405, { error: "method not allowed" }, { allow: "GET, OPTIONS" });
        }
        return sendJson(res, 200, { ok: true });
      }

      // /events is kept as an alias for the original, pre-frontend API.
      const listPath = pathname === "/api/events" || pathname === "/events";

      if (listPath) {
        if (req.method === "GET") {
          return sendJson(res, 200, [...events].sort(byWhen));
        }
        if (req.method === "POST") {
          const body = await readJson(req);
          const checked = validateEvent(body);
          if (checked.error) return sendJson(res, 400, { error: checked.error });

          const event = {
            id: nextId(),
            ...checked.value,
            attendees: [],
            createdAt: new Date().toISOString(),
          };
          events.push(event);
          saveEvents(dataFile, events);
          return sendJson(
            res,
            201,
            event,
            { location: `/api/events/${event.id}` }
          );
        }
        return sendJson(
          res,
          405,
          { error: "method not allowed" },
          { allow: "GET, POST, OPTIONS" }
        );
      }

      const idMatch = pathname.match(/^\/api\/events\/([^/]+)$/);
      if (idMatch) {
        if (req.method !== "GET") {
          return sendJson(res, 405, { error: "method not allowed" }, { allow: "GET, OPTIONS" });
        }
        const event = findEvent(decodeURIComponent(idMatch[1]));
        if (!event) return sendJson(res, 404, { error: "event not found" });
        return sendJson(res, 200, event);
      }

      const rsvpMatch = pathname.match(/^\/api\/events\/([^/]+)\/rsvp$/);
      if (rsvpMatch) {
        if (req.method !== "POST") {
          return sendJson(res, 405, { error: "method not allowed" }, { allow: "POST, OPTIONS" });
        }
        const event = findEvent(decodeURIComponent(rsvpMatch[1]));
        if (!event) return sendJson(res, 404, { error: "event not found" });

        const body = await readJson(req);
        const checked = validateName(body);
        if (checked.error) return sendJson(res, 400, { error: checked.error });

        if (!event.attendees.includes(checked.value)) {
          event.attendees.push(checked.value);
          saveEvents(dataFile, events);
        }
        return sendJson(res, 200, {
          eventId: event.id,
          attendees: event.attendees,
        });
      }

      return sendJson(res, 404, { error: "not found" });
    } catch (err) {
      const status = err && err.status ? err.status : 500;
      if (status === 500) console.error("lantern-api:", err);
      // If headers were already sent, all we can do is close the response.
      if (res.headersSent) return res.end();
      return sendJson(res, status, {
        error: status === 500 ? "internal error" : err.message,
      });
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 8080;
  const server = createApp();
  server.listen(port, () => {
    console.log(`lantern-api listening on http://localhost:${port}`);
  });
}

module.exports = { createApp };
