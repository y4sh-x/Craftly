'use strict';

const fs = require('node:fs');
const path = require('node:path');

function isLiveCraftlyProcess(pid, checkoutDir) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    if (process.platform !== 'linux') return true;

    // PID existence alone is unsafe in Codespaces/containers because PIDs are reused.
    const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ');
    const cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
    const sameCheckout = path.resolve(cwd) === path.resolve(checkoutDir);
    const isServerCommand = /(?:^|\s)(?:node|nodejs)(?:\s|$)/.test(cmdline)
      && /src[\\/]server\.js(?:\s|$)/.test(cmdline);
    return sameCheckout && isServerCommand;
  } catch (err) {
    if (err.code === 'ESRCH' || err.code === 'ENOENT') return false;
    throw err;
  }
}

function createInstanceLock({ dataDir, logger, checkoutDir = process.cwd() }) {
  const lockPath = path.join(dataDir, '.craftly-instance.lock');
  let fd = null;
  let released = false;

  function acquire() {
    try {
      fd = fs.openSync(lockPath, 'wx', 0o600);
      fs.writeFileSync(fd, `${process.pid}\n`, 'utf8');
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;

      let oldPid = 0;
      try {
        oldPid = Number(fs.readFileSync(lockPath, 'utf8').trim());
      } catch (readErr) {
        if (readErr.code !== 'ENOENT') throw readErr;
      }

      if (isLiveCraftlyProcess(oldPid, checkoutDir)) {
        logger?.warn('Craftly is already running; refusing to start a second instance.', { pid: oldPid });
        return false;
      }

      // The lock is stale: the recorded process is gone or belongs to another
      // process/checkout. Remove it and acquire a fresh lock.
      try { fs.unlinkSync(lockPath); } catch (unlinkErr) {
        if (unlinkErr.code !== 'ENOENT') throw unlinkErr;
      }
      fd = fs.openSync(lockPath, 'wx', 0o600);
      fs.writeFileSync(fd, `${process.pid}\n`, 'utf8');
      return true;
    }
  }

  function release() {
    if (released) return;
    released = true;
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
      fd = null;
    }
    try {
      // Only remove our lock. A replacement process may have acquired it after
      // an unusual shutdown, so verify the PID before unlinking.
      const currentPid = Number(fs.readFileSync(lockPath, 'utf8').trim());
      if (currentPid === process.pid) fs.unlinkSync(lockPath);
    } catch (err) {
      if (err.code !== 'ENOENT') logger?.debug?.('Could not release Craftly instance lock.', { err: { message: err.message } });
    }
  }

  return { acquire, release, lockPath };
}

module.exports = { createInstanceLock, isLiveCraftlyProcess };
