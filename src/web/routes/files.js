'use strict';

// File manager API.
//   module.exports.serverFiles → mount at /api/servers/:id/files (mergeParams)
//   module.exports.globalFiles → mount at /api/files (admin, rooted at DATA_DIR)

const asyncHandler = require('../middleware/asyncHandler');
const { makeJsonErrorHandler } = require('../middleware/jsonErrorHandler');
const fsp = require('node:fs/promises');
const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const files = require('../../services/files');
const remoteFiles = require('../../services/remoteFiles');
const servers = require('../../services/servers');
const { dataPath } = require('../../storage/pathGuard');
const logger = require('../../logger')('files');
const { serializeError } = require('../../utils/logSanitize');

// requireAuth guarantees req.user on every /api request.
const actorOf = (req) => req.user.username;

const upload = multer({
  dest: dataPath('tmp'),
  limits: { fileSize: 4 * 1024 ** 3, files: 20 },
});

// Hard ceiling on a single upload request. Without this the multer limits allow
// up to 4 GB × 20 = 80 GB to be streamed to data/tmp BEFORE the quota check runs.
const MAX_UPLOAD_REQUEST_BYTES = 8 * 1024 ** 3;

// Reject oversized / quota-busting / disk-filling uploads from the Content-Length
// header BEFORE multer streams a single byte to disk.
function uploadPreflight(scope) {
  return asyncHandler(async (req, res, next) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > MAX_UPLOAD_REQUEST_BYTES) {
      return res.status(413).json({
        ok: false,
        error: `Upload too large (limit ${Math.round(MAX_UPLOAD_REQUEST_BYTES / 1024 ** 3)} GB per request).`,
      });
    }
    if (declared > 0) {
      if (scope === 'server') files.assertRoom(req.params.id, declared); // per-server quota
      await files.assertDiskFree(declared); // free disk space
    }
    next();
  });
}

const pathSchema = z.string().max(4096).default('');
const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .regex(/^[^\\/\0]+$/, 'Names cannot contain path separators.');

