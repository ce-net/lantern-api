# lantern-api

Backend for Lantern, a neighbourhood events app. Plain Node, no dependencies.

```sh
npm start              # listens on $PORT (default 8080)
npm test               # node --test
PORT=18080 npm start   # the port used for local integration
```

Set `EVENTS_FILE=/path/events.json` to persist events across restarts. With no
file set, events live in memory for the life of the process.

## API

Base URL for local integration: `http://localhost:18080`. All responses are
JSON with `access-control-allow-origin: *` (CORS is on for the frontend).

### Event

```json
{
  "id": 3,
  "title": "Lantern launch",
  "when": "2026-12-01T18:00",
  "where": "Community hall",
  "description": "Bring a dish",
  "attendees": ["Ada"],
  "createdAt": "2026-10-26T14:30:00.000Z"
}
```

### Endpoints

| Method | Path                    | Body                                  | Success                        | Errors |
| ------ | ----------------------- | ------------------------------------- | ------------------------------ | ------ |
| GET    | `/health`               | —                                     | `200 {"ok":true}`              | —      |
| GET    | `/api/events`           | —                                     | `200 [Event]`                  | —      |
| POST   | `/api/events`           | `{title, when, where, description?}`  | `201 Event`                    | `400`  |
| GET    | `/api/events/:id`       | —                                     | `200 Event`                    | `404`  |
| POST   | `/api/events/:id/rsvp`  | `{name}`                              | `200 {eventId, attendees}`     | `400`, `404` |

`title`, `when` (ISO date string) and `where` are required and must be
non-empty. RSVP is idempotent per name. Errors are `{"error":"message"}`.
