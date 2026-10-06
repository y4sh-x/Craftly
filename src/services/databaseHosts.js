'use strict';

// Release: real Docker-backed database hosts. The panel never stores plaintext
// credentials in logs/events; they are required at runtime to provision DBs.
const crypto = require('node:crypto');
const db = require('../db');
const { getDocker } = require('../docker/connect');
const httpError = require('../utils/httpError');
const { nanoid } = require('nanoid');
const { recordEvent } = require('../events');
const secrets = require('./secrets');

const IMAGES = {
  mariadb: 'mariadb:11',
  mysql: 'mysql:8.4',
  postgres: 'postgres:17',
};
const DEFAULT_PORTS = { mariadb: 3306, mysql: 3306, postgres: 5432 };

function secret(bytes = 24) { return crypto.randomBytes(bytes).toString('base64url'); }
function normalizeEngine(engine) { return String(engine || '').toLowerCase() === 'mysql' ? 'mysql' : String(engine || '').toLowerCase(); }
function quoteIdent(engine, value) {
  const v = String(value || '');
  if (!/^[a-zA-Z0-9_]{1,63}$/.test(v)) throw httpError(400, 'Database names/usernames may contain only letters, numbers and underscores.');
  return engine === 'postgres' ? `"${v}"` : `\`${v}\``;
}
function hostRow(id) { return db.get('SELECT * FROM database_hosts WHERE id = ?', id); }
function listHosts() { return db.all('SELECT id,name,engine,node_id,container_id,host,port,max_databases,status,last_error,created_at,updated_at FROM database_hosts ORDER BY name'); }
function listServerDatabases(serverId) { return db.all('SELECT id,server_id,host_id,name,username,engine,created_at FROM server_databases WHERE server_id = ? ORDER BY name', serverId); }

