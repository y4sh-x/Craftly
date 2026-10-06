# Craftly Release — Production integrations

Release adds an optional real Cloudflare integration without making Cloudflare a hard dependency.

## Cloudflare
Set `CF_API_TOKEN` and `CF_ZONE_ID` to enable DNS API operations. Optional `CF_ZONE_NAME` and `CF_TUNNEL_NAME` are metadata.

Admin endpoints:
- `GET /api/cloudflare/status`
- `GET /api/cloudflare/zones`
- `GET /api/cloudflare/records`
- `POST /api/cloudflare/records`
- `DELETE /api/cloudflare/records/:id?zoneId=...`
- `POST /api/cloudflare/tunnel/config`

The tunnel endpoint generates a least-privilege local `cloudflared` ingress config; it does not invent a tunnel ID or credentials. The actual Cloudflare account remains authoritative.

## Docker-only
No KVM, libvirt, QEMU, or VM dependency is introduced.
