# Craftly Release — Production Operations

Release adds a real administrative operations/health surface to the cumulative Craftly panel.

## Added

- Docker daemon health/version/capacity reporting
- Panel database integrity check using SQLite `PRAGMA quick_check`
- Storage free-space measurement from the real data filesystem
- Enabled node online/degraded/offline counts
- Provisioning queue counts and recent jobs
- Process/runtime diagnostics
- Admin-only operations API
- Explicit maintenance action for stale-node marking
- Audit event for maintenance runs

## API

- `GET /api/operations/health`
- `POST /api/operations/maintenance`

Both endpoints require an authenticated administrator.

## Accuracy rule

The health endpoint reports unavailable dependencies as failed/degraded. It does not convert missing Docker, storage failures, database errors, or offline nodes into a fake green state.
