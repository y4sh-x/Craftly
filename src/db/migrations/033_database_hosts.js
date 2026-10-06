'use strict';

/** Release: real database-host provisioning metadata. */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS database_hosts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      engine TEXT NOT NULL CHECK (engine IN ('mariadb','mysql','postgres')),
      node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
      container_id TEXT,
      image TEXT NOT NULL,
      host TEXT NOT NULL DEFAULT '127.0.0.1',
      port INTEGER NOT NULL,
      admin_username TEXT NOT NULL,
      admin_password TEXT NOT NULL,
      max_databases INTEGER NOT NULL DEFAULT 100,
      status TEXT NOT NULL DEFAULT 'provisioning' CHECK (status IN ('provisioning','ready','offline','error','deleting')),
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_database_hosts_node ON database_hosts(node_id);
    CREATE INDEX IF NOT EXISTS idx_database_hosts_status ON database_hosts(status);

    CREATE TABLE IF NOT EXISTS server_databases (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      host_id TEXT NOT NULL REFERENCES database_hosts(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      engine TEXT NOT NULL CHECK (engine IN ('mariadb','mysql','postgres')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(host_id, name),
      UNIQUE(host_id, username)
    );
    CREATE INDEX IF NOT EXISTS idx_server_databases_server ON server_databases(server_id);
    CREATE INDEX IF NOT EXISTS idx_server_databases_host ON server_databases(host_id);

    CREATE TABLE IF NOT EXISTS schedule_runs (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      status TEXT NOT NULL CHECK (status IN ('running','success','failed')),
      attempt INTEGER NOT NULL DEFAULT 1,
      error TEXT,
      details_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_schedule_runs_schedule ON schedule_runs(schedule_id, started_at DESC);
  `);
}

module.exports = { up };
