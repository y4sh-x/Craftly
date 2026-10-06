'use strict';

// Release: persistent software/runtime selection state. The servers table
// remains the source of truth for active settings; this table records the
// resolved catalog metadata and compatibility check so the UI can explain
// exactly what will be installed before a recreate/update.
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS server_software_state (
      server_id TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
      server_type TEXT NOT NULL,
      minecraft_version TEXT NOT NULL,
      loader TEXT,
      loader_version TEXT,
      java_tag TEXT NOT NULL,
      compatibility_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'ready',
      error TEXT,
      checked_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_server_software_loader
      ON server_software_state(loader, minecraft_version);
  `);
}

module.exports = { up };
