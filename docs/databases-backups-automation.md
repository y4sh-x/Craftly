# Craftly Release — Databases, Backups & Automation

Release adds the database/automation layer on top of releases.

## Database hosts

Craftly can provision real Docker-backed database hosts using:

- MariaDB 11
- MySQL 8.4
- PostgreSQL 17

Database hosts are attached to Craftly nodes and have persistent lifecycle metadata.
Host credentials and server database passwords are encrypted at rest using Craftly's existing secret store.

Remote database-host provisioning is intentionally rejected until the node-agent exposes the corresponding database API; Craftly never pretends a remote host is local.

## Server databases

Administrators can create and delete databases assigned to a server. Credentials are generated server-side and the password is returned only by the creation operation. List endpoints never return passwords.

## Backups

Backups already support real archive creation, restore, retention and scheduled execution. Release additionally records a SHA-256 checksum for every newly-created backup so an operator can verify archive identity/integrity independently of the ZIP central-directory check.

## Automation

Scheduled task execution now records persistent run history with:

- start/finish time
- status
- attempt
- error
- duration metadata

The scheduler continues to use its existing non-overlap protection and configured timezone.

## Docker-only constraint

KVM/QEMU/libvirt are not required by Release. Database hosts and game servers are Docker workloads.
