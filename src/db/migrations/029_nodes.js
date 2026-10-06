'use strict';

function up(db) {
  db.exec(`
    CREATE TABLE nodes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      description TEXT NOT NULL DEFAULT '',
      fqdn TEXT NOT NULL,
      scheme TEXT NOT NULL DEFAULT 'https' CHECK (scheme IN ('http','https')),
      daemon_port INTEGER NOT NULL DEFAULT 8080 CHECK (daemon_port BETWEEN 1 AND 65535),
      sftp_port INTEGER NOT NULL DEFAULT 2022 CHECK (sftp_port BETWEEN 1 AND 65535),
      token_hash TEXT,
      token_prefix TEXT,
      mode TEXT NOT NULL DEFAULT 'remote' CHECK (mode IN ('local','remote')),
      enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online','offline','degraded','disabled')),
      last_seen_at TEXT,
      last_error TEXT,
      docker_version TEXT,
      docker_os TEXT,
      docker_cpus INTEGER,
      docker_memory_bytes INTEGER,
      docker_info_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_nodes_status ON nodes(status);
    CREATE INDEX idx_nodes_last_seen ON nodes(last_seen_at DESC);
  `);
}

module.exports = { up };
