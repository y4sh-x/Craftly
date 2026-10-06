# ⛏️ Craftly

<p align="center">

![Craftly](https://img.shields.io/badge/Craftly-Minecraft%20Server%20Panel-5865F2?style=for-the-badge&logo=minecraft&logoColor=white)

![Version](https://img.shields.io/badge/version-v1.1.0-00C853?style=for-the-badge)

![Status](https://img.shields.io/badge/status-v1%20Release-00C853?style=for-the-badge)

![Platform](https://img.shields.io/badge/platform-Linux-111827?style=for-the-badge&logo=linux&logoColor=white)

![Docker](https://img.shields.io/badge/Docker-Supported-2496ED?style=for-the-badge&logo=docker&logoColor=white)

![Node.js](https://img.shields.io/badge/Node.js-Supported-339933?style=for-the-badge&logo=node.js&logoColor=white)

</p>

<p align="center">

### 🚀 A modern all-in-one Minecraft server management platform

**Powerful server management. Clean interface. Serious control.**

</p>

---

## 🌌 About Craftly

**Craftly** is a modern Minecraft server management platform designed to bring server administration, server control, file management, monitoring, configuration and infrastructure tools together in one place.

The goal is simple:

> **Run your Minecraft infrastructure from one powerful control panel.**

Craftly is designed for:

- 🟢 Minecraft server owners
- 🟢 Hosting providers
- 🟢 Network administrators
- 🟢 Developers
- 🟢 Communities
- 🟢 Self-hosted infrastructure
- 🟢 Multi-server environments

---

# ✨ Features

## 🖥️ Server Management

Manage your Minecraft servers from a centralized interface.

- ▶️ Start
- ⏹️ Stop
- 🔄 Restart
- 🛑 Kill
- 📊 Resource monitoring
- 🟢 Server status
- 🌐 Server information
- ⚙️ Server configuration
- 🧩 Startup configuration
- 💾 Storage information

---

## 🖥️ Live Console

Monitor and control your server in real time.

Features include:

- 📡 Live console output
- ⌨️ Command execution
- 🔄 Automatic updates
- 🧹 Console controls
- 📜 Server logs
- ⚡ Fast interaction

---

## 📁 File Manager

Manage server files directly from the panel.

- 📂 Browse directories
- 📝 Edit files
- 📤 Upload
- 📥 Download
- 🗑️ Delete
- 📋 Rename
- 📁 Create directories
- 🔍 File navigation
- 💾 Save changes

---

## 🔐 SFTP

Craftly supports server file access through SFTP.

Use it with:

```text
Host: YOUR_SERVER_IP
Port: 2022
Username: YOUR_CRAFTLY_USER

## Release — Allocations

Craftly now includes a persistent allocation registry tied to Docker nodes. Administrators can create TCP/UDP/both allocations, assign them to servers, release them, and delete only unassigned allocations. Allocation identity is unique per node/IP/port/protocol and server/node relationships are persisted in the panel database.

## Release — Docker provisioning

Craftly now has a real Docker-only provisioning layer with local and remote node execution. Remote nodes run `node-agent/agent.js`, authenticate with per-node credentials, send heartbeats, and can create/recreate/start/stop/kill/remove/inspect Craftly containers. Provisioning operations are persisted as jobs and server provisioning state is tracked. Remote file/SFTP operations are intentionally deferred to the later file/console phases rather than represented by dummy endpoints.
