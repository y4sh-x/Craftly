# Craftly Release — Security & Access

Release adds real security administration on top of the existing authentication,
per-server authorization and API-token systems.

## Included

- Reusable server permission profiles (built-in viewer/operator/manager plus custom profiles).
- Profile assignment to a user/server pair, materialized through the existing permission engine.
- Profile CRUD with validation and audit events.
- Session inventory and targeted session revocation.
- "Revoke other sessions" operation.
- Login session metadata (creation time, IP and user-agent) for security review.
- Security posture endpoint.
- Persistent security audit metadata schema.
- API-token scope storage groundwork without pretending to support write endpoints that are not implemented.
- Existing rate-limit middleware remains authoritative.
- Existing 2FA, password lockout, token expiry and credential-session revocation remain intact.

## APIs

- `GET /api/security/posture`
- `GET /api/security/profiles`
- `POST /api/security/profiles`
- `PATCH /api/security/profiles/:id`
- `DELETE /api/security/profiles/:id`
- `POST /api/security/profile-assignments`
- `DELETE /api/security/profile-assignments/:userId/:serverId`
- `GET /api/security/sessions?userId=...`
- `DELETE /api/security/sessions/:sid`
- `POST /api/security/sessions/revoke-others`

All security endpoints are admin-only.

## Testing

Run:

```bash
bash test/security-smoke.sh
```

A live end-to-end security test still requires the project's supported Node/dependency environment.
