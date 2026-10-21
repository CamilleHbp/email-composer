import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import { createServer } from 'vite';
import { createApp } from './app';
import type { Config } from './config';
import type { Database } from './db';
import type { ObjectStore } from './storage';
import * as schema from './schema';
import { starter } from '../shared/starters';

const origin = 'http://localhost:5173';
const dataDir = resolve('.local');
const email = 'test@example.test';
const password = 'test-password-12345';

class LocalStorage implements ObjectStore {
  path(key: string) {
    if (!/^(private|published)\/[a-zA-Z0-9/-]+\.png$/.test(key)) throw new Error('missing_image');
    return resolve(dataDir, 'images', key);
  }
  async put(key: string, body: Uint8Array) {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
  async get(key: string) { return readFile(this.path(key)); }
  async publish(key: string, published: string) {
    const path = this.path(published);
    await mkdir(dirname(path), { recursive: true });
    await copyFile(this.path(key), path);
  }
  async delete(key: string) { await rm(this.path(key), { force: true }); }
  url(key: string) { return `${origin}/api/dev-assets/${key}`; }
}

await mkdir(dataDir, { recursive: true });
const secretPath = resolve(dataDir, 'auth-secret');
try { await writeFile(secretPath, randomBytes(48).toString('hex'), { flag: 'wx', mode: 0o600 }); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
const client = new PGlite(resolve(dataDir, 'database'));
const db = drizzle(client, { schema });
const store = new LocalStorage();
const settings: Config = {
  NODE_ENV: 'development', PORT: 3000, PUBLIC_ORIGIN: origin,
  DATABASE_URL: 'postgres://local', BETTER_AUTH_SECRET: await readFile(secretPath, 'utf8'),
  S3_ENDPOINT: 'http://localhost:3000', S3_REGION: 'local', S3_BUCKET: 'local',
  S3_ACCESS_KEY_ID: 'unused', S3_SECRET_ACCESS_KEY: 'unused',
  ASSET_PUBLIC_BASE_URL: `${origin}/api/dev-assets`,
};
let app: Awaited<ReturnType<typeof createApp>> | undefined;
let vite: Awaited<ReturnType<typeof createServer>> | undefined;
let stopping = false;
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  await vite?.close();
  await app?.close();
  await client.close();
  process.exit(code);
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
try {
  await migrate(db, { migrationsFolder: 'migrations' });
  const [existing] = await db.select().from(schema.user).where(eq(schema.user.email, email));
  if (!existing) {
    const id = crypto.randomUUID();
    const hashed = await hashPassword(password);
    await db.transaction(async tx => {
      await tx.insert(schema.user).values({ id, email, name: 'Local developer', role: 'admin' });
      await tx.insert(schema.account).values({ id: crypto.randomUUID(), accountId: id, userId: id, providerId: 'credential', password: hashed });
      await tx.insert(schema.templates).values({ ownerId: id, name: 'The October letter', kind: 'draft', document: starter('newsletter', 'en') });
    });
  }
  app = await createApp(db as unknown as Database, store, settings);
  app.get<{ Params: { '*': string } }>('/api/dev-assets/*', async (req, reply) => {
    const key = req.params['*'];
    if (!key.startsWith('published/')) return reply.code(404).send({ error: 'not_found' });
    try {
      const image = await store.get(key);
      return reply.type('image/png').send(image);
    }
    catch { return reply.code(404).send({ error: 'not_found' }); }
  });
  await app.listen({ host: '127.0.0.1', port: 3000 });
  vite = await createServer({ server: { host: 'localhost', port: 5173, strictPort: true } });
  await vite.listen();
  console.log(`\nMail Studio: ${origin}\nLocal login: ${email} / ${password}\nDrafts and images are saved in .local/. Published image URLs work only on this computer.\nPress Ctrl+C to stop.\n`);
} catch (error) {
  console.error('Local development server failed to start:', error);
  await shutdown(1);
}
