# Craftly Release — Server Provisioning

Release introduces the real Docker provisioning layer used by Craftly nodes.

## Architecture

```text
Craftly Panel
   │ REST/WebSocket
   ├── PostgreSQL/SQLite metadata
   └── Node Transport
          │ authenticated bearer token
          ▼
Craftly Node Agent
          │
          ▼
     Docker Engine
          │
          └── craftly-<server-id>
```

Craftly remains **Docker-only**. KVM, QEMU and libvirt are not required.

## Local node

The panel can directly control the local Docker Engine.

## Remote node

Install/run `node-agent/agent.js` on the Docker host. Register the node in the
Craftly admin Nodes page, save the generated token, and configure:

- `CRAFTLY_NODE_ID`
- `CRAFTLY_NODE_TOKEN`
- `CRAFTLY_PANEL_URL`
- `CRAFTLY_NODE_PORT`
- `CRAFTLY_DATA_ROOT`

The agent sends authenticated heartbeats and exposes authenticated lifecycle
operations for create, recreate, start, stop, kill, remove and inspect.

Remote extra bind paths are restricted to the node's configured data root.

## Provisioning state

Each server tracks `pending`, `provisioning`, `ready`, `failed` and
`deprovisioning`. Every lifecycle provisioning operation is recorded in
`provisioning_jobs`, including failure text and timestamps.

## Release limitation

Remote file browsing/SFTP and remote log streaming are intentionally not faked
here. Those are integrated in the later file/SFTP and console services using the
same node-agent transport.
