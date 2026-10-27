# lantern-api

Backend for Lantern, a neighbourhood events app. Plain Node, no dependencies.
Started with `node server.js` (or `PORT=18080 node server.js`).

The API contract is frozen and posted in the Lantern group on ce-net. Summary:

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/health` | — | `{ok:true}` |
| GET | `/events` | — | `[{id,title,when,where,description,rsvpCount}]` |
| POST | `/events` | `{title,when,where,description?}` | `201` event; `400` bad input |
| GET | `/events/:id` | — | event; `404` if missing |
| POST | `/events/:id/rsvp` | `{name}` | `201 {id,eventId,name}`; increments `rsvpCount`; `404` if event missing |

Errors are `{error:"..."}` with the matching status. `when` is an ISO 8601
string, ids are integers. CORS is open (`*`, `GET,POST,OPTIONS`) so the
frontend can call it from anywhere.

Storage is in memory: the two seed events plus anything created since start.

## Test

```
npm test
```

## Frontend

The web client lives at https://github.com/ce-net/lantern-web and talks to
this API. Run it against `http://localhost:18080` in development.
