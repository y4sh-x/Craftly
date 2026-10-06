'use strict';

// Release security service: custom server permission profiles, session
// inventory/revocation, and security posture reporting. This complements the
// existing global roles and per-server permission grants; it does not replace
// them or silently weaken admin checks.

const crypto = require('node:crypto');
const { nanoid } = require('nanoid');
const db = require('../db');
const httpError = require('../utils/httpError');
const permissions = require('./permissions');
const { recordEvent } = require('../events');

function normalizePermissions(list) {
  if (!Array.isArray(list)) throw httpError(400, 'permissions must be an array');
  const out = [...new Set(list.map(String))];
  for (const p of out) {
    if (!permissions.CAPABILITIES.includes(p)) throw httpError(400, `Unknown permission: ${p}`);
  }
  if (out.length && !out.includes('view')) out.unshift('view');
  return out;
}

function listProfiles() {
  return db.all('SELECT * FROM permission_profiles ORDER BY name').map((r) => ({
    id: r.id, name: r.name, description: r.description,
    permissions: JSON.parse(r.permissions_json || '[]'),
    createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
  }));
}

function getProfile(id) {
  return listProfiles().find((p) => p.id === id) || null;
}

function createProfile({ name, description = '', permissions: perms }, { actor }) {
  const clean = String(name || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]{1,47}$/.test(clean)) throw httpError(400, 'Invalid profile name');
  const normalized = normalizePermissions(perms);
  const id = `profile_${nanoid(10)}`;
  try {
    db.run(
      `INSERT INTO permission_profiles (id,name,description,permissions_json,created_by)
       VALUES (?,?,?,?,?)`, id, clean, String(description).slice(0,500), JSON.stringify(normalized), actor
    );
  } catch (e) {
    if (/UNIQUE/i.test(e.message || '')) throw httpError(409, 'A profile with that name already exists.');
    throw e;
  }
  recordEvent({ actor, type: 'permission-profile-created', summary: `Permission profile created: ${clean}.`, details: { profileId:id, permissions:normalized } });
  return getProfile(id);
}

/** @param {string} id @param {{name?: string, description?: string, permissions?: string[]}} changes @param {{actor: string}} meta */
function updateProfile(id, { name, description, permissions: perms }, { actor }) {
  const old = getProfile(id);
  if (!old) throw httpError(404, 'Permission profile not found');
  const clean = name === undefined ? old.name : String(name).trim();
  const normalized = perms === undefined ? old.permissions : normalizePermissions(perms);
  db.run(
    `UPDATE permission_profiles SET name=?, description=?, permissions_json=?, updated_at=datetime('now') WHERE id=?`,
    clean, description === undefined ? old.description : String(description).slice(0,500),
    JSON.stringify(normalized), id
  );
  recordEvent({ actor, type: 'permission-profile-updated', summary: `Permission profile updated: ${clean}.`, details:{profileId:id} });
  return getProfile(id);
}

function deleteProfile(id, { actor }) {
  const p = getProfile(id);
  if (!p) throw httpError(404, 'Permission profile not found');
  if (['profile_viewer','profile_operator','profile_manager'].includes(id)) throw httpError(409, 'Built-in profiles cannot be deleted.');
  db.run('DELETE FROM permission_profiles WHERE id=?', id);
  recordEvent({ actor, type:'permission-profile-deleted', summary:`Permission profile deleted: ${p.name}.`, details:{profileId:id} });
}

function assignProfile({ userId, serverId, profileId }, { actor }) {
  if (!db.get('SELECT id FROM users WHERE id=?', userId)) throw httpError(404, 'User not found');
  if (!db.get('SELECT id FROM servers WHERE id=? AND deleted_at IS NULL', serverId)) throw httpError(404, 'Server not found');
  if (!getProfile(profileId)) throw httpError(404, 'Permission profile not found');
  db.run(
    `INSERT INTO user_permission_profiles (user_id,server_id,profile_id,created_by)
     VALUES (?,?,?,?)
     ON CONFLICT(user_id,server_id) DO UPDATE SET profile_id=excluded.profile_id,created_by=excluded.created_by`,
    userId, serverId, profileId, actor
  );
  // Keep the existing permission engine as the source of truth by materializing
  // the profile into its existing per-server grant table.
  const profile = getProfile(profileId);
  const result = permissions.setGrant(userId, serverId, profile.permissions, { actor });
  recordEvent({ actor, type:'permission-profile-assigned', summary:`${profile.name} assigned to ${userId}.`, serverId, details:{userId,serverId,profileId} });
  return { profile, grant: result };
}

