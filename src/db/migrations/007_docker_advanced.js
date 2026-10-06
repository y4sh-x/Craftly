'use strict';

// Advanced Docker settings: custom container name, a non-default Docker
// network to attach to, and extra port/volume mappings beyond the built-in
// game/rcon/bedrock ports and the single /data bind. NULL/'[]' = use the
// panel's default behavior (craftly-<id> name, bridge network, no extras).

function up(db) {
  db.exec(`
    ALTER TABLE servers ADD COLUMN container_name TEXT;
    ALTER TABLE servers ADD COLUMN network_name TEXT;
    ALTER TABLE servers ADD COLUMN extra_ports_json TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE servers ADD COLUMN extra_binds_json TEXT NOT NULL DEFAULT '[]';
  `);
}

module.exports = { up };
