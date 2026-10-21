import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import type { Database } from './db';
import { assets } from './schema';
import type { ObjectStore } from './storage';

export async function uploadAsset(db: Database, store: ObjectStore, ownerId: string, input: Uint8Array, name: string) {
  if (input.length > 10 * 1024 * 1024) throw new Error('image_too_large');
  const image = sharp(input, { limitInputPixels: 40_000_000, animated: false, failOn: 'error' });
  const metadata = await image.metadata();
  if (!['jpeg', 'png', 'webp', 'gif'].includes(metadata.format ?? '')) throw new Error('invalid_image');
  const { data, info } = await image.rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
  if (data.length > 10 * 1024 * 1024) throw new Error('image_too_large');
  const id = crypto.randomUUID();
  const key = `private/${ownerId}/${id}.png`;
  await store.put(key, data, 'image/png');
  try {
    const [record] = await db.insert(assets).values({
      id, ownerId, key, mime: 'image/png', bytes: data.length, width: info.width, height: info.height,
      name: `${name.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 120) || 'image'}.png`,
      sha256: createHash('sha256').update(data).digest('hex'),
    }).returning();
    return record;
  } catch (e) {
    await store.delete(key).catch(() => {}); // Unreferenced uploads are safe to retry.
    throw e;
  }
}
export async function publishAsset(db: Database, store: ObjectStore, ownerId: string, id: string) {
  // Row locking serializes publication/revocation, including across processes.
  return db.transaction(async tx => {
    const [a] = await tx.select().from(assets).where(and(eq(assets.id, id), eq(assets.ownerId, ownerId))).for('update');
    if (!a) throw new Error('missing_image');
    if (a.publishedKey) return store.url(a.publishedKey);
    // Deterministic retry key, unguessable because the asset UUID is random.
    const key = `published/${a.id}/${a.publicationNonce}.png`;
    await store.publish(a.key, key, a.mime);
    await tx.update(assets).set({ publishedKey: key }).where(eq(assets.id, id));
    return store.url(key);
  });
}
export async function revokeAsset(db: Database, store: ObjectStore, ownerId: string, id: string) {
  await db.transaction(async tx => {
    const [a] = await tx.select().from(assets).where(and(eq(assets.id, id), eq(assets.ownerId, ownerId))).for('update');
    if (!a) throw new Error('not_found');
    if (a.publishedKey) await store.delete(a.publishedKey);
    await tx.update(assets).set({ publishedKey: null, publicationNonce: crypto.randomUUID() }).where(eq(assets.id, id));
  });
}
