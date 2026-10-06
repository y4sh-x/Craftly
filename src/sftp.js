'use strict';

// Craftly SFTP bridge. This is a real SFTP server backed by Craftly's
// existing SQLite users/permissions and per-server data roots. It deliberately
// does not reuse Craftly's database or filesystem layout.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { Server } = require('ssh2');
const db = require('./db');
const config = require('./config');
const permissions = require('./services/permissions');
const { safeJoin, dataPath } = require('./storage/pathGuard');
const logger = require('./logger')('sftp');

const STATUS = { OK: 0, EOF: 1, NO_SUCH_FILE: 2, PERMISSION_DENIED: 3, FAILURE: 4, OP_UNSUPPORTED: 8 };
const FLAGS = { READ: 1, WRITE: 2, APPEND: 4, CREATE: 8, TRUNC: 16 };

function hostKeyPath() { return dataPath('.craftly-sftp-host-key'); }
function loadHostKey() {
  const file = hostKeyPath();
  try { return fs.readFileSync(file); } catch {}
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  fs.writeFileSync(file, privateKey, { mode: 0o600 });
  return privateKey;
}

function parseIdentity(raw) {
  const value = String(raw || '').trim();
  const at = value.lastIndexOf('@');
  if (at > 0) return { username: value.slice(0, at), serverId: value.slice(at + 1) };
  const dot = value.lastIndexOf('.');
  if (dot > 0) return { username: value.slice(0, dot), serverId: value.slice(dot + 1) };
  return { username: value, serverId: null };
}

function serverForUser(user, requestedId) {
  if (requestedId) {
    const server = db.get('SELECT * FROM servers WHERE id = ? AND deleted_at IS NULL', requestedId);
    if (!server) return null;
    const caps = permissions.effective(user, server.id);
    return caps.includes('view') ? { server, caps } : null;
  }
  const visible = [...permissions.visibleServerIds(user)];
  if (!visible.length) return null;
  const server = db.get(
    `SELECT * FROM servers WHERE deleted_at IS NULL AND id IN (${visible.map(() => '?').join(',')}) ORDER BY created_at LIMIT 1`,
    ...visible
  );
  if (!server) return null;
  return { server, caps: permissions.effective(user, server.id) };
}

function rootFor(server) { return dataPath('servers', server.id); }
function resolvePath(root, requested) {
  let clean = String(requested || '/').replace(/\\/g, '/');
  if (!clean.startsWith('/')) clean = '/' + clean;
  return safeJoin(root, '.' + clean);
}

function attrs(stat) {
  return {
    mode: stat.mode,
    uid: stat.uid || 0,
    gid: stat.gid || 0,
    size: stat.size,
    atime: Math.floor(stat.atimeMs / 1000),
    mtime: Math.floor(stat.mtimeMs / 1000),
  };
}

class CraftlySFTP {
  constructor() { this.server = null; }

