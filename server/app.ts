import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import { and, eq, or, desc, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { Config } from './config';
import type { Database } from './db';
import type { ObjectStore } from './storage';
import { importMySigmail } from './mysigmail';
import { createAuth, issueLink, redeemLink } from './auth';
import { assets, collections, templates, user } from './schema';
import { assetIds, validateDocument, type EmailDocument } from '../shared/model';
import { uploadAsset, publishAsset, revokeAsset } from './assets';
import { compile, embeddedEmail, archive, readArchive, remapAssets } from './email';

declare module 'fastify' {
  interface FastifyRequest { identity: { id: string; role: string; name: string; email: string } }
}
const recordSchema = z.object({
  name: z.string().trim().min(1).max(150),
  kind: z.enum(['draft', 'template', 'section']),
  document: z.unknown(),
  collectionId: z.string().uuid().nullable().default(null),
});
const paramsId = (v: unknown) => z.object({ id: z.string().uuid() }).parse(v).id;
export async function createApp(db: Database, store: ObjectStore, config: Config) {
  const app = Fastify({ logger: config.NODE_ENV !== 'test', bodyLimit: 2 * 1024 * 1024, trustProxy: (_address, hop) => hop === 0 });
  const auth = createAuth(db, config);
  await app.register(helmet, { contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'blob:', 'data:', 'https:', config.ASSET_PUBLIC_BASE_URL],
      fontSrc: ["'self'"], connectSrc: ["'self'"], frameSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"], baseUri: ["'none'"], frameAncestors: ["'none'"],
      upgradeInsecureRequests: config.NODE_ENV === 'production' ? [] : null,
    },
  }, crossOriginEmbedderPolicy: false });
  await app.register(rateLimit, { max: 240, timeWindow: '1 minute' });
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 1, fields: 5 } });
  app.setErrorHandler((caught, req, reply) => {
    const error = caught as Error & { statusCode?: number };
    const known = error instanceof z.ZodError || [
      'invalid_mysigmail', 'mysigmail_too_large', 'invalid_document', 'document_too_deep', 'invalid_move', 'last_column', 'invalid_archive',
      'archive_too_large', 'export_too_large', 'image_too_large', 'invalid_image', 'missing_image', 'invalid_account', 'expired_link', 'not_found',
    ].includes(error.message);
    const status = error.statusCode && error.statusCode < 500 ? error.statusCode : known ? 400 : 503;
    if (status >= 500) req.log.error({ err: error }, 'Request failed');
    reply.code(status).send({ error: error instanceof z.ZodError ? 'invalid_input' : known ? error.message : status < 500 ? 'request_failed' : 'service_unavailable' });
  });
  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.headers.origin !== config.PUBLIC_ORIGIN) return reply.code(403).send({ error: 'invalid_origin' });
    }
  });
  app.get('/healthz', async () => { await db.execute(sql`select 1`); return { status: 'ok' }; });
  app.route({
    method: ['GET', 'POST'], url: '/api/auth/*',
    handler: async (req, reply) => {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (v) headers.set(k, Array.isArray(v) ? v.join(',') : v);
      const response = await auth.handler(new Request(new URL(req.url, config.PUBLIC_ORIGIN), {
        method: req.method, headers,
        ...(req.method !== 'GET' ? { body: JSON.stringify(req.body ?? {}) } : {}),
      }));
      reply.code(response.status);
      response.headers.forEach((v, k) => { if (k !== 'set-cookie') reply.header(k, v); });
      reply.header('set-cookie', response.headers.getSetCookie());
      return reply.send(await response.text());
    },
  });
  app.post('/api/redeem', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async req => {
    const data = z.object({ token: z.string().min(30).max(100), name: z.string().trim().min(1).max(100), password: z.string().min(12).max(128) }).parse(req.body);
    await redeemLink(db, data.token, data.name, data.password);
    return { ok: true };
  });
  await app.register(async privateApi => {
    privateApi.addHook('preHandler', async (req, reply) => {
      const headers = new Headers();
      if (req.headers.cookie) headers.set('cookie', req.headers.cookie);
      const session = await auth.api.getSession({ headers });
      if (!session) return reply.code(401).send({ error: 'unauthorized' });
      req.identity = { id: session.user.id, name: session.user.name, email: session.user.email, role: session.user.role as string };
    });
    async function requireAssets(doc: EmailDocument, ownerId: string) {
      const ids = assetIds(doc);
      const list = ids.length ? await db.select().from(assets).where(and(inArray(assets.id, ids), eq(assets.ownerId, ownerId))) : [];
      if (list.length !== ids.length) throw new Error('missing_image');
      return list;
    }
    async function requireCollection(id: string | null, ownerId: string) {
      if (id && !(await db.select().from(collections).where(and(eq(collections.id, id), eq(collections.ownerId, ownerId)))).length) throw new Error('not_found');
    }
    privateApi.get('/me', async req => req.identity);
    privateApi.get('/templates', async req => db.select().from(templates).where(or(eq(templates.ownerId, req.identity.id), eq(templates.shared, true))).orderBy(desc(templates.updatedAt)));
    privateApi.post('/templates', async req => {
      const data = recordSchema.parse(req.body);
      const document = validateDocument(data.document);
      await requireAssets(document, req.identity.id);
      await requireCollection(data.collectionId, req.identity.id);
      const [record] = await db.insert(templates).values({ ...data, document, ownerId: req.identity.id }).returning();
      return record;
    });
    privateApi.put('/templates/:id', async (req, reply) => {
      const id = paramsId(req.params);
      const data = recordSchema.extend({ revision: z.number().int().positive() }).parse(req.body);
      const document = validateDocument(data.document);
      await requireAssets(document, req.identity.id);
      await requireCollection(data.collectionId, req.identity.id);
      const [record] = await db.update(templates).set({ ...data, document, revision: data.revision + 1, updatedAt: new Date() })
        .where(and(eq(templates.id, id), eq(templates.ownerId, req.identity.id), eq(templates.revision, data.revision))).returning();
      if (!record) return reply.code(409).send({ error: 'revision_conflict' });
      return record;
    });
    privateApi.delete('/templates/:id', async req => {
      await db.delete(templates).where(and(eq(templates.id, paramsId(req.params)), eq(templates.ownerId, req.identity.id)));
      return { ok: true };
    });
    privateApi.post('/templates/:id/duplicate', async req => {
      const [source] = await db.select().from(templates).where(and(eq(templates.id, paramsId(req.params)), or(eq(templates.ownerId, req.identity.id), eq(templates.shared, true))));
      if (!source) throw new Error('not_found');
      const mapping: Record<string, string> = {};
      for (const id of assetIds(source.document)) {
        const [a] = await db.select().from(assets).where(eq(assets.id, id));
        if (!a) throw new Error('missing_image');
        mapping[id] = a.ownerId === req.identity.id ? id : (await uploadAsset(db, store, req.identity.id, await store.get(a.key), a.name)).id;
      }
      const [copy] = await db.insert(templates).values({ ownerId: req.identity.id, name: source.name, kind: source.kind, document: remapAssets(source.document, mapping) }).returning();
      return copy;
    });
    privateApi.post('/templates/:id/share', async (req, reply) => {
      if (req.identity.role !== 'admin') return reply.code(403).send({ error: 'forbidden' });
      const { shared } = z.object({ shared: z.boolean() }).parse(req.body);
      const [record] = await db.update(templates).set({ shared, updatedAt: new Date(), revision: sql`${templates.revision}+1` })
        .where(and(eq(templates.id, paramsId(req.params)), eq(templates.ownerId, req.identity.id))).returning();
      if (!record) throw new Error('not_found');
      return record;
    });
    privateApi.get('/collections', async req => db.select().from(collections).where(eq(collections.ownerId, req.identity.id)));
    privateApi.post('/collections', async req => {
      const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(req.body);
      const [r] = await db.insert(collections).values({ name, ownerId: req.identity.id }).returning();
      return r;
    });
    privateApi.put('/collections/:id', async req => {
      const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(req.body);
      await db.update(collections).set({ name }).where(and(eq(collections.id, paramsId(req.params)), eq(collections.ownerId, req.identity.id)));
      return { ok: true };
    });
    privateApi.delete('/collections/:id', async req => {
      await db.delete(collections).where(and(eq(collections.id, paramsId(req.params)), eq(collections.ownerId, req.identity.id)));
      return { ok: true };
    });
    privateApi.get('/assets', async req => db.select({
      id: assets.id, name: assets.name, width: assets.width, height: assets.height, bytes: assets.bytes, published: sql<boolean>`${assets.publishedKey} is not null`,
    }).from(assets).where(eq(assets.ownerId, req.identity.id)).orderBy(desc(assets.createdAt)));
    privateApi.post('/assets', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async req => {
      const file = await req.file({ limits: { fileSize: 10 * 1024 * 1024 } });
      if (!file) throw new Error('invalid_image');
      const bytes = await file.toBuffer();
      const a = await uploadAsset(db, store, req.identity.id, bytes, file.filename);
      return { id: a.id, name: a.name, width: a.width, height: a.height, bytes: a.bytes, published: false };
    });
    privateApi.get('/assets/:id/content', async (req, reply) => {
      const id = paramsId(req.params);
      const [a] = await db.select().from(assets).where(eq(assets.id, id));
      if (!a) throw new Error('not_found');
      if (a.ownerId !== req.identity.id) {
        const shared = await db.select({ document: templates.document }).from(templates).where(eq(templates.shared, true));
        if (!shared.some(t => assetIds(t.document).includes(id))) return reply.code(403).send({ error: 'forbidden' });
      }
      reply.header('cache-control', 'private,no-store').type(a.mime);
      return Buffer.from(await store.get(a.key));
    });
    privateApi.post('/assets/:id/revoke', async req => {
      await revokeAsset(db, store, req.identity.id, paramsId(req.params));
      return { ok: true };
    });
    privateApi.post('/exports', async (req, reply) => {
      const { format, document } = z.object({ format: z.enum(['copy', 'html', 'eml', 'archive']), document: z.unknown() }).parse(req.body);
      const doc = validateDocument(document);
      const list = await requireAssets(doc, req.identity.id);
      if (format === 'eml') return reply.type('message/rfc822').header('content-disposition', 'attachment; filename="email.eml"').send(await embeddedEmail(doc, list, store));
      if (format === 'archive') return reply.type('application/zip').header('content-disposition', 'attachment; filename="template.zip"').send(Buffer.from(await archive(doc, list, store)));
      const urls: Record<string, string> = {};
      for (const a of list) urls[a.id] = await publishAsset(db, store, req.identity.id, a.id);
      const output = await compile(doc, urls, format === 'copy');
      if (output.warnings.includes('missing_image')) throw new Error('missing_image');
      if (format === 'html') return reply.type('text/html').header('content-disposition', 'attachment; filename="email.html"').send(output.html);
      return { html: output.fragment, text: output.text, warnings: output.warnings };
    });
    privateApi.post('/imports', async req => {
      const { source } = z.object({ source: z.enum(['archive', 'mysigmail']).default('archive') }).parse(req.query);
      const file = await req.file({ limits: { fileSize: source === 'mysigmail' ? 2 * 1024 * 1024 : 50 * 1024 * 1024 } });
      if (!file) throw new Error(source === 'mysigmail' ? 'invalid_mysigmail' : 'invalid_archive');
      if (source === 'mysigmail') {
        const imported = importMySigmail(await file.toBuffer());
        const [record] = await db.insert(templates).values({ ownerId: req.identity.id, name: imported.name, document: imported.document, kind: 'template' }).returning();
        return { ...record, importWarnings: imported.importWarnings };
      }
      const { doc, images } = readArchive(await file.toBuffer());
      const mapping: Record<string, string> = {};
      for (const image of images) mapping[image.oldId] = (await uploadAsset(db, store, req.identity.id, image.data, image.name)).id;
      const [record] = await db.insert(templates).values({ ownerId: req.identity.id, name: file.filename.replace(/\.zip$/i, '').slice(0, 150) || 'Imported', kind: 'template', document: remapAssets(doc, mapping) }).returning();
      return record;
    });
    privateApi.get('/admin/users', async (req, reply) => {
      if (req.identity.role !== 'admin') return reply.code(403).send({ error: 'forbidden' });
      return db.select({ id: user.id, name: user.name, email: user.email, role: user.role }).from(user);
    });
    privateApi.post('/admin/links', async (req, reply) => {
      if (req.identity.role !== 'admin') return reply.code(403).send({ error: 'forbidden' });
      const { email, purpose } = z.object({ email: z.email().transform(s => s.toLowerCase()), purpose: z.enum(['invite', 'recover']) }).parse(req.body);
      return { url: `${config.PUBLIC_ORIGIN}/?token=${await issueLink(db, email, purpose)}` };
    });
  }, { prefix: '/api' });
  if (existsSync(resolve('dist/client'))) {
    await app.register(staticFiles, { root: resolve('dist/client') });
    app.setNotFoundHandler((req, reply) => req.url.startsWith('/api/') ? reply.code(404).send({ error: 'not_found' }) : reply.sendFile('index.html'));
  }
  return app;
}
