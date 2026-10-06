'use strict';

// Repair local-node rows created by releases that incorrectly stored daemon_port=0.
// The nodes schema requires a real TCP port even though the local node uses Docker
// directly and does not connect to a remote daemon endpoint.
function up(db) {
  db.run(
    "UPDATE nodes SET daemon_port=8080, updated_at=datetime('now') WHERE id='local' AND (daemon_port IS NULL OR daemon_port < 1 OR daemon_port > 65535)"
  );
}

module.exports = { up };