  start() {
    if (!config.sftp.enabled) return null;
    if (this.server) return this.server;
    const hostKey = loadHostKey();
    this.server = new Server({ hostKeys: [hostKey], ident: 'Craftly SFTP' }, (client) => {
      let session = null;
      client.on('authentication', async (ctx) => {
        if (ctx.method !== 'password') return ctx.reject(['password']);
        try {
          const { username, serverId } = parseIdentity(ctx.username);
          const user = db.get('SELECT * FROM users WHERE username = ?', username);
          if (!user) return ctx.reject();
          if (!(await bcrypt.compare(ctx.password, user.password_hash))) return ctx.reject();
          const selected = serverForUser(user, serverId);
          if (!selected) return ctx.reject();
          session = { user, ...selected, root: rootFor(selected.server) };
          await fsp.mkdir(session.root, { recursive: true });
          ctx.accept();
        } catch (err) {
          logger.warn('SFTP authentication failed.', { err: err.message });
          ctx.reject();
        }
      });

      client.on('ready', () => {
        client.on('session', (accept) => {
          const sshSession = accept();
          sshSession.on('sftp', (acceptSftp) => this.attachSftp(acceptSftp(), session));
        });
      });
      client.on('error', (err) => logger.debug('SFTP client error.', { err: err.message }));
    });

    this.server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        // A failed bind must not leave a half-started Server object behind.
        // Otherwise a later restart sees `this.server` and incorrectly assumes
        // SFTP is healthy, or immediately races a closing socket.
        const failedServer = this.server;
        this.server = null;
        logger.error('Craftly SFTP port is already in use; the SFTP listener was not started.', { host: config.sftp.host, port: config.sftp.port });
        try { failedServer?.close?.(() => {}); } catch {}
        return;
      }
      logger.error('SFTP server error.', { err: err.message });
    });
    this.server.listen(config.sftp.port, config.sftp.host, () => {
      logger.info('Craftly SFTP is listening.', { host: config.sftp.host, port: config.sftp.port });
    });
    return this.server;
  }

  attachSftp(sftp, session) {
    const openFiles = new Map();
    const openDirs = new Map();
    let handleId = 0;
    const writable = session.caps.includes('files') && session.user.role !== 'viewer';
    const resolve = (p) => resolvePath(session.root, p);
    const denyWrite = (reqid) => sftp.status(reqid, STATUS.PERMISSION_DENIED);

    sftp.on('REALPATH', (id) => sftp.name(id, [{ filename: '/', longname: 'drwx------ 1 craftly craftly 4096 Jan 1 00:00 /', attrs: {} }]));
    sftp.on('STAT', (id, p) => { let real; try { real=resolve(p); } catch { return sftp.status(id, STATUS.NO_SUCH_FILE); } fs.stat(real,(e,st)=>e?sftp.status(id,STATUS.NO_SUCH_FILE):sftp.attrs(id,attrs(st))); });
    sftp.on('LSTAT', (id, p) => { let real; try { real=resolve(p); } catch { return sftp.status(id, STATUS.NO_SUCH_FILE); } fs.lstat(real,(e,st)=>e?sftp.status(id,STATUS.NO_SUCH_FILE):sftp.attrs(id,attrs(st))); });
    sftp.on('OPENDIR', (id,p) => { let real; try { real=resolve(p); } catch { return sftp.status(id,STATUS.NO_SUCH_FILE); } fs.readdir(real,(e,files)=>{ if(e)return sftp.status(id,STATUS.NO_SUCH_FILE); const h=Buffer.from(`d-${++handleId}`); openDirs.set(h.toString(),{real,files,index:0}); sftp.handle(id,h); }); });
    sftp.on('READDIR', (id,h) => { const d=openDirs.get(h.toString()); if(!d)return sftp.status(id,STATUS.FAILURE); if(d.index>=d.files.length){openDirs.delete(h.toString());return sftp.status(id,STATUS.EOF);} const chunk=d.files.slice(d.index,d.index+40); d.index+=chunk.length; const list=[]; for(const name of chunk){try{const st=fs.statSync(path.join(d.real,name));list.push({filename:name,longname:`${st.isDirectory()?'d':'-'}rw-r--r-- 1 craftly craftly ${st.size} ${st.mtime.toDateString()} ${name}`,attrs:attrs(st)});}catch{}} sftp.name(id,list); });
    sftp.on('OPEN', (id,p,flags) => { let real; try { real=resolve(p); } catch { return sftp.status(id,STATUS.PERMISSION_DENIED); } const write=(flags&FLAGS.WRITE)!==0; if(write&&!writable)return denyWrite(id); let mode='r'; if(write) mode=(flags&FLAGS.CREATE)?((flags&FLAGS.TRUNC)?'w+':'a+'): 'r+'; fs.open(real,mode,(e,fd)=>{if(e)return sftp.status(id,STATUS.FAILURE);const h=Buffer.from(`f-${++handleId}`);openFiles.set(h.toString(),fd);sftp.handle(id,h);}); });
    sftp.on('READ', (id,h,offset,length) => { const fd=openFiles.get(h.toString()); if(fd===undefined)return sftp.status(id,STATUS.FAILURE); const buf=Buffer.alloc(length); fs.read(fd,buf,0,length,offset,(e,n)=>{if(e)return sftp.status(id,STATUS.FAILURE);if(!n)return sftp.status(id,STATUS.EOF);sftp.data(id,buf.subarray(0,n));}); });
    sftp.on('WRITE', (id,h,offset,data) => { if(!writable)return denyWrite(id); const fd=openFiles.get(h.toString()); if(fd===undefined)return sftp.status(id,STATUS.FAILURE); fs.write(fd,data,0,data.length,offset,(e)=>e?sftp.status(id,STATUS.FAILURE):sftp.status(id,STATUS.OK)); });
    sftp.on('CLOSE', (id,h) => { const key=h.toString(); const fd=openFiles.get(key); if(fd!==undefined){fs.close(fd,()=>{});openFiles.delete(key);} openDirs.delete(key); sftp.status(id,STATUS.OK); });
    sftp.on('REMOVE', (id,p) => { if(!writable)return denyWrite(id); let real;try{real=resolve(p);}catch{return denyWrite(id);} fs.unlink(real,e=>e?sftp.status(id,STATUS.FAILURE):sftp.status(id,STATUS.OK)); });
    sftp.on('MKDIR', (id,p) => { if(!writable)return denyWrite(id); let real;try{real=resolve(p);}catch{return denyWrite(id);} fs.mkdir(real,{recursive:false},e=>e?sftp.status(id,STATUS.FAILURE):sftp.status(id,STATUS.OK)); });
    sftp.on('RMDIR', (id,p) => { if(!writable)return denyWrite(id); let real;try{real=resolve(p);}catch{return denyWrite(id);} fs.rmdir(real,e=>e?sftp.status(id,STATUS.FAILURE):sftp.status(id,STATUS.OK)); });
    sftp.on('RENAME', (id,a,b) => { if(!writable)return denyWrite(id); let ra,rb;try{ra=resolve(a);rb=resolve(b);}catch{return denyWrite(id);} fs.rename(ra,rb,e=>e?sftp.status(id,STATUS.FAILURE):sftp.status(id,STATUS.OK)); });
    sftp.on('SETSTAT', (id,p,st) => { if(!writable)return denyWrite(id); let real;try{real=resolve(p);}catch{return denyWrite(id);} const done=e=>e?sftp.status(id,STATUS.FAILURE):sftp.status(id,STATUS.OK); if(st.mode!==undefined) return fs.chmod(real,st.mode,done); if(st.mtime!==undefined||st.atime!==undefined) return fs.utimes(real,st.atime||Date.now()/1000,st.mtime||Date.now()/1000,done); done(); });
    sftp.on('FSETSTAT', (id,h,st) => { if(!writable)return denyWrite(id); const fd=openFiles.get(h.toString()); if(fd===undefined)return sftp.status(id,STATUS.FAILURE); if(st.mode!==undefined)return fs.fchmod(fd,st.mode,e=>e?sftp.status(id,STATUS.FAILURE):sftp.status(id,STATUS.OK)); sftp.status(id,STATUS.OK); });
  }

  close() {
    return new Promise((resolve) => {
      if (!this.server) return resolve(undefined);
      const server = this.server;
      this.server = null;
      server.close(() => resolve(undefined));
    });
  }
}

module.exports = new CraftlySFTP();
