import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { createApp } from '../server/app';
import { createUser, testConfig, testDatabase, MemoryStorage } from './helpers';
import { blank, node } from '../shared/model';
import { uploadAsset, publishAsset, revokeAsset } from '../server/assets';
import { issueLink, redeemLink, tokenHash } from '../server/auth';
import { invitations, assets } from '../server/schema';

describe('authenticated API with PostgreSQL', () => {
  let database: Awaited<ReturnType<typeof testDatabase>>;
  let app: Awaited<ReturnType<typeof createApp>>;
  const store = new MemoryStorage();
  let alice: string, bob: string, cookie: string, bobCookie: string;
  const origin = testConfig.PUBLIC_ORIGIN;
  beforeAll(async () => {
    database = await testDatabase();
    alice = await createUser(database.db, 'alice@example.test', 'admin');
    bob = await createUser(database.db, 'bob@example.test');
    app = await createApp(database.db, store, testConfig);
    async function login(email: string) {
      const res = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', headers: { origin }, payload: { email, password: 'test-password-12345' } });
      expect(res.statusCode, res.body).toBe(200);
      return res.cookies.map(c => `${c.name}=${c.value}`).join('; ');
    }
    cookie = await login('alice@example.test'); bobCookie = await login('bob@example.test');
  }, 30000);
  afterAll(async () => { await app?.close(); await database?.client.close(); });
  it('requires sessions, rejects cross-origin mutations, and disables public signup', async () => {
    expect((await app.inject('/api/templates')).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/templates', headers: { cookie, origin: 'https://attacker.test' }, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/auth/sign-up/email', headers: { origin }, payload: { name: 'X', email: 'x@example.test', password: 'test-password-12345' } })).statusCode).not.toBe(200);
  });
  it('isolates templates and detects stale saves', async () => {
    const body = { name: 'Private', kind: 'draft', document: blank() };
    const created = await app.inject({ method: 'POST', url: '/api/templates', headers: { cookie, origin }, payload: body });
    expect(created.statusCode, created.body).toBe(200);
    const record = created.json();
    expect((await app.inject({ url: '/api/templates', headers: { cookie: bobCookie } })).json()).toEqual([]);
    const saved = await app.inject({ method: 'PUT', url: `/api/templates/${record.id}`, headers: { cookie, origin }, payload: { ...body, name: 'Edited', revision: 1 } });
    expect(saved.json().revision).toBe(2);
    const stale = await app.inject({ method: 'PUT', url: `/api/templates/${record.id}`, headers: { cookie, origin }, payload: { ...body, revision: 1 } });
    expect(stale.statusCode).toBe(409);
    const other = await app.inject({ method: 'PUT', url: `/api/templates/${record.id}`, headers: { cookie: bobCookie, origin }, payload: { ...body, revision: 2 } });
    expect(other.statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/api/admin/links', headers: { cookie: bobCookie, origin }, payload: { email: 'e@example.test', purpose: 'invite' } })).statusCode).toBe(403);
  });
  it('accepts invitation once, rejects expiry, and supports password recovery', async () => {
    const token = await issueLink(database.db, 'new@example.test', 'invite');
    await redeemLink(database.db, token, 'New', 'very-safe-password');
    await expect(redeemLink(database.db, token, 'New', 'very-safe-password')).rejects.toThrow('expired_link');
    const expired = await issueLink(database.db, 'expired@example.test', 'invite');
    await database.db.update(invitations).set({ expiresAt: new Date(0) }).where(eq(invitations.hash, tokenHash(expired)));
    await expect(redeemLink(database.db, expired, 'Expired', 'very-safe-password')).rejects.toThrow('expired_link');
    const recover = await issueLink(database.db, 'new@example.test', 'recover');
    await redeemLink(database.db, recover, 'New', 'a-different-password');
    const login = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', headers: { origin }, payload: { email: 'new@example.test', password: 'a-different-password' } });
    expect(login.statusCode).toBe(200);
  });
  it('never records failed publication, retries safely, reuses URLs, and rotates revoked URLs', async () => {
    const png = await sharp({ create: { width: 12, height: 12, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const asset = await uploadAsset(database.db, store, alice, png, 'picture.png');
    store.failures = 1;
    await expect(publishAsset(database.db, store, alice, asset.id)).rejects.toThrow('storage_unavailable');
    expect((await database.db.select().from(assets).where(eq(assets.id, asset.id)))[0].publishedKey).toBeNull();
    const url = await publishAsset(database.db, store, alice, asset.id);
    expect(await publishAsset(database.db, store, alice, asset.id)).toBe(url);
    await expect(publishAsset(database.db, store, bob, asset.id)).rejects.toThrow('missing_image');
    store.failures = 1;
    await expect(revokeAsset(database.db, store, alice, asset.id)).rejects.toThrow();
    expect((await database.db.select().from(assets).where(eq(assets.id, asset.id)))[0].publishedKey).not.toBeNull();
    await revokeAsset(database.db, store, alice, asset.id);
    expect(await publishAsset(database.db, store, alice, asset.id)).not.toBe(url);
    const preview = await app.inject({ url: `/api/assets/${asset.id}/content`, headers: { cookie: bobCookie } });
    expect(preview.statusCode).toBe(403);
  });
  it('duplicates shared templates with independent private image ownership', async () => {
    const png = await sharp({ create: { width: 12, height: 12, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const asset = await uploadAsset(database.db, store, alice, png, 'shared.png');
    const document = blank(); const image = node('image'); image.assetId = asset.id; document.nodes[0].children.push(image);
    const record = (await app.inject({ method: 'POST', url: '/api/templates', headers: { cookie, origin }, payload: { name: 'Shared', kind: 'template', document } })).json();
    expect((await app.inject({ method: 'POST', url: `/api/templates/${record.id}/share`, headers: { cookie, origin }, payload: { shared: true } })).statusCode).toBe(200);
    const copied = await app.inject({ method: 'POST', url: `/api/templates/${record.id}/duplicate`, headers: { cookie: bobCookie, origin }, payload: {} });
    expect(copied.statusCode, copied.body).toBe(200);
    const newId = copied.json().document.nodes[0].children[0].assetId;
    expect(newId).not.toBe(asset.id);
    expect((await app.inject({ url: `/api/assets/${newId}/content`, headers: { cookie: bobCookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/exports', headers: { cookie: bobCookie, origin }, payload: { format: 'copy', document } })).statusCode).toBe(400);
  });
});