function makeRouter(scope) {
  const router = express.Router({ mergeParams: true });
  const sid = (req) => (scope === 'server' ? req.params.id : null);

  // Server scope: 404 unless the server exists (also blocks probing arbitrary dirs).
  if (scope === 'server') {
    router.use((req, res, next) => {
      if (!servers.getServer(req.params.id)) {
        return res.status(404).json({ ok: false, error: 'Server not found' });
      }
      next();
    });
  }

  router.get(
    '/list',
    asyncHandler(async (req, res, next) => {
      const rel = pathSchema.parse(req.query.path ?? '');
      res.json({ ok: true, ...(scope === 'server' ? await remoteFiles.list(sid(req), rel) : await files.list(sid(req), rel)) });
    })
  );

  router.get(
    '/read',
    asyncHandler(async (req, res, next) => {
      const rel = pathSchema.parse(req.query.path ?? '');
      res.json({ ok: true, path: rel, ...(scope === 'server' ? await remoteFiles.readText(sid(req), rel) : await files.readText(sid(req), rel)) });
    })
  );

  router.get(
    '/download',
    asyncHandler(async (req, res, next) => {
      const rel = pathSchema.parse(req.query.path ?? '');
      const file = scope === 'server' ? await remoteFiles.download(sid(req), rel) : { local: true, file: await files.statFile(sid(req), rel) };
      if (file.local) return res.download(file.file.abs, file.file.name);
      res.setHeader('Content-Type', file.response.headers.get('content-type') || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
      if (file.response.body) require('node:stream').Readable.fromWeb(file.response.body).pipe(res); else res.end();
    })
  );

  // Find-in-files: plain substring grep across text files under ?path (or the
  // scope root). Bounded server-side - see services/files.searchFiles.
  router.get(
    '/search',
    asyncHandler(async (req, res, next) => {
      const q = z
        .string()
        .min(2)
        .max(200)
        .parse(req.query.q ?? '');
      const subdir = pathSchema.parse(req.query.path ?? '');
      const caseSensitive = req.query.case === '1' || req.query.case === 'true';
      res.json({ ok: true, ...(scope === 'server' ? await remoteFiles.mutate(sid(req), 'search', { q, caseSensitive, subdir }) : await files.searchFiles(sid(req), q, { caseSensitive, subdir })) });
    })
  );

  // The text editor allows up to 8 MB of content; the app-wide body parser skips
  // this path so this larger parser is the one that reads it (see web/app.js).
  router.post(
    '/write',
    express.json({ limit: '9mb' }),
    asyncHandler(async (req, res, next) => {
      const { path: rel, content } = z
        .object({
          path: pathSchema,
          content: z.string().max(8 * 1024 * 1024, 'Content exceeds the 8 MB editor limit'),
        })
        .parse(req.body);
      res.json({ ok: true, ...(scope === 'server' ? await remoteFiles.writeText(sid(req), rel, content, { actor: actorOf(req) }) : await files.writeText(sid(req), rel, content, { actor: actorOf(req) })) });
    })
  );

  router.post(
    '/mkdir',
    asyncHandler(async (req, res, next) => {
      const { path: rel } = z.object({ path: pathSchema }).parse(req.body);
      res.status(201).json({ ok: true, ...(scope === 'server' ? await remoteFiles.mutate(sid(req), 'mkdir', { path: rel, actor: actorOf(req) }) : await files.mkdir(sid(req), rel, { actor: actorOf(req) })) });
    })
  );

  router.post(
    '/rename',
    asyncHandler(async (req, res, next) => {
      const { path: rel, newName } = z.object({ path: pathSchema, newName: nameSchema }).parse(req.body);
      res.json({ ok: true, ...(scope === 'server' ? await remoteFiles.mutate(sid(req), 'rename', { path: rel, newName, actor: actorOf(req) }) : await files.rename(sid(req), rel, newName, { actor: actorOf(req) })) });
    })
  );

  router.post(
    '/move',
    asyncHandler(async (req, res, next) => {
      const { path: rel, dest } = z.object({ path: pathSchema, dest: pathSchema }).parse(req.body);
      res.json({ ok: true, ...(scope === 'server' ? await remoteFiles.mutate(sid(req), 'move', { path: rel, dest, actor: actorOf(req) }) : await files.move(sid(req), rel, dest, { actor: actorOf(req) })) });
    })
  );

  router.post(
    '/copy',
    asyncHandler(async (req, res, next) => {
      const { path: rel, dest } = z.object({ path: pathSchema, dest: pathSchema }).parse(req.body);
      res.json({ ok: true, ...(scope === 'server' ? await remoteFiles.mutate(sid(req), 'copy', { path: rel, dest, actor: actorOf(req) }) : await files.copy(sid(req), rel, dest, { actor: actorOf(req) })) });
    })
  );

  router.delete(
    '/',
    asyncHandler(async (req, res, next) => {
      const rel = pathSchema.parse(req.query.path ?? '');
      res.json({ ok: true, ...(scope === 'server' ? await remoteFiles.mutate(sid(req), 'remove', { path: rel, actor: actorOf(req) }) : await files.remove(sid(req), rel, { actor: actorOf(req) })) });
    })
  );

  router.post('/upload', uploadPreflight(scope), upload.array('files', 20), async (req, res, next) => {
    try {
      const rel = pathSchema.parse(req.query.path ?? '');
      if (!req.files || !req.files.length) throw Object.assign(new Error('No files attached'), { status: 400 });
      const uploaded = [];
      for (const f of req.files) {
        uploaded.push(await remoteFiles.upload(sid(req), rel, f.path, f.originalname, f.size));
      }
      res.status(201).json({ ok: true, uploaded });
    } catch (err) {
      if (req.files) {
        for (const f of req.files) {
          await fsp.rm(f.path, { force: true }).catch((e) => {
            logger.debug('Could not remove a temporary upload file.', {
              err: serializeError(e, { includeStack: false }),
            });
          });
        }
      }
      next(err);
    }
  });

  // JSON error handler (same contract as /api).
  router.use(makeJsonErrorHandler('files', { fileTooLarge: 'That file is too large (4 GB upload limit).' }));

  return router;
}

module.exports = { serverFiles: makeRouter('server'), globalFiles: makeRouter('global') };
