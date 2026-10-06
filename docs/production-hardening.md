# Craftly Release — Final Production Hardening

Release is the final cumulative hardening and release gate for the Craftly panel.

## Release gates

- All project JavaScript/MJS under `src/`, `scripts/`, and `node-agent/` must pass `node --check`.
- `menu.sh` and all test shell scripts must pass `bash -n`.
- Required project metadata must be present and consistent.
- Craftly branding must be present in product metadata.
- Legacy product branding must not occur in application/source content.
- No KVM/QEMU/libvirt runtime dependency is permitted.
- The cumulative phase test scripts are syntax-checked and runnable when their environment prerequisites exist.
- The final archive must contain the complete project and must not contain generated dependency directories such as `node_modules`.

## Environment-dependent checks

A full integration run requires Node.js 24+, project dependencies, Docker, and any configured database/network services. Cloudflare and remote-node tests additionally require real credentials and a reachable node. Missing infrastructure is reported as unavailable rather than converted into a false PASS.

## Docker-only policy

Craftly uses Docker for hosted server isolation and lifecycle management. KVM, QEMU, and libvirt are not required by the project.
