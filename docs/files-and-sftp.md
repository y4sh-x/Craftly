# Craftly Release — Files & SFTP

Release extends the Release Panel → Node Agent architecture with real remote server filesystem operations and remote SFTP.

## Remote files
- list/read/write/stat/search
- mkdir/rename/move/copy/remove
- streaming upload/download
- server-root path containment
- server permission gate remains in the Panel

## Remote SFTP
Remote nodes run an SFTP endpoint on `CRAFTLY_SFTP_PORT` (default `2022`). The Panel issues a short-lived, server-scoped signed credential. The node agent verifies the credential with the node secret and exposes only that server root.

The node secret is never sent to the browser.

## Testing
Run `bash test/files-sftp-smoke.sh`. A live remote-node/SFTP integration test requires a real Docker node with the Release agent running.
