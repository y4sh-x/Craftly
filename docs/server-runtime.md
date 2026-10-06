# Craftly Release — Server Runtime

Release extends the Docker-only Panel/Node architecture with real runtime access for local and remote nodes.

## Runtime features

- Live server resource statistics.
- Remote-node resource polling through the authenticated node agent.
- Recent container log retrieval on remote nodes.
- Remote RCON command execution for runtime probes.
- Remote console WebSocket streaming.
- Remote stats WebSocket streaming.
- Local runtime continues to use Docker directly.
- Panel WebSockets enforce the existing session, origin, and server permissions before connecting to a remote node.
- Node agents authenticate runtime WebSockets with the node bearer credential.
- Runtime command input is bounded before reaching Docker.
- Remote runtime failures degrade to errors instead of silently reporting healthy data.

## Runtime flow

Browser -> Craftly Panel WebSocket -> authenticated Craftly Node Agent -> Docker container

The browser never receives the node credential.

## Test limitations

A complete live remote-node test requires a second Docker host running the Release node agent. Static/syntax checks and isolated service tests can run without that host; such checks must not be represented as a live multi-node deployment test.
