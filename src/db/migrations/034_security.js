'use strict';

// Release: security, permission profiles, session management and API-scope metadata.
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS permission_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      description TEXT NOT NULL DEFAULT '',
      permissions_json TEXT NOT NULL DEFAULT '[]',
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_permission_profiles (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      profile_id TEXT NOT NULL REFERENCES permission_profiles(id) ON DELETE CASCADE,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, server_id)
    );
    CREATE INDEX IF NOT EXISTS idx_user_permission_profiles_profile
      ON user_permission_profiles(profile_id);

    CREATE TABLE IF NOT EXISTS security_audit_meta (
      event_id INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
      ip TEXT,
      user_agent TEXT,
      request_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_security_audit_ip ON security_audit_meta(ip);
    CREATE INDEX IF NOT EXISTS idx_security_audit_request ON security_audit_meta(request_id);

    CREATE TABLE IF NOT EXISTS api_token_scopes (
      token_id TEXT NOT NULL REFERENCES api_tokens(id) ON DELETE CASCADE,
      scope TEXT NOT NULL,
      PRIMARY KEY (token_id, scope)
    );
  `);

  const defaults = [
    ['viewer', 'Read-only server access', ['view']],
    ['operator', 'Run and manage servers without destructive deletion', ['view','power','console','players','content','backups','files','settings']],
    ['manager', 'Full server management including deletion', ['view','power','console','players','content','backups','files','settings','delete']],
  ];
  for (const [name, description, permissions] of defaults) {
    const id = `profile_${name}`;
    db.run(
      `INSERT OR IGNORE INTO permission_profiles
       (id,name,description,permissions_json,created_by)
       VALUES (?,?,?,?,?)`,
      id, name, description, JSON.stringify(permissions), 'system'
    );
  }
}

module.exports = { up };
