# Craftly Node Agent — Release

Docker-only node agent for Craftly. It provisions and controls Craftly-managed containers and sends authenticated heartbeats to the panel.

## Run

```bash
export CRAFTLY_NODE_ID=node_xxx
export CRAFTLY_NODE_TOKEN=mfnode_xxx
export CRAFTLY_PANEL_URL=https://panel.example.com
export CRAFTLY_NODE_PORT=8080
export CRAFTLY_DATA_ROOT=/var/lib/craftly
node node-agent/agent.js
```

The node must have Docker Engine available and the selected TCP daemon port reachable from the panel.

Remote extra bind paths are intentionally restricted to `CRAFTLY_DATA_ROOT` to prevent a compromised panel request from mounting arbitrary host paths.
