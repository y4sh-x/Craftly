# Craftly Development Notes

Craftly is maintained as one cumulative project tree. Features are implemented directly in the main source tree and validated with the shared test suite.

## Engineering areas

- Docker-only architecture and node management
- Server allocation and provisioning
- Server runtime, console and WebSocket events
- File management and SFTP
- Minecraft software, plugins, mods, modpacks and worlds
- Databases, backups and automation
- Users, permissions, API tokens and security
- Administration, monitoring, audit logging and integrations
- Installer, updater, recovery and production hardening

## Delivery rule

There is one canonical project tree. Release archives are complete snapshots and never require manually merging separate development archives.

## Testing rule

Each feature area has dedicated tests. The complete test suite remains part of every release, while environment-dependent checks are explicitly reported as skipped when their required Node, Docker, database, network or external service is unavailable.