function unassignProfile(userId, serverId, { actor }) {
  db.run('DELETE FROM user_permission_profiles WHERE user_id=? AND server_id=?', userId, serverId);
  // Null restores the global role default in the existing permission engine.
  permissions.setGrant(userId, serverId, null, { actor });
  recordEvent({ actor, type:'permission-profile-unassigned', summary:`Custom permission profile removed from ${userId}.`, serverId, details:{userId,serverId} });
}

function assignments() {
  return db.all(`
    SELECT upp.user_id, u.username, upp.server_id, s.display_name AS server_name,
           upp.profile_id, pp.name AS profile_name, upp.created_at
    FROM user_permission_profiles upp
    JOIN users u ON u.id=upp.user_id
    JOIN servers s ON s.id=upp.server_id
    JOIN permission_profiles pp ON pp.id=upp.profile_id
    ORDER BY u.username, s.display_name
  `);
}

function listSessions(userId) {
  const rows = db.all(
    'SELECT sid,user_id,expires_at,data_json FROM sessions WHERE user_id=? ORDER BY expires_at DESC',
    userId
  );
  return rows.map((r) => {
    let data = {};
    try { data = JSON.parse(r.data_json || '{}'); } catch {}
    const cookie = data.cookie || {};
    return {
      id: r.sid,
      shortId: crypto.createHash('sha256').update(r.sid).digest('hex').slice(0, 12),
      userId: r.user_id,
      expiresAt: r.expires_at,
      createdAt: data.createdAt || null,
      lastAccess: data.lastAccess || null,
      userAgent: data.userAgent || null,
      ip: data.ip || null,
      current: false,
      cookieSecure: Boolean(cookie.secure),
    };
  });
}

function revokeSession(sid, { actor }) {
  const row = db.get('SELECT user_id FROM sessions WHERE sid=?', sid);
  if (!row) throw httpError(404, 'Session not found');
  db.run('DELETE FROM sessions WHERE sid=?', sid);
  recordEvent({ actor, type:'session-revoked', summary:'A login session was revoked.', details:{userId:row.user_id, session:crypto.createHash('sha256').update(sid).digest('hex').slice(0,12)} });
}

function revokeOtherSessions(userId, exceptSid, { actor }) {
  const rows = db.all('SELECT sid FROM sessions WHERE user_id=? AND sid != ?', userId, exceptSid || '');
  db.run('DELETE FROM sessions WHERE user_id=? AND sid != ?', userId, exceptSid || '');
  recordEvent({ actor, type:'sessions-revoked', summary:`Revoked ${rows.length} other login session(s).`, details:{userId,count:rows.length} });
  return rows.length;
}

function posture() {
  const users = db.get('SELECT COUNT(*) AS n FROM users').n;
  const admins = db.get("SELECT COUNT(*) AS n FROM users WHERE role='admin'").n;
  const sessions = db.get('SELECT COUNT(*) AS n FROM sessions WHERE expires_at > datetime(\'now\')').n;
  const profiles = db.get('SELECT COUNT(*) AS n FROM permission_profiles').n;
  const customAssignments = db.get('SELECT COUNT(*) AS n FROM user_permission_profiles').n;
  const totp = db.get('SELECT COUNT(*) AS n FROM users WHERE totp_enabled=1').n;
  return {
    users, admins, activeSessions:sessions, permissionProfiles:profiles,
    customPermissionAssignments:customAssignments, usersWith2FA:totp,
    twoFactorCoverage: users ? Math.round((totp / users) * 1000) / 10 : 0,
    publicApiTokens: db.get("SELECT COUNT(*) AS n FROM api_tokens WHERE revoked_at IS NULL").n,
  };
}

module.exports = {
  listProfiles, getProfile, createProfile, updateProfile, deleteProfile,
  assignProfile, unassignProfile, assignments, listSessions,
  revokeSession, revokeOtherSessions, posture, normalizePermissions,
};
