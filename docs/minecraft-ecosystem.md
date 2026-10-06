# Craftly Release — Minecraft Ecosystem

Release adds a real software/runtime catalog on top of releases.

## Included

- Live Mojang Minecraft version manifest with SQLite caching.
- Paper, Fabric, Forge, NeoForge and Quilt build discovery through the existing registry clients.
- Java compatibility matrix and explicit Java runtime choices.
- Unified content-source metadata for mods, plugins, datapacks, resourcepacks and modpacks.
- Server software inspection endpoint.
- Server software resolution endpoint that can persist Minecraft/Java/loader-build selections and optionally recreate the Docker container.
- Persistent software state for auditability and compatibility UI.
- Existing Modrinth, CurseForge, Hangar and Spiget integrations remain the actual content backends.

## API

- `GET /api/software/catalog`
- `GET /api/software/versions`
- `GET /api/software/builds?type=PAPER&mcVersion=1.21.1`
- `GET /api/software/java?type=PAPER&mcVersion=1.21.1`
- `GET /api/software/compatibility?type=FABRIC&mcVersion=1.21.1`
- `GET /api/servers/:id/software`
- `POST /api/servers/:id/software/resolve`

The resolve endpoint defaults to a dry-run. Set `apply: true` to persist the selection. Set `recreate: true` as well when the Docker container should be rebuilt immediately.

## Safety

Craftly remains Docker-only. KVM/QEMU/libvirt are not part of this architecture.

The existing plugin/mod/modpack installers remain responsible for downloading actual content; Release does not create fake local catalogs or placeholder download URLs.
