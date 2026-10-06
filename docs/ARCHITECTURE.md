# Craftly Architecture — Release

Craftly is being evolved into a Docker-only, Pterodactyl-class Minecraft/server management panel.

## Runtime layers

```text
Browser / API clients
        │
        ▼
Craftly Panel
  ├─ Web UI
  ├─ REST API
  ├─ WebSocket console/events
  ├─ Authentication / authorization
  ├─ PostgreSQL-ready persistence boundary
  └─ Node orchestration
        │
        ▼
Craftly Node
  ├─ Docker lifecycle
  ├─ Resource limits
  ├─ Files / archives
  ├─ Console / logs
  ├─ SFTP
  ├─ Backups
  └─ Server health
        │
        ▼
Docker Engine
  └─ Minecraft/server containers
```

## Release decisions

- **Container runtime:** Docker only.
- **KVM/libvirt/VM orchestration:** out of scope and must not become a runtime dependency.
- **Panel default HTTP port:** `6060`.
- **SFTP default port:** `2022`.
- **Default Minecraft allocation start:** `25565`.
- **Default Bedrock allocation start:** `19132`.
- **Current project database:** SQLite remains the existing persistence implementation during the migration path; later development must introduce a PostgreSQL-compatible persistence layer without silently breaking existing installations.
- **Existing working services:** preserved unless replaced by a verified equivalent.
- **Feature rule:** a UI entry is not considered implemented until its backend/service path exists and it can be exercised by tests or an explicitly documented environment-dependent integration test.

## Node boundary

The panel must treat a node as a managed Docker execution target. Future node work will introduce:

1. Node identity and registration.
2. Authentication between Panel and Node.
3. Heartbeats and health state.
4. Allocations and port ownership.
5. Server provisioning through the node.
6. Resource enforcement at the Docker layer.

Release only establishes this contract. It does **not** add fake node controls.

## Data boundary

Persistent resources that will become first-class entities in later development:

- users
- roles / permissions
- nodes
- allocations
- servers
- server variables
- server databases
- backups
- schedules / tasks
- API tokens
- audit/activity events

The existing Craftly services remain the source of truth until each entity is migrated deliberately.

## Testing rule

Each feature area has dedicated tests for the architecture or functionality introduced by that phase. The release package contains the complete project and the complete accumulated test suite; no manual merging of source files is intended.
