'use strict';

function up(db) {
  db.exec(`
    ALTER TABLE nodes ADD COLUMN data_root TEXT NOT NULL DEFAULT '/var/lib/craftly';
    ALTER TABLE nodes ADD COLUMN agent_version TEXT;
    ALTER TABLE nodes ADD COLUMN agent_token_cipher TEXT;
    ALTER TABLE nodes ADD COLUMN last_agent_at TEXT;

    ALTER TABLE servers ADD COLUMN provisioning_status TEXT NOT NULL DEFAULT 'ready'
      CHECK (provisioning_status IN ('pending','provisioning','ready','failed','deprovisioning'));
    ALTER TABLE servers ADD COLUMN provisioning_error TEXT;
    ALTER TABLE servers ADD COLUMN provisioning_started_at TEXT;
    ALTER TABLE servers ADD COLUMN provisioned_at TEXT;

    CREATE TABLE provisioning_jobs (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      operation TEXT NOT NULL CHECK (operation IN ('create','recreate','start','stop','kill','remove')),
      status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed')),
      attempt INTEGER NOT NULL DEFAULT 1,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      finished_at TEXT
    );
    CREATE INDEX idx_provisioning_jobs_server ON provisioning_jobs(server_id, created_at DESC);
    CREATE INDEX idx_provisioning_jobs_node ON provisioning_jobs(node_id, created_at DESC);
  `);
}

module.exports = { up };
