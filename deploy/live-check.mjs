import assert from 'node:assert/strict';
import postgres from 'postgres';
import { hashPassword } from 'better-auth/crypto';
import sharp from 'sharp';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';

if (process.env.CONFIRM_LIVE_CHECK !== 'mail-studio') throw new Error('Set CONFIRM_LIVE_CHECK=mail-studio to create and remove a disposable verification account.');
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const storage = new S3Client({
  region: process.env.S3_REGION, endpoint: process.env.S3_ENDPOINT,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
  maxAttempts: 2, requestHandler: { connectionTimeout: 5000, requestTimeout: 20000 },
});
const origin = process.env.PUBLIC_ORIGIN;
const id = crypto.randomUUID(), email = `verify-${id}@example.test`;
const password = crypto.randomUUID() + crypto.randomUUID();
let cookies = '';
async function request(path, body, method = 'POST') {
  const response = await fetch(`${origin}/api${path}`, {
    method, headers: { Origin: origin, Cookie: cookies, ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  });
  assert(response.ok, `${method} ${path}: HTTP ${response.status}`);
  return response;
}
function node(kind, children = [], text = '') {
  return { id: crypto.randomUUID(), kind, text, href: '', alt: '', style: {}, children };
}
try {
  await sql`INSERT INTO users (id,name,email) VALUES (${id},'Release verification',${email})`;
  await sql`INSERT INTO accounts (id,account_id,provider_id,user_id,password)
    VALUES (${crypto.randomUUID()},${id},'credential',${id},${await hashPassword(password)})`;
  const login = await request('/auth/sign-in/email', { email, password });
  cookies = login.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
  assert(cookies);
  assert.equal((await (await request('/me', undefined, 'GET')).json()).id, id);
  const png = await sharp({ create: { width: 320, height: 100, channels: 3, background: '#295e4d' } }).png().toBuffer();
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'verification.png');
  const image = await (await request('/assets', form)).json();
  const imageNode = { ...node('image'), assetId: image.id, alt: 'Verification banner' };
  const nested = node('row', [node('column', [imageNode]), node('column', [node('text', [], 'Nested image and text')])]);
  const document = { version: 1, subject: 'Mail Studio verification', preheader: '', width: 640, background: '#ffffff',
    nodes: [node('section', [node('heading', [], 'Release verification'), node('row', [
      node('column', [nested]), node('column', [node('button', [], 'Read more')]),
    ])])] };
  const record = await (await request('/templates', { name: 'Release verification', kind: 'draft', document })).json();
  const updated = await (await request(`/templates/${record.id}`, { ...record, name: 'Saved release verification' }, 'PUT')).json();
  assert.equal(updated.revision, record.revision + 1);
  const eml = await (await request('/exports', { format: 'eml', document })).text();
  assert(eml.includes(`Content-ID: <${image.id}@mail-studio>`));
  assert(eml.replace(/=\r?\n/g, '').includes(`cid:${image.id}@mail-studio`));
  assert(eml.includes('Content-Type: image/png'));
  assert.equal((await sql`SELECT published_key FROM assets WHERE id=${image.id}`)[0].published_key, null);
  const archive = await (await request('/exports', { format: 'archive', document })).arrayBuffer();
  const importedForm = new FormData();
  importedForm.append('file', new Blob([archive], { type: 'application/zip' }), 'verification.zip');
  const imported = await (await request('/imports', importedForm)).json();
  assert.notEqual(imported.id, record.id);
  const copy = await (await request('/exports', { format: 'copy', document })).json();
  assert(!/blob:|file:|cid:|\/api\/assets/.test(copy.html));
  const publicUrl = copy.html.match(/https:\/\/mail-studio\.s3\.fr-par\.scw\.cloud\/published\/[^"]+/)?.[0];
  assert(publicUrl, 'Permanent published URL missing');
  assert.equal((await fetch(publicUrl, { signal: AbortSignal.timeout(20000) })).status, 200);
  const asset = (await sql`SELECT object_key FROM assets WHERE id=${image.id}`)[0];
  assert([403, 404].includes((await fetch(`${process.env.ASSET_PUBLIC_BASE_URL}/${asset.object_key}`, { signal: AbortSignal.timeout(20000) })).status));
  await request(`/assets/${image.id}/revoke`, {});
  assert([403, 404].includes((await fetch(publicUrl, { cache: 'no-store', signal: AbortSignal.timeout(20000) })).status));
  console.log('PASS: live HTTPS sign-in, nested draft persistence, normalized upload, private image access, CID email without publication, archive import, permanent public clipboard images, and revocation.');
} finally {
  const assets = await sql`SELECT object_key,published_key FROM assets WHERE owner_id=${id}`;
  for (const asset of assets) {
    for (const key of [asset.object_key, asset.published_key].filter(Boolean)) {
      await storage.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
    }
  }
  await sql`DELETE FROM assets WHERE owner_id=${id}`;
  await sql`DELETE FROM users WHERE id=${id}`;
  await sql.end();
  storage.destroy();
}
