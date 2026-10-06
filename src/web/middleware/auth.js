'use strict';

// Authentication, authorization, CSRF/origin protection and login lockouts.
// Route handlers live in web/routes/auth.js; this module intentionally contains
// middleware only so route imports cannot create a circular self-import.

const config = require('../../config');
const authService = require('../../services/auth');
const httpError = require('../../utils/httpError');

const IP_FAILURE_LIMIT = 8;
const IP_LOCK_MS = 10 * 60 * 1000;
const GLOBAL_FAILURE_LIMIT = 100;
const GLOBAL_WINDOW_MS = 5 * 60 * 1000;

// username -> { count, firstAt, lastAt }
const globalFailures = new Map();
// username\u0000ip -> { count, firstAt, lastAt, lockedUntil }
const ipFailures = new Map();

function now() {
  return Date.now();
}

function keyFor(username, ip) {
  return `${String(username || '').toLowerCase()}\u0000${String(ip || '')}`;
}

function cleanFailureState(username, ip, timestamp = now()) {
  const u = String(username || '').toLowerCase();
  const g = globalFailures.get(u);
  if (g && timestamp - g.lastAt >= GLOBAL_WINDOW_MS) globalFailures.delete(u);

  const k = keyFor(u, ip);
  const p = ipFailures.get(k);
  if (p && p.lockedUntil && timestamp >= p.lockedUntil) ipFailures.delete(k);
}

function checkLoginAllowed(username, ip) {
  const timestamp = now();
  const u = String(username || '').toLowerCase();
  cleanFailureState(u, ip, timestamp);

  const p = ipFailures.get(keyFor(u, ip));
  if (p && p.lockedUntil && timestamp < p.lockedUntil) {
    const err = httpError(429, 'Too many failed login attempts. Please wait a few minutes and try again.');
    /** @type {Error & { status?: number, lockScope?: string }} */
    const typedErr = err;
    typedErr.lockScope = 'ip';
    throw typedErr;
  }

  const g = globalFailures.get(u);
  if (g && timestamp - g.lastAt < GLOBAL_WINDOW_MS && g.count >= GLOBAL_FAILURE_LIMIT) {
    const err = httpError(429, 'This account is temporarily locked because of repeated failed login attempts.');
    /** @type {Error & { status?: number, lockScope?: string }} */
    const typedErr = err;
    typedErr.lockScope = 'account';
    throw typedErr;
  }
}

function recordLoginFailure(username, ip) {
  const timestamp = now();
  const u = String(username || '').toLowerCase();
  cleanFailureState(u, ip, timestamp);

  const k = keyFor(u, ip);
  let p = ipFailures.get(k);
  if (!p) p = { count: 0, firstAt: timestamp, lastAt: timestamp, lockedUntil: 0 };
  p.count += 1;
  p.lastAt = timestamp;
  let lockedNow = false;
  if (p.count >= IP_FAILURE_LIMIT && !p.lockedUntil) {
    p.lockedUntil = timestamp + IP_LOCK_MS;
    lockedNow = true;
  }
  ipFailures.set(k, p);

  let g = globalFailures.get(u);
  if (!g || timestamp - g.lastAt >= GLOBAL_WINDOW_MS) {
    g = { count: 0, firstAt: timestamp, lastAt: timestamp };
  }
  g.count += 1;
  g.lastAt = timestamp;
  globalFailures.set(u, g);
  if (g.count >= GLOBAL_FAILURE_LIMIT) {
    // Global locking is represented by the count + rolling five-minute window.
    // No separate permanent lock is needed; inactivity naturally clears it.
    lockedNow = lockedNow || g.count === GLOBAL_FAILURE_LIMIT;
    if (!lockedNow && g.count > GLOBAL_FAILURE_LIMIT) lockedNow = false;
  }

  return {
    lockedNow,
    scope: p.lockedUntil ? 'ip' : g.count >= GLOBAL_FAILURE_LIMIT ? 'account' : null,
  };
}

function clearLoginFailures(username, ip) {
  const u = String(username || '').toLowerCase();
  globalFailures.delete(u);
  if (ip !== undefined && ip !== null) ipFailures.delete(keyFor(u, ip));
  else {
    for (const key of ipFailures.keys()) if (key.startsWith(`${u}\u0000`)) ipFailures.delete(key);
  }
}

