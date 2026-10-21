import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { hashPassword } from 'better-auth/crypto';
import { PutBucketVersioningCommand, PutBucketLifecycleConfigurationCommand, PutBucketPolicyCommand, GetBucketVersioningCommand, GetBucketLifecycleConfigurationCommand, ListObjectVersionsCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { config } from './config';
import { database } from './db';
import { account, user } from './schema';
import { ScalewayStorage } from './storage';
import { issueLink } from './auth';
const command = process.argv[2];
if (command === 'migrate' || command === 'admin') {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const { db, sql } = database(process.env.DATABASE_URL);
  try {
    if (command === 'migrate') {
      await migrate(db, { migrationsFolder: 'migrations' });
      console.log('Database migrations complete.');
    } else {
      const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
      const name = process.env.ADMIN_NAME?.trim() || 'Administrator';
      if (!email || !email.includes('@')) throw new Error('ADMIN_EMAIL is required');
      const id = crypto.randomUUID();
      // Bootstrap an unusable random password; a short-lived recovery link sets the real one.
      const password = await hashPassword(crypto.randomUUID() + crypto.randomUUID());
      await db.transaction(async tx => {
        await tx.insert(user).values({ id, email, name, role: 'admin' });
        await tx.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password });
      });
      const token = await issueLink(db, email, 'recover');
      console.log(`${process.env.PUBLIC_ORIGIN || 'http://localhost:5173'}/?token=${token}`);
    }
  } finally { await sql.end(); }
} else if (command === 'storage' || command === 'verify-storage') {
  const settings = config();
  const store = new ScalewayStorage(settings);
  const Bucket = settings.S3_BUCKET;
  if (command === 'storage') {
    if (!process.env.S3_APPLICATION_ID) throw new Error('S3_APPLICATION_ID is required for the dedicated bucket policy');
    if (!/^(user_id|application_id):[a-f0-9-]{36}$/.test(process.env.S3_PROVISIONER_PRINCIPAL ?? '')) throw new Error('S3_PROVISIONER_PRINCIPAL must identify the administrative identity to retain bucket management access');
    // Provision only a dedicated bucket. Never silently merge an unrelated bucket policy.
    if (process.env.CONFIRM_DEDICATED_BUCKET !== Bucket) throw new Error('Set CONFIRM_DEDICATED_BUCKET to the dedicated bucket name');
    await store.client.send(new PutBucketVersioningCommand({ Bucket, VersioningConfiguration: { Status: 'Enabled' } }));
    await store.client.send(new PutBucketLifecycleConfigurationCommand({
      Bucket, LifecycleConfiguration: { Rules: [{
        ID: 'mail-studio-old-versions', Status: 'Enabled', Filter: { Prefix: '' },
        NoncurrentVersionExpiration: { NoncurrentDays: 30 }, AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
      }] },
    }));
    await store.client.send(new PutBucketPolicyCommand({ Bucket, Policy: JSON.stringify({
      Version: '2023-04-17',
      Statement: [
        { Sid: 'BucketAdministration', Effect: 'Allow', Principal: { SCW: process.env.S3_PROVISIONER_PRINCIPAL }, Action: ['s3:*'], Resource: [Bucket, `${Bucket}/*`] },
        { Sid: 'ApplicationObjects', Effect: 'Allow', Principal: { SCW: `application_id:${process.env.S3_APPLICATION_ID}` }, Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'], Resource: [`${Bucket}/*`] },
        { Sid: 'ApplicationBucket', Effect: 'Allow', Principal: { SCW: `application_id:${process.env.S3_APPLICATION_ID}` }, Action: ['s3:ListBucket'], Resource: [Bucket] },
        { Sid: 'PublicPublishedImages', Effect: 'Allow', Principal: '*', Action: ['s3:GetObject'], Resource: [`${Bucket}/published/*`] },
      ],
    }) }));
    console.log('Dedicated bucket policy, versioning and lifecycle configured.');
  } else {
    const versioning = await store.client.send(new GetBucketVersioningCommand({ Bucket }));
    const lifecycle = await store.client.send(new GetBucketLifecycleConfigurationCommand({ Bucket }));
    if (versioning.Status !== 'Enabled' || !lifecycle.Rules?.some(r => r.NoncurrentVersionExpiration?.NoncurrentDays === 30)) throw new Error('Versioning or lifecycle is not configured');
    if (lifecycle.Rules?.some(r => r.Status === 'Enabled' && (r.Expiration || r.Transitions?.length))) throw new Error('Current objects must not expire or transition automatically');
    const id = crypto.randomUUID();
    const privateKey = `private/storage-check/${id}.txt`, publicKey = `published/storage-check/${id}.txt`;
    const bytes = Buffer.from(`mail-studio-${id}`);
    try {
      await store.put(privateKey, bytes, 'text/plain');
      if (![403, 404].includes((await fetch(store.url(privateKey))).status)) throw new Error('Private object access is not denied as expected');
      if ((await fetch(`${settings.ASSET_PUBLIC_BASE_URL}?list-type=2`)).status !== 403) throw new Error('Anonymous listing is not denied as expected');
      if ((await fetch(store.url(`private/storage-check/${id}-anonymous.txt`), { method: 'PUT', body: 'forbidden' })).status !== 403) throw new Error('Anonymous writes are not denied as expected');
      await store.publish(privateKey, publicKey, 'text/plain');
      const publicResponse = await fetch(store.url(publicKey));
      if (!publicResponse.ok || await publicResponse.text() !== bytes.toString()) throw new Error('Public image delivery failed');
      await store.delete(publicKey);
      if (![403, 404].includes((await fetch(store.url(publicKey), { cache: 'no-store' })).status)) throw new Error('Revocation did not deny access as expected');
      const versions = await store.client.send(new ListObjectVersionsCommand({ Bucket, Prefix: publicKey }));
      const version = versions.Versions?.find(v => v.Key === publicKey);
      if (!version) throw new Error('Recoverable object version missing');
      const restored = await store.client.send(new GetObjectCommand({ Bucket, Key: publicKey, VersionId: version.VersionId }));
      if (await restored.Body?.transformToString() !== bytes.toString()) throw new Error('Version recovery failed');
      console.log('Private access, anonymous restrictions, publication, revocation and version recovery verified.');
    } finally {
      await store.delete(privateKey); await store.delete(publicKey);
    }
  }
  store.client.destroy();
} else throw new Error('Usage: manage.ts migrate | admin | storage | verify-storage');
