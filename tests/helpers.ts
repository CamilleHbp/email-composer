import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { hashPassword } from 'better-auth/crypto';
import * as schema from '../server/schema';
import type { Database } from '../server/db';
import type { Config } from '../server/config';
import type { ObjectStore } from '../server/storage';

export class MemoryStorage implements ObjectStore {
  files = new Map<string, Uint8Array>();
  failures = 0;
  publications = 0;
  async put(key: string, data: Uint8Array) {
    if (this.failures > 0) { this.failures--; throw new Error('storage_unavailable'); }
    this.files.set(key, data);
  }
  async get(key: string) { const data = this.files.get(key); if (!data) throw new Error('missing_image'); return data; }
  async publish(key: string, published: string) {
    this.publications++;
    if (this.failures > 0) { this.failures--; throw new Error('storage_unavailable'); }
    this.files.set(published, await this.get(key));
  }
  async delete(key: string) {
    if (this.failures > 0) { this.failures--; throw new Error('storage_unavailable'); }
    this.files.delete(key);
  }
  url(key: string) { return `https://assets.example.test/${key}`; }
}
export const testConfig: Config = {
  NODE_ENV: 'test', PORT: 3000, PUBLIC_ORIGIN: 'http://localhost:5173',
  DATABASE_URL: 'postgres://unused', BETTER_AUTH_SECRET: 'test-secret-with-more-than-thirty-two-characters',
  S3_ENDPOINT: 'https://s3.fr-par.scw.cloud', S3_REGION: 'fr-par', S3_BUCKET: 'test',
  S3_ACCESS_KEY_ID: 'unused', S3_SECRET_ACCESS_KEY: 'unused', ASSET_PUBLIC_BASE_URL: 'https://assets.example.test',
};
export async function testDatabase() {
  const client = new PGlite();
  const native = drizzle(client, { schema });
  await migrate(native, { migrationsFolder: 'migrations' });
  return { client, db: native as unknown as Database };
}
export async function createUser(db: Database, email: string, role = 'user') {
  const id = crypto.randomUUID();
  await db.insert(schema.user).values({ id, email, name: email.split('@')[0], role });
  await db.insert(schema.account).values({ id: crypto.randomUUID(), accountId: id, userId: id, providerId: 'credential', password: await hashPassword('test-password-12345') });
  return id;
}
