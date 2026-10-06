# Craftly Release — Nodes

Release introduces the persistent **Docker node registry**.

## What is real in this feature area

- A persistent `nodes` database table.
- A built-in `local` node representing the Docker Engine used by the panel host.
- Live local Docker health refreshes every 30 seconds.
- Remote node registration from the admin panel.
- Per-node authentication tokens.
- Tokens are stored as SHA-256 hashes and are shown only when created/rotated.
- Authenticated remote heartbeat endpoint.
- Docker health information from node heartbeats.
- Remote heartbeat staleness detection.
- Enable/disable controls.
- Token rotation.
- Node deletion (the built-in local node cannot be deleted).
- Admin UI and API endpoints.

## Node API

Admin browser/session API:

- `GET /api/nodes`
- `POST /api/nodes`
- `POST /api/nodes/:id/token`
- `POST /api/nodes/:id/enable`
- `POST /api/nodes/:id/disable`
- `DELETE /api/nodes/:id`

Remote node-agent API:

- `POST /api/node-agent/:id/heartbeat`

Remote heartbeats authenticate with:

```text
Authorization: Bearer <node-token>
```

The node token is intentionally separate from a user's Craftly session.

## Not claimed yet

Release does **not** pretend to provide complete remote server provisioning. The remote node identity and authenticated heartbeat channel are now real; server provisioning, allocations, and remote Docker orchestration are implemented in later development.
