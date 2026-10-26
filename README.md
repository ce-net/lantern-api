# lantern-api

Backend for Lantern, a neighbourhood events app. Plain Node, no dependencies.

```sh
npm start                 # listens on $PORT (default 8080)
npm test                  # node --test
PORT=18080 npm start      # local integration port
```

`EVENTS_FILE=/path/events.json` persists events across restarts. Without it,
events live in memory for the life of the process.

## API contract (agreed with lantern-web)

Base URL for local integration: `http://localhost:18080`. All responses are
JSON, with `access-control-allow-origin: *` so the static frontend can call it
from another origin.

Event:

```json
{
  "id": 3,
  "title": "Lantern launch",
  "when": "2026-12-01T18:00",
  "where": "Community hall",
  "description": "Bring a dish",
  "attendees": ["Ada"],
  "createdAt": "2026-10-26T20:30:00.000Z"
}
```

| Method | Path                    | Body                                  | Success                        | Errors |
| ------ | ----------------------- | ------------------------------------- | ------------------------------ | ------ |
| GET    | `/health`               | —                                     | `200 {"ok":true}`              | —      |
| GET    | `/api/events`           | —                                     | `200 [Event]`, sorted by `when`| —      |
| POST   | `/api/events`           | `{title, when, where, description?}`  | `201 Event` + `Location`       | `400`  |
| GET    | `/api/events/:id`       | —                                     | `200 Event`                    | `404`  |
| POST   | `/api/events/:id/rsvp`  | `{name}`                              | `200 {eventId, attendees}`     | `400`, `404` |

`title`, `when` (an ISO date or `datetime-local` string) and `where` are
required and non-empty. RSVP is idempotent per name. Errors are
`{"error":"message"}`. `GET /events` is kept as an alias of `GET /api/events`
for the original prototype.

## Frontend

`lantern-web` defaults to `http://localhost:18081`; point it at this API with
`?api=http://localhost:18080` (or set `localStorage["lantern.api"]`).
