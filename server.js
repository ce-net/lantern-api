// Lantern API: neighbourhood events. Plain Node, no dependencies.
"use strict";

const http = require("http");

const MAX_BODY = 1024 * 1024;

function createApp(seed = true) {
  let nextId = 1;
  const events = [];
  const rsvps = [];

  function addEvent({ title, when, where, description = "" }) {
    const ev = { id: nextId++, title, when, where, description, rsvpCount: 0 };
    events.push(ev);
    return ev;
  }

  if (seed) {
    addEvent({ id: 1, title: "Street cleanup", when: "2026-11-01T10:00", where: "Main square" });
    addEvent({ id: 2, title: "Board game night", when: "2026-11-03T19:00", where: "Library" });
  }

  function send(res, status, body) {
    const payload = body === undefined ? "" : JSON.stringify(body);
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(payload),
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
      "cache-control": "no-store",
    });
    res.end(payload);
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      let raw = "";
      let size = 0;
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) {
          reject(Object.assign(new Error("body too large"), { status: 413 }));
          req.destroy();
          return;
        }
        raw += chunk;
      });
      req.on("end", () => {
        if (!raw) return resolve({});
        try {
          const parsed = JSON.parse(raw);
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            return reject(Object.assign(new Error("body must be a JSON object"), { status: 400 }));
          }
          resolve(parsed);
        } catch {
          reject(Object.assign(new Error("invalid JSON"), { status: 400 }));
        }
      });
      req.on("error", reject);
    });
  }

  function isNonEmptyString(v) {
    return typeof v === "string" && v.trim().length > 0;
  }

  function isIsoDate(v) {
    return isNonEmptyString(v) && !Number.isNaN(Date.parse(v));
  }

  function findEvent(id) {
    return events.find((e) => e.id === id);
  }

  async function handler(req, res) {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "86400",
      });
      return res.end();
    }

    try {
      if (req.method === "GET" && path === "/health") {
        return send(res, 200, { ok: true });
      }

      if (req.method === "GET" && path === "/events") {
        return send(res, 200, events);
      }

      if (req.method === "POST" && path === "/events") {
        const body = await readJson(req);
        const { title, when, where, description } = body;
        if (!isNonEmptyString(title)) return send(res, 400, { error: "title is required" });
        if (!isIsoDate(when)) return send(res, 400, { error: "when must be an ISO 8601 date string" });
        if (!isNonEmptyString(where)) return send(res, 400, { error: "where is required" });
        if (description !== undefined && typeof description !== "string") {
          return send(res, 400, { error: "description must be a string" });
        }
        const ev = addEvent({ title: title.trim(), when, where: where.trim(), description: description || "" });
        return send(res, 201, ev);
      }

      const rsvpMatch = path.match(/^\/events\/(\d+)\/rsvp$/);
      if (req.method === "POST" && rsvpMatch) {
        const id = Number(rsvpMatch[1]);
        const ev = findEvent(id);
        if (!ev) return send(res, 404, { error: "event not found" });
        const body = await readJson(req);
        if (!isNonEmptyString(body.name)) return send(res, 400, { error: "name is required" });
        const rsvp = { id: rsvps.length + 1, eventId: id, name: body.name.trim() };
        rsvps.push(rsvp);
        ev.rsvpCount += 1;
        return send(res, 201, rsvp);
      }

      const eventMatch = path.match(/^\/events\/(\d+)$/);
      if (req.method === "GET" && eventMatch) {
        const ev = findEvent(Number(eventMatch[1]));
        if (!ev) return send(res, 404, { error: "event not found" });
        return send(res, 200, ev);
      }

      return send(res, 404, { error: "not found" });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error(err);
      return send(res, status, { error: err.status ? err.message : "internal server error" });
    }
  }

  return { handler, events, rsvps, addEvent };
}

function createServer(opts) {
  const app = createApp(opts && opts.seed);
  return http.createServer(app.handler);
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 18080;
  const server = createServer();
  server.listen(port, () => console.log(`lantern-api on ${port}`));
}

module.exports = { createApp, createServer };