function listActiveLockouts() {
  const timestamp = now();
  const result = [];
  for (const [key, state] of ipFailures.entries()) {
    if (!state.lockedUntil || timestamp >= state.lockedUntil) {
      if (timestamp >= state.lockedUntil) ipFailures.delete(key);
      continue;
    }
    const [username, ip] = key.split('\u0000');
    result.push({
      username,
      ip,
      scope: 'ip',
      minutesLeft: Math.max(0.01, (state.lockedUntil - timestamp) / 60000),
    });
  }
  for (const [username, state] of globalFailures.entries()) {
    if (state.count < GLOBAL_FAILURE_LIMIT || timestamp - state.lastAt >= GLOBAL_WINDOW_MS) {
      if (timestamp - state.lastAt >= GLOBAL_WINDOW_MS) globalFailures.delete(username);
      continue;
    }
    result.push({
      username,
      ip: null,
      scope: 'account',
      minutesLeft: Math.max(0.01, (GLOBAL_WINDOW_MS - (timestamp - state.lastAt)) / 60000),
    });
  }
  return result;
}

/**
 * @param {{username?: string, ip?: string, all?: boolean}} options
 */
function clearLockouts({ username, ip, all = false } = {}) {
  if (all) {
    const count = ipFailures.size + globalFailures.size;
    ipFailures.clear();
    globalFailures.clear();
    return count;
  }

  let removed = 0;
  const u = username ? String(username).toLowerCase() : null;
  if (u) {
    if (globalFailures.delete(u)) removed += 1;
    if (ip !== undefined && ip !== null) {
      if (ipFailures.delete(keyFor(u, ip))) removed += 1;
    } else {
      for (const key of [...ipFailures.keys()]) {
        if (key.startsWith(`${u}\u0000`)) {
          ipFailures.delete(key);
          removed += 1;
        }
      }
    }
  } else if (ip !== undefined && ip !== null) {
    for (const key of [...ipFailures.keys()]) {
      if (key.endsWith(`\u0000${ip}`)) {
        ipFailures.delete(key);
        removed += 1;
      }
    }
  }
  return removed;
}

function isApiRequest(req) {
  return String(req.path || req.originalUrl || '').startsWith('/api') ||
    String(req.headers?.accept || '').includes('application/json');
}

function requireAuth(req, res, next) {
  const userId = req.session && req.session.userId;
  if (!userId) {
    if (isApiRequest(req)) return res.status(401).json({ ok: false, error: 'Authentication required.' });
    return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl || '/')}`);
  }

  const user = authService.getUser(userId);
  if (!user) {
    if (req.session) req.session.destroy(() => {});
    if (isApiRequest(req)) return res.status(401).json({ ok: false, error: 'Your session is no longer valid.' });
    return res.redirect('/login');
  }

  req.user = user;
  next();
}

function roleMatches(user, allowed) {
  const roles = Array.isArray(allowed) ? allowed : [allowed];
  return roles.includes(user && user.role);
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (roleMatches(req.user, roles)) return next();
    const message = `This action requires one of these roles: ${roles.join(', ')}.`;
    if (isApiRequest(req)) return res.status(req.user ? 403 : 401).json({ ok: false, error: message });
    return res.status(req.user ? 403 : 401).render('error', {
      title: req.user ? 'Forbidden' : 'Authentication required',
      code: req.user ? 403 : 401,
      message,
    });
  };
}

function requireWrite(req, res, next) {
  if (!req.user || req.user.role !== 'viewer') return next();
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const message = 'Your role (Viewer) is read-only.';
  if (isApiRequest(req)) return res.status(403).json({ ok: false, error: message });
  return res.status(403).render('error', { title: 'Forbidden', code: 403, message });
}


function originHost(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    return url.host;
  } catch {
    return null;
  }
}

function allowedHost(req) {
  return String(req.headers?.['x-forwarded-host'] || req.headers?.host || '').split(',')[0].trim();
}

function sameOrigin(req, value) {
  const sourceHost = originHost(value);
  const targetHost = allowedHost(req);
  return Boolean(sourceHost && targetHost && sourceHost === targetHost);
}

function rejectCrossSite(res, message = 'Cross-site request rejected.') {
  return res.status(403).json({ ok: false, error: message });
}

function originGuard(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();

  const origin = req.headers?.origin;
  const referer = req.headers?.referer;
  const supplied = origin || referer;

  if (supplied && !sameOrigin(req, supplied)) return rejectCrossSite(res);

  // SameSite=None provides no browser CSRF protection. Require an explicit
  // same-origin Origin/Referer for state-changing requests in that mode.
  if (config.cookieSameSite === 'none' && !supplied) return rejectCrossSite(res);
  next();
}

function rejectCrossSiteGet(req, res, next) {
  const supplied = req.headers?.origin || req.headers?.referer;
  if (supplied && !sameOrigin(req, supplied)) return rejectCrossSite(res);
  next();
}

module.exports = {
  requireAuth,
  requireRole,
  requireWrite,
  originGuard,
  rejectCrossSiteGet,
  checkLoginAllowed,
  recordLoginFailure,
  clearLoginFailures,
  listActiveLockouts,
  clearLockouts,
  originHost,
  sameOrigin,
};
