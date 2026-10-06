#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const { Server: SshServer } = require('ssh2');
const os = require('node:os');
const express = require('express');
const http = require('node:http');
const { WebSocketServer } = require('ws');
const Docker = require('dockerode');

const NODE_ID = process.env.CRAFTLY_NODE_ID;
const NODE_TOKEN = process.env.CRAFTLY_NODE_TOKEN;
const PANEL_URL = String(process.env.CRAFTLY_PANEL_URL || '').replace(/\/$/, '');
const PORT = Number(process.env.CRAFTLY_NODE_PORT || 8080);
const SFTP_PORT = Number(process.env.CRAFTLY_SFTP_PORT || 2022);
const DATA_ROOT = path.resolve(process.env.CRAFTLY_DATA_ROOT || '/var/lib/craftly');
const VERSION = '1.1.0';

if (!NODE_ID || !NODE_TOKEN || !PANEL_URL) {
  console.error('Craftly node agent requires CRAFTLY_NODE_ID, CRAFTLY_NODE_TOKEN and CRAFTLY_PANEL_URL.');
  process.exit(2);
}

fs.mkdirSync(DATA_ROOT, { recursive: true });
const docker = new Docker(process.env.DOCKER_HOST ? {} : { socketPath: process.platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock' });
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

function auth(req, res, next) {
  const value = String(req.get('authorization') || '');
  if (value !== `Bearer ${NODE_TOKEN}`) return res.status(401).json({ ok: false, error: 'Invalid node credentials' });
  next();
}

function containerName(id, override) { return override || `craftly-${id}`; }
function serverDir(id) {
  const dir = path.resolve(DATA_ROOT, 'servers', id);
  const root = path.resolve(DATA_ROOT, 'servers');
  if (dir !== root && !dir.startsWith(root + path.sep)) throw new Error('Invalid server data path');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeFilePath(id, rel = '') {
  const root = serverDir(id);
  const normalized = String(rel || '').replace(/\\/g, '/');
  if (normalized.includes('\\0')) throw new Error('Invalid path');
  const resolved = path.resolve(root, '.' + (normalized.startsWith('/') ? normalized : '/' + normalized));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error('Path escapes server root');
  return resolved;
}
function fileRel(root, abs) { return path.relative(root, abs).split(path.sep).join('/'); }
function filePayload(id, op, body={}) {
  const root = serverDir(id);
  const rel = body.path || '';
  const abs = safeFilePath(id, rel);
  return { root, rel, abs, op };
}
async function listFiles(id, rel='') {
  const root = serverDir(id), abs = safeFilePath(id, rel);
  const st = await fsp.stat(abs); if (!st.isDirectory()) throw new Error('Not a folder');
  const names = await fsp.readdir(abs, {withFileTypes:true}); const entries=[];
  for (const e of names) { const p=path.join(abs,e.name); const x=await fsp.stat(p).catch(()=>null); if(!x) continue; entries.push({name:e.name,dir:e.isDirectory(),size:e.isDirectory()?0:x.size,mtimeMs:x.mtimeMs,path:fileRel(root,p)}); }
  entries.sort((a,b)=>(b.dir-a.dir)||a.name.localeCompare(b.name,undefined,{sensitivity:'base'}));
  return {path:fileRel(root,abs),entries};
}
async function readFileText(id, rel) {
  const abs=safeFilePath(id,rel), st=await fsp.stat(abs); if(!st.isFile()) throw new Error('Not a file');
  if(st.size>8*1024*1024) throw new Error('File exceeds 8 MB editor limit');
  const buf=await fsp.readFile(abs); if(buf.subarray(0,8192).includes(0)) throw new Error('Binary file');
  return {path:String(rel||''),content:buf.toString('utf8'),size:st.size};
}
async function writeFileText(id, rel, content) {
  if(typeof content!=='string') throw new Error('Content must be text');
  if(Buffer.byteLength(content,'utf8')>8*1024*1024) throw new Error('Content exceeds 8 MB editor limit');
  const abs=safeFilePath(id,rel); if(!rel) throw new Error('Cannot write root');
  await fsp.mkdir(path.dirname(abs),{recursive:false}); const tmp=path.join(path.dirname(abs),`.craftly-write-${Date.now()}-${process.pid}.tmp`);
  await fsp.writeFile(tmp,content,'utf8'); await fsp.rename(tmp,abs); return {path:String(rel),size:Buffer.byteLength(content)};
}
async function searchFiles(id,q,subdir='',caseSensitive=false) {
  const root=serverDir(id), start=safeFilePath(id,subdir), needle=String(q||''); if(needle.length<2) throw new Error('Search query is too short');
  const hay=caseSensitive?needle:needle.toLowerCase(); const matches=[]; let scanned=0, truncated=false;
  const skip=new Set(['node_modules','.git','cache','.cache','libraries','versions','crash-reports']);
  async function walk(dir, relBase='') { if(matches.length>=300||scanned>=8000){truncated=true;return;} const ents=await fsp.readdir(dir,{withFileTypes:true}).catch(()=>[]);
    for(const e of ents){ if(matches.length>=300||scanned>=8000) {truncated=true;return;} if(skip.has(e.name)&&e.isDirectory()) continue; const p=path.join(dir,e.name), r=relBase?`${relBase}/${e.name}`:e.name; if(e.isDirectory()){await walk(p,r);continue;} const st=await fsp.stat(p).catch(()=>null); if(!st||st.size===0||st.size>2*1024*1024) continue; scanned++; const b=await fsp.readFile(p).catch(()=>null); if(!b||b.subarray(0,8192).includes(0)) continue; const lines=b.toString('utf8').split('\\n'); for(let i=0;i<lines.length;i++){const line=lines[i], idx=(caseSensitive?line:line.toLowerCase()).indexOf(hay); if(idx>=0){matches.push({path:r,line:i+1,col:idx+1,text:line.length>300?line.slice(0,300)+'…':line}); if(matches.length>=300){truncated=true;return;} }}}
  }
  await walk(start, fileRel(root,start)); return {query:needle,matches,truncated,filesScanned:scanned};
}

function safeBind(hostPath) {
  const resolved = path.resolve(hostPath);
  const root = path.resolve(DATA_ROOT);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error(`Extra bind must be under ${root}`);
  return resolved;
}
function inspect(id) {
  return docker.getContainer(containerName(id)).inspect().then(info => {
    const s = info.State || {};
    const health = s.Health ? s.Health.Status : null;
    let status = s.Running ? (health === 'starting' ? 'starting' : health === 'unhealthy' ? 'unhealthy' : 'running') : (s.Status === 'created' ? 'stopped' : (s.ExitCode === 0 ? 'stopped' : 'crashed'));
    return { exists: true, status, health, exitCode: s.Running ? null : s.ExitCode, containerId: info.Id, imageId: info.Image, startedAt: s.Running ? s.StartedAt : null, finishedAt: s.FinishedAt, oomKilled: Boolean(s.OOMKilled) };
  }).catch(err => { if (err.statusCode === 404) return { exists: false, status: 'stopped' }; throw err; });
}
async function remove(id) { try { await docker.getContainer(containerName(id)).remove({ force: true }); } catch (e) { if (e.statusCode !== 404) throw e; } }
async function pull(image) {
  const stream = await docker.pull(image);
  await new Promise((resolve, reject) => docker.modem.followProgress(stream, (err) => err ? reject(err) : resolve()));
}
function healthcheck() { return { Test: ['CMD-SHELL', 'mc-health'], Interval: 30e9, Timeout: 10e9, Retries: 3, StartPeriod: 7200e9 }; }
async function create(spec) {
  const dir = serverDir(spec.serverId);
  await remove(spec.serverId);
  await pull(spec.image);
  const exposed = { '25565/tcp': {}, '25565/udp': {}, '25575/tcp': {} };
  const bindings = {
    '25565/tcp': [{ HostPort: String(spec.ports.game) }],
    '25565/udp': [{ HostPort: String(spec.ports.game) }],
    '25575/tcp': [{ HostPort: String(spec.ports.rcon) }],
  };
  if (spec.ports.bedrock) { exposed['19132/udp'] = {}; bindings['19132/udp'] = [{ HostPort: String(spec.ports.bedrock) }]; }
  for (const extra of spec.extraPorts || []) { exposed[extra.container] = {}; bindings[extra.container] = [{ HostPort: String(extra.host) }]; }
  const memory = Math.round(Number(spec.resources.memoryMb) * 1024 * 1024);
  const swap = memory + Math.round(Number(spec.resources.swapMb || 0) * 1024 * 1024);
  const binds = [`${dir}:/data`];
  for (const b of spec.extraBinds || []) binds.push(`${safeBind(b.hostPath)}:${b.containerPath}${b.mode === 'ro' ? ':ro' : ''}`);
  const c = await docker.createContainer({
    name: containerName(spec.serverId, spec.containerName), Image: spec.image,
    Env: Object.entries(spec.env || {}).map(([k,v]) => `${k}=${v}`),
    Labels: { 'craftly.id': spec.serverId, 'craftly.managed': 'true' },
    ExposedPorts: exposed, Tty: false, OpenStdin: false, Healthcheck: healthcheck(),
    HostConfig: { Binds: binds, PortBindings: bindings, Memory: memory, MemorySwap: swap, NanoCpus: spec.resources.cpus ? Math.round(spec.resources.cpus * 1e9) : 0, RestartPolicy: { Name: 'no' }, ...(spec.networkName ? { NetworkMode: spec.networkName } : {}) },
  });
  return { containerId: c.id };
}

function normalizeStats(stats) {
  let cpuPct = 0;
  try {
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const sysDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const online = stats.cpu_stats.online_cpus || (stats.cpu_stats.cpu_usage.percpu_usage || []).length || 1;
    if (sysDelta > 0 && cpuDelta > 0) cpuPct = (cpuDelta / sysDelta) * online * 100;
  } catch {}
  const mem = stats.memory_stats || {};
  const cache = (mem.stats && (mem.stats.inactive_file ?? mem.stats.cache)) || 0;
  const memUsed = Math.max(0, (mem.usage || 0) - cache);
  let netRx = 0, netTx = 0;
  for (const nic of Object.values(stats.networks || {})) { netRx += nic.rx_bytes || 0; netTx += nic.tx_bytes || 0; }
  return { cpuPct: Math.round(cpuPct * 10) / 10, memUsedBytes: memUsed, memLimitBytes: mem.limit || 0, netRx, netTx, at: Date.now() };
}
async function fetchLogs(id, opts = {}) {
  const c = docker.getContainer(containerName(id));
  try {
    const buf = await c.logs({ stdout:true, stderr:true, tail: Math.min(Math.max(Number(opts.tail || 200), 1), 2000), timestamps:Boolean(opts.timestamps) });
    if (!Buffer.isBuffer(buf)) return String(buf);
    const parts=[]; let off=0;
    while(off+8<=buf.length){ const type=buf[off], size=buf.readUInt32BE(off+4); if(![0,1,2].includes(type)||size>8*1024*1024||off+8+size>buf.length){ parts.push(buf.subarray(off).toString('utf8')); break; } parts.push(buf.subarray(off+8,off+8+size).toString('utf8')); off+=8+size; }
    return parts.join('');
  } catch(e) { if(e.statusCode===404) return ''; throw e; }
}
async function execCommand(id, command) {
  if (!Array.isArray(command) || command.length === 0 || command.length > 20 || command.some(v => typeof v !== 'string' || v.length > 500)) throw new Error('Invalid exec command');
  const c = docker.getContainer(containerName(id));
  const exec = await c.exec({ Cmd: command, AttachStdout:true, AttachStderr:true, Tty:false });
  const stream = await exec.start({ hijack:true, stdin:false });
  const chunks=[];
  await new Promise((resolve,reject)=>{ const timer=setTimeout(()=>{ try{stream.destroy();}catch{} reject(new Error('Command timed out')); },15000); stream.on('data',x=>chunks.push(x)); stream.on('end',()=>{clearTimeout(timer);resolve();}); stream.on('error',e=>{clearTimeout(timer);reject(e);}); });
  let out=''; for(const b of chunks){ if(b.length>=8 && (b[0]===0||b[0]===1||b[0]===2)){ out += b.subarray(8).toString('utf8'); } else out += b.toString('utf8'); }
  const info=await exec.inspect();
  return { stdout:out, stderr:'', exitCode:info.ExitCode == null ? 0 : info.ExitCode };
}


app.get('/v1/servers/:id/files', async (req,res)=>{
  try { const id=req.params.id, rel=String(req.query.path||''); const op=String(req.query.op||'list');
    if(op==='list') return res.json(await listFiles(id,rel));
    if(op==='read') return res.json(await readFileText(id,rel));
    throw new Error('Use POST for mutations');
  } catch(e) { res.status(e.statusCode||400).json({ok:false,error:e.message}); }
});
app.post('/v1/servers/:id/files', async (req,res)=>{
  try { const id=req.params.id, rel=String(req.query.path||''), body=req.body||{}, op=String(body.op||'');
    if(op==='list') return res.json(await listFiles(id,body.path||rel));
    if(op==='read') return res.json(await readFileText(id,body.path||rel));
    if(op==='write') return res.json(await writeFileText(id,body.path||rel,body.content));
    const abs=safeFilePath(id,body.path||rel);
    if(op==='mkdir'){await fsp.mkdir(abs,{recursive:false}); return res.status(201).json({ok:true,path:body.path||rel});}
    if(op==='rename'){const name=String(body.newName||''); if(!name||/[\\/\\0]/.test(name)) throw new Error('Invalid name'); const target=path.join(path.dirname(abs),name); await fsp.rename(abs,target); return res.json({ok:true,path:fileRel(serverDir(id),target)});}
    if(op==='move'||op==='copy'){const dest=safeFilePath(id,body.dest||''); const target=path.join(dest,path.basename(abs)); if(op==='copy'){await fsp.cp(abs,target,{recursive:true,errorOnExist:true});}else{await fsp.rename(abs,target);} return res.json({ok:true,path:fileRel(serverDir(id),target)});}
    if(op==='remove'){const st=await fsp.lstat(abs); await fsp.rm(abs,{recursive:st.isDirectory(),force:false}); return res.json({ok:true});}
    if(op==='stat'){const st=await fsp.stat(abs); return res.json({name:path.basename(abs),path:fileRel(serverDir(id),abs),dir:st.isDirectory(),size:st.size,mtimeMs:st.mtimeMs});}
    if(op==='search') return res.json(await searchFiles(id,body.q,body.subdir||'',Boolean(body.caseSensitive)));
    throw new Error(`Unsupported file operation: ${op}`);
  } catch(e) { res.status(e.statusCode||400).json({ok:false,error:e.message}); }
});
app.put('/v1/servers/:id/files', async (req,res)=>{
  const id=req.params.id, rel=String(req.query.path||''), filename=String(req.query.filename||path.basename(rel)||'upload.bin');
  try { const dir=safeFilePath(id,rel||'.'); const parent=await fsp.stat(dir).catch(()=>null); const target=parent?.isDirectory()?path.join(dir,filename):safeFilePath(id,rel); if(target===serverDir(id)) throw new Error('Invalid upload target'); await fsp.mkdir(path.dirname(target),{recursive:false}); const tmp=target+'.upload-'+process.pid+'-'+Date.now(); const out=require('node:fs').createWriteStream(tmp,{flags:'wx'}); let bytes=0; req.on('data',c=>bytes+=c.length); await new Promise((resolve,reject)=>{req.pipe(out);req.on('error',reject);out.on('error',reject);out.on('finish',resolve);}); await fsp.rename(tmp,target); res.status(201).json({ok:true,path:fileRel(serverDir(id),target),size:bytes}); } catch(e){res.status(400).json({ok:false,error:e.message});}
});
app.get('/v1/servers/:id/files-download', async (req,res)=>{ try { const abs=safeFilePath(req.params.id,String(req.query.path||'')); const st=await fsp.stat(abs); if(!st.isFile()) throw new Error('Not a file'); res.setHeader('Content-Length',String(st.size)); res.setHeader('Content-Type','application/octet-stream'); res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(path.basename(abs))}`); require('node:fs').createReadStream(abs).pipe(res); } catch(e){res.status(404).json({ok:false,error:e.message});} });

app.get('/health', (req,res) => res.json({ ok: true, nodeId: NODE_ID, version: VERSION }));
app.use('/v1', auth);
app.post('/v1/servers/:id/inspect', async (req,res) => { try { res.json(await inspect(req.params.id)); } catch(e) { res.status(502).json({ ok:false,error:e.message }); } });
app.post('/v1/servers/:id/create', async (req,res) => { try { res.json({ ok:true, ...(await create({ ...req.body, serverId:req.params.id })) }); } catch(e) { res.status(500).json({ ok:false,error:e.message }); } });
app.post('/v1/servers/:id/recreate', async (req,res) => { try { res.json({ ok:true, ...(await create({ ...req.body, serverId:req.params.id })) }); } catch(e) { res.status(500).json({ ok:false,error:e.message }); } });
app.post('/v1/servers/:id/start', async (req,res) => { try { await docker.getContainer(containerName(req.params.id)).start(); res.json({ok:true}); } catch(e) { res.status(500).json({ok:false,error:e.message}); } });
app.post('/v1/servers/:id/stop', async (req,res) => { try { const c=docker.getContainer(containerName(req.params.id)); try { await c.stop({t:Number(req.body.graceSeconds||90)}); } catch(e) { if(e.statusCode!==304&&e.statusCode!==404) throw e; } const info=await inspect(req.params.id); if(info.exists&&['running','starting','unhealthy'].includes(info.status)) throw new Error('Container did not stop'); res.json({ok:true}); } catch(e) { res.status(502).json({ok:false,error:e.message}); } });
app.post('/v1/servers/:id/kill', async (req,res) => { try { try { await docker.getContainer(containerName(req.params.id)).kill(); } catch(e) { if(e.statusCode!==404&&e.statusCode!==409) throw e; } res.json({ok:true}); } catch(e) { res.status(500).json({ok:false,error:e.message}); } });
app.post('/v1/servers/:id/remove', async (req,res) => { try { await remove(req.params.id); res.json({ok:true}); } catch(e) { res.status(500).json({ok:false,error:e.message}); } });
app.post('/v1/servers/:id/stats', async (req,res) => { try { const raw=await docker.getContainer(containerName(req.params.id)).stats({stream:false}); res.json(normalizeStats(raw)); } catch(e) { res.status(e.statusCode===404?404:502).json({ok:false,error:e.message}); } });
app.post('/v1/servers/:id/logs', async (req,res) => { try { res.type('text/plain').send(await fetchLogs(req.params.id, req.body || {})); } catch(e) { res.status(e.statusCode===404?404:502).json({ok:false,error:e.message}); } });
app.post('/v1/servers/:id/exec', async (req,res) => { try { res.json(await execCommand(req.params.id, req.body.command)); } catch(e) { res.status(502).json({ok:false,error:e.message}); } });


async function heartbeat() {
  try {
    const [version, info] = await Promise.all([docker.version(), docker.info()]);
    await fetch(`${PANEL_URL}/api/node-agent/${encodeURIComponent(NODE_ID)}/heartbeat`, {
      method:'POST', headers:{authorization:`Bearer ${NODE_TOKEN}`,'content-type':'application/json'},
      body:JSON.stringify({docker:{available:true,version:version.Version,os:info.OperatingSystem,ncpu:info.NCPU,memTotal:info.MemTotal},dockerInfo:{agentVersion:VERSION,hostname:os.hostname(),dataRoot:DATA_ROOT}}),
    });
  } catch (e) { console.error(`[Craftly node ${NODE_ID}] heartbeat failed: ${e.message}`); }
}

function sftpHostKeyPath(){ const p=path.join(DATA_ROOT,'.craftly-sftp-host-key'); try{return require('node:fs').readFileSync(p);}catch{} const {privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'pkcs1',format:'pem'},privateKeyEncoding:{type:'pkcs1',format:'pem'}}); require('node:fs').writeFileSync(p,privateKey,{mode:0o600}); return privateKey; }
function signSftpPayload(payload){ const body=Buffer.from(JSON.stringify(payload)).toString('base64url'); const sig=crypto.createHmac('sha256',NODE_TOKEN).update(body).digest('base64url'); return `${body}.${sig}`; }
function verifySftpCredential(username,password){ try { const [body,sig]=String(password||'').split('.'); if(!body||!sig) return null; const expected=crypto.createHmac('sha256',NODE_TOKEN).update(body).digest(); const supplied=Buffer.from(sig,'base64url'); if(expected.length!==supplied.length||!crypto.timingSafeEqual(expected,supplied)) return null; const payload=JSON.parse(Buffer.from(body,'base64url').toString('utf8')); if(Number(payload.exp||0)<Date.now()) return null; if(String(payload.username)!==String(username)) return null; if(!payload.serverId) return null; return payload; } catch{return null;} }
function startSftp(){ const ssh=new SshServer({hostKeys:[sftpHostKey()],ident:'Craftly Node SFTP'},client=>{let session=null;client.on('authentication',ctx=>{if(ctx.method!=='password')return ctx.reject(['password']); const p=verifySftpCredential(ctx.username,ctx.password); if(!p)return ctx.reject(); try{session={...p,root:serverDir(p.serverId)};ctx.accept();}catch{ctx.reject();}});client.on('ready',()=>client.on('session',accept=>{const ss=accept();ss.on('sftp',acceptSftp=>attachNodeSftp(acceptSftp(),session));}));}); ssh.on('error',e=>console.error(`[Craftly SFTP] ${e.message}`)); ssh.listen(SFTP_PORT,'0.0.0.0',()=>console.log(`[Craftly Node] SFTP listening on :${SFTP_PORT}`)); return ssh; }
function attachNodeSftp(sftp,session){ const fsNative=require('node:fs'), status={OK:0,EOF:1,NO_SUCH_FILE:2,PERMISSION_DENIED:3,FAILURE:4}, flags={READ:1,WRITE:2,APPEND:4,CREATE:8,TRUNC:16}; const files=new Map(),dirs=new Map();let n=0; const writable=Boolean(session.rw); const resolve=p=>safeFilePath(session.serverId,p); const deny=id=>sftp.status(id,status.PERMISSION_DENIED); const attrs=st=>({mode:st.mode,uid:st.uid||0,gid:st.gid||0,size:st.size,atime:Math.floor(st.atimeMs/1000),mtime:Math.floor(st.mtimeMs/1000)});
 sftp.on('REALPATH',(id)=>sftp.name(id,[{filename:'/',longname:'drwx------ 1 craftly craftly 4096 Jan 1 00:00 /',attrs:{}}]));
 sftp.on('STAT',(id,p)=>{let r;try{r=resolve(p)}catch{return sftp.status(id,status.NO_SUCH_FILE)}fsNative.stat(r,(e,st)=>e?sftp.status(id,status.NO_SUCH_FILE):sftp.attrs(id,attrs(st)));});
 sftp.on('LSTAT',(id,p)=>{let r;try{r=resolve(p)}catch{return sftp.status(id,status.NO_SUCH_FILE)}fsNative.lstat(r,(e,st)=>e?sftp.status(id,status.NO_SUCH_FILE):sftp.attrs(id,attrs(st)));});
 sftp.on('OPENDIR',(id,p)=>{let r;try{r=resolve(p)}catch{return sftp.status(id,status.NO_SUCH_FILE)}fsNative.readdir(r,(e,list)=>{if(e)return sftp.status(id,status.NO_SUCH_FILE);const h=Buffer.from(`d-${++n}`);dirs.set(h.toString(),{r,list,i:0});sftp.handle(id,h);});});
 sftp.on('READDIR',(id,h)=>{const d=dirs.get(h.toString());if(!d)return sftp.status(id,status.FAILURE);if(d.i>=d.list.length){dirs.delete(h.toString());return sftp.status(id,status.EOF)}const names=d.list.slice(d.i,d.i+40);d.i+=names.length;const out=[];for(const name of names){try{const st=fsNative.statSync(path.join(d.r,name));out.push({filename:name,longname:`${st.isDirectory()?'d':'-'}rw-r--r-- 1 craftly craftly ${st.size} ${st.mtime.toDateString()} ${name}`,attrs:attrs(st)});}catch{}}sftp.name(id,out);});
 sftp.on('OPEN',(id,p,fl)=>{let r;try{r=resolve(p)}catch{return deny(id)}const w=(fl&flags.WRITE)!==0;if(w&&!writable)return deny(id);let mode='r';if(w)mode=(fl&flags.CREATE)?((fl&flags.TRUNC)?'w+':'a+'):'r+';fsNative.open(r,mode,(e,fd)=>{if(e)return sftp.status(id,status.FAILURE);const h=Buffer.from(`f-${++n}`);files.set(h.toString(),fd);sftp.handle(id,h);});});
 sftp.on('READ',(id,h,off,len)=>{const fd=files.get(h.toString());if(fd===undefined)return sftp.status(id,status.FAILURE);const b=Buffer.alloc(len);fsNative.read(fd,b,0,len,off,(e,k)=>e?sftp.status(id,status.FAILURE):k?sftp.data(id,b.subarray(0,k)):sftp.status(id,status.EOF));});
 sftp.on('WRITE',(id,h,off,data)=>{if(!writable)return deny(id);const fd=files.get(h.toString());if(fd===undefined)return sftp.status(id,status.FAILURE);fsNative.write(fd,data,0,data.length,off,e=>e?sftp.status(id,status.FAILURE):sftp.status(id,status.OK));});
 sftp.on('CLOSE',(id,h)=>{const k=h.toString(),fd=files.get(k);if(fd!==undefined){fsNative.close(fd,()=>{});files.delete(k)}dirs.delete(k);sftp.status(id,status.OK);});
 sftp.on('REMOVE',(id,p)=>{if(!writable)return deny(id);let r;try{r=resolve(p)}catch{return deny(id)}fsNative.unlink(r,e=>e?sftp.status(id,status.FAILURE):sftp.status(id,status.OK));});
 sftp.on('MKDIR',(id,p)=>{if(!writable)return deny(id);let r;try{r=resolve(p)}catch{return deny(id)}fsNative.mkdir(r,{recursive:false},e=>e?sftp.status(id,status.FAILURE):sftp.status(id,status.OK));});
 sftp.on('RMDIR',(id,p)=>{if(!writable)return deny(id);let r;try{r=resolve(p)}catch{return deny(id)}fsNative.rmdir(r,e=>e?sftp.status(id,status.FAILURE):sftp.status(id,status.OK));});
 sftp.on('RENAME',(id,a,b)=>{if(!writable)return deny(id);let ra,rb;try{ra=resolve(a);rb=resolve(b)}catch{return deny(id)}fsNative.rename(ra,rb,e=>e?sftp.status(id,status.FAILURE):sftp.status(id,status.OK));});
}

const server = http.createServer(app);
const sftpServer = startSftp();
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
function wsAuth(req) { return String(req.headers.authorization || '') === `Bearer ${NODE_TOKEN}`; }
server.on('upgrade', (req, socket, head) => {
  const m = /^\/v1\/ws\/(console|stats)\/([A-Za-z0-9_-]+)$/.exec((req.url || '').split('?')[0]);
  if (!m || !wsAuth(req)) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => handleRuntimeWs(ws, m[1], m[2]));
});
function handleRuntimeWs(ws, kind, id) {
  const c = docker.getContainer(containerName(id));
  let stream = null, timer = null, closed = false;
  const cleanup = () => { if (closed) return; closed=true; if(timer) clearInterval(timer); try{stream?.destroy();}catch{} };
  ws.on('error', cleanup); ws.on('close', cleanup);
  if (kind === 'console') {
    c.logs({stdout:true,stderr:true,follow:true,tail:200}).then(raw => {
      stream = raw;
      let buffer=Buffer.alloc(0);
      raw.on('data', chunk => {
        buffer=Buffer.concat([buffer,chunk]);
        while(buffer.length>=8){ const type=buffer[0], size=buffer.readUInt32BE(4); if(![0,1,2].includes(type)||size>8*1024*1024||buffer.length<8+size) break; const text=buffer.subarray(8,8+size).toString('utf8'); buffer=buffer.subarray(8+size); if(ws.readyState===1) ws.send(JSON.stringify({kind:'log',text})); }
      });
      raw.on('end',()=>{ if(ws.readyState===1) ws.send(JSON.stringify({kind:'log-end'})); cleanup(); });
      raw.on('error',e=>{ if(ws.readyState===1) ws.send(JSON.stringify({kind:'error',message:e.message})); cleanup(); });
    }).catch(e=>{ if(ws.readyState===1) ws.send(JSON.stringify({kind:'error',message:e.message})); cleanup(); });
    ws.on('message', async raw => { try { const msg=JSON.parse(raw.toString()); if(msg.kind!=='cmd'||typeof msg.command!=='string') return; const words=msg.command.trim().replace(/^\//,'').split(/\s+/).filter(Boolean).slice(0,40); if(!words.length) return; const result=await execCommand(id,['rcon-cli','--',...words]); if(ws.readyState===1) ws.send(JSON.stringify({kind:'cmd-result',command:msg.command,output:result.stdout,error:result.exitCode===0?null:`Command exited with ${result.exitCode}`})); } catch(e){ if(ws.readyState===1) ws.send(JSON.stringify({kind:'cmd-result',command:String(raw),output:'',error:e.message})); } });
  } else {
    const poll=async()=>{ try{ const raw=await c.stats({stream:false}); if(ws.readyState===1) ws.send(JSON.stringify({kind:'stats',...normalizeStats(raw)})); }catch(e){ if(ws.readyState===1) ws.send(JSON.stringify({kind:'error',message:e.message})); } };
    poll(); timer=setInterval(poll,2000); timer.unref();
  }
}
server.listen(PORT, '0.0.0.0', () => { console.log(`Craftly Node Agent ${VERSION} listening on :${PORT}`); heartbeat(); setInterval(heartbeat, 30_000).unref(); });