async function waitReady(container, engine, timeoutMs = 90000) {
  const started = Date.now();
  const probe = engine === 'postgres'
    ? ['pg_isready', '-U', 'postgres']
    : ['sh', '-lc', 'mysqladmin ping -h 127.0.0.1 -uroot -p"$CRAFTLY_DB_ADMIN_PASSWORD" --silent'];
  while (Date.now() - started < timeoutMs) {
    try {
      const ex = await container.exec({ Cmd: probe, AttachStdout: true, AttachStderr: true });
      const stream = await ex.start({ hijack: true, stdin: false });
      await new Promise((resolve) => { stream.on('end', resolve); stream.on('error', resolve); setTimeout(resolve, 3000).unref(); });
      const info = await ex.inspect();
      if (info.ExitCode === 0) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

async function exec(container, command) {
  const ex = await container.exec({ Cmd: command, AttachStdout: true, AttachStderr: true });
  const stream = await ex.start({ hijack: true, stdin: false });
  const chunks = [];
  await new Promise((resolve, reject) => { const t=setTimeout(()=>reject(new Error('Database command timed out')),20000); stream.on('data',b=>chunks.push(b)); stream.on('end',()=>{clearTimeout(t);resolve();}); stream.on('error',e=>{clearTimeout(t);reject(e);}); });
  const out = Buffer.concat(chunks).toString('utf8');
  const info = await ex.inspect();
  if (info.ExitCode !== 0) throw new Error(out.slice(-2000) || `Database command exited with ${info.ExitCode}`);
  return out;
}

async function createHost({ name, engine, nodeId, port, maxDatabases = 100, actor = 'system' }) {
  engine = normalizeEngine(engine);
  if (!IMAGES[engine]) throw httpError(400, 'Unsupported database engine.');
  const node = db.get('SELECT * FROM nodes WHERE id = ?', nodeId);
  if (!node) throw httpError(404, 'Node not found');
  if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,50}$/.test(name)) throw httpError(400, 'Invalid database host name');
  if (db.get('SELECT 1 FROM database_hosts WHERE name = ?', name)) throw httpError(409, 'Database host already exists');
  const hostPort = Number(port || DEFAULT_PORTS[engine]);
  if (!Number.isInteger(hostPort) || hostPort < 1024 || hostPort > 65535) throw httpError(400, 'Invalid database host port');
  const adminUsername = engine === 'postgres' ? 'postgres' : 'root';
  const adminPassword = secret(30);
  const id = `dbhost_${nanoid(10)}`;
  const containerName = `craftly-db-${id}`;
  const env = engine === 'postgres'
    ? { POSTGRES_USER: adminUsername, POSTGRES_PASSWORD: adminPassword, POSTGRES_DB: 'craftly' }
    : { MARIADB_ROOT_PASSWORD: adminPassword, MYSQL_ROOT_PASSWORD: adminPassword, MARIADB_DATABASE: 'craftly', MYSQL_DATABASE: 'craftly', CRAFTLY_DB_ADMIN_PASSWORD: adminPassword };

  if (node.mode && node.mode !== 'local') throw httpError(501, 'Remote database-host provisioning requires the Release node-agent database API.');
  const docker = getDocker();
  const container = await docker.createContainer({
    name: containerName,
    Image: IMAGES[engine],
    Env: Object.entries(env).map(([k,v]) => `${k}=${v}`),
    Labels: { 'craftly.database-host': id, 'craftly.managed': 'true' },
    ExposedPorts: { [`${DEFAULT_PORTS[engine]}/tcp`]: {} },
    HostConfig: { PortBindings: { [`${DEFAULT_PORTS[engine]}/tcp`]: [{ HostPort: String(hostPort) }] }, RestartPolicy: { Name: 'unless-stopped' } },
  });
  db.run('INSERT INTO database_hosts (id,name,engine,node_id,container_id,port,admin_username,admin_password,max_databases,status) VALUES (?,?,?,?,?,?,?,?,?,?)', id,name,engine,nodeId,container.id,hostPort,adminUsername,secrets.encrypt(adminPassword),Math.max(1,Number(maxDatabases)||100),'provisioning');
  try {
    await container.start();
    const ready = await waitReady(container, engine);
    db.run('UPDATE database_hosts SET status=?,last_error=NULL,updated_at=datetime(\'now\') WHERE id=?', ready ? 'ready' : 'error', id);
    if (!ready) throw new Error('Database container did not become ready within 90 seconds');
    recordEvent({ actor, type:'database-host-created', summary:`Database host ${name} (${engine}) is ready.`, details:{id,engine,nodeId,port:hostPort} });
    return hostRow(id);
  } catch (err) {
    db.run('UPDATE database_hosts SET status=\'error\',last_error=?,updated_at=datetime(\'now\') WHERE id=?', err.message, id);
    try { await container.remove({force:true}); } catch {}
    throw err;
  }
}

async function createDatabase({ serverId, hostId, name, username, actor='system' }) {
  const server = db.get('SELECT id FROM servers WHERE id=? AND deleted_at IS NULL', serverId);
  if (!server) throw httpError(404,'Server not found');
  const host = hostRow(hostId); if (!host) throw httpError(404,'Database host not found');
  const count = db.get('SELECT COUNT(*) AS c FROM server_databases WHERE host_id=?',hostId).c;
  if (count >= host.max_databases) throw httpError(409,'Database host limit reached');
  const dbName = String(name||`craftly_${nanoid(6)}`).replace(/[^a-zA-Z0-9_]/g,'_').slice(0,63);
  const dbUser = String(username||`mf_${nanoid(8)}`).replace(/[^a-zA-Z0-9_]/g,'_').slice(0,63);
  const password = secret(24);
  const container = getDocker().getContainer(host.container_id);
  const adminPassword = secrets.tryDecrypt(host.admin_password) || host.admin_password;
  if (host.engine === 'postgres') {
    await exec(container,['psql','-U',host.admin_username,'-d','craftly','-c',`CREATE DATABASE ${quoteIdent('postgres',dbName)};`]);
    await exec(container,['psql','-U',host.admin_username,'-d','craftly','-c',`CREATE USER ${quoteIdent('postgres',dbUser)} WITH PASSWORD '${password.replace(/'/g,"''")}'; GRANT ALL PRIVILEGES ON DATABASE ${quoteIdent('postgres',dbName)} TO ${quoteIdent('postgres',dbUser)};`]);
  } else {
    const sql = `CREATE DATABASE ${dbName}; CREATE USER '${dbUser}'@'%' IDENTIFIED BY '${password.replace(/'/g, "''")}'; GRANT ALL PRIVILEGES ON ${dbName}.* TO '${dbUser}'@'%'; FLUSH PRIVILEGES;`;
    await exec(container, ['sh', '-lc', 'MYSQL_PWD=' + JSON.stringify(adminPassword) + ' mysql -uroot -e ' + JSON.stringify(sql)]);
  }
  const id=`sdb_${nanoid(10)}`;
  db.run('INSERT INTO server_databases (id,server_id,host_id,name,username,password,engine) VALUES (?,?,?,?,?,?,?)',id,serverId,hostId,dbName,dbUser,secrets.encrypt(password),host.engine);
  recordEvent({serverId,actor,type:'database-created',summary:`Database ${dbName} created on ${host.name}.`,details:{id,hostId,engine:host.engine}});
  return { ...db.get('SELECT id,server_id,host_id,name,username,engine,created_at FROM server_databases WHERE id=?',id), password };
}

async function deleteDatabase(id,{actor='system'}={}) {
  const row=db.get('SELECT d.*,h.name host_name,h.admin_username,h.admin_password,h.container_id FROM server_databases d JOIN database_hosts h ON h.id=d.host_id WHERE d.id=?',id);
  if(!row) throw httpError(404,'Database not found');
  const container=getDocker().getContainer(row.container_id);
  const adminPassword = secrets.tryDecrypt(row.admin_password) || row.admin_password;
  if(row.engine==='postgres') await exec(container,['psql','-U',row.admin_username,'-d','craftly','-c',`DROP DATABASE IF EXISTS ${quoteIdent('postgres',row.name)}; DROP ROLE IF EXISTS ${quoteIdent('postgres',row.username)};`]);
  else { const sql = `DROP DATABASE IF EXISTS ${row.name}; DROP USER IF EXISTS '${row.username}'@'%'; FLUSH PRIVILEGES;`; await exec(container, ['sh','-lc','MYSQL_PWD=' + JSON.stringify(adminPassword) + ' mysql -uroot -e ' + JSON.stringify(sql)]); }
  db.run('DELETE FROM server_databases WHERE id=?',id);
  recordEvent({serverId:row.server_id,actor,type:'database-deleted',summary:`Database ${row.name} deleted.`,details:{id}});
  return {ok:true};
}

async function deleteHost(id,{actor='system'}={}) {
  const host=hostRow(id); if(!host) throw httpError(404,'Database host not found');
  const count=db.get('SELECT COUNT(*) c FROM server_databases WHERE host_id=?',id).c; if(count) throw httpError(409,'Database host still contains assigned databases');
  db.run('UPDATE database_hosts SET status=\'deleting\',updated_at=datetime(\'now\') WHERE id=?',id);
  try { await getDocker().getContainer(host.container_id).remove({force:true}); } catch(e) { if(e.statusCode!==404) throw e; }
  db.run('DELETE FROM database_hosts WHERE id=?',id);
  recordEvent({actor,type:'database-host-deleted',summary:`Database host ${host.name} deleted.`,details:{id}});
  return {ok:true};
}

module.exports={IMAGES,listHosts,hostRow,listServerDatabases,createHost,createDatabase,deleteDatabase,deleteHost};
