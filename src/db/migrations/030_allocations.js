'use strict';

function up(db) {
  db.exec(`
    CREATE TABLE allocations (
      id TEXT PRIMARY KEY,
      node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      ip TEXT NOT NULL DEFAULT '0.0.0.0',
      port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
      protocol TEXT NOT NULL DEFAULT 'tcp' CHECK (protocol IN ('tcp','udp','both')),
      alias TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      server_id TEXT REFERENCES servers(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(node_id, ip, port, protocol)
    );
    CREATE INDEX idx_allocations_node ON allocations(node_id);
    CREATE INDEX idx_allocations_server ON allocations(server_id);
    CREATE INDEX idx_allocations_free ON allocations(node_id, server_id);
  `);

  db.exec(`ALTER TABLE servers ADD COLUMN node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL`);
  db.exec(`ALTER TABLE servers ADD COLUMN allocation_id TEXT REFERENCES allocations(id) ON DELETE SET NULL`);
  db.exec(`CREATE INDEX idx_servers_node ON servers(node_id)`);
  db.exec(`CREATE INDEX idx_servers_allocation ON servers(allocation_id)`);
}

module.exports = { up };
