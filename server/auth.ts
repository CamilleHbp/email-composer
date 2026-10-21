import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { hashPassword } from 'better-auth/crypto';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Database } from './db';
import type { Config } from './config';
import * as schema from './schema';

export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export function createAuth(db: Database, config: Config) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    secret: config.BETTER_AUTH_SECRET,
    baseURL: config.PUBLIC_ORIGIN,
    trustedOrigins: [config.PUBLIC_ORIGIN],
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
    user: { additionalFields: { role: { type: 'string', defaultValue: 'user', input: false } } },
    advanced: { useSecureCookies: config.PUBLIC_ORIGIN.startsWith('https://') },
    rateLimit: { enabled: true },
  });
}
export async function issueLink(db: Database, email: string, purpose: 'invite' | 'recover') {
  const [existing] = await db.select().from(schema.user).where(eq(schema.user.email, email));
  if ((purpose === 'invite' && existing) || (purpose === 'recover' && !existing)) throw new Error('invalid_account');
  const token = randomBytes(32).toString('base64url');
  await db.insert(schema.invitations).values({
    hash: tokenHash(token), email, purpose, expiresAt: new Date(Date.now() + (purpose === 'invite' ? 72 : 1) * 3600000),
  });
  return token;
}
export async function redeemLink(db: Database, token: string, name: string, password: string) {
  const hashed = await hashPassword(password);
  await db.transaction(async tx => {
    const [invite] = await tx.update(schema.invitations).set({ usedAt: new Date() }).where(and(
      eq(schema.invitations.hash, tokenHash(token)), isNull(schema.invitations.usedAt), gt(schema.invitations.expiresAt, new Date()),
    )).returning();
    if (!invite) throw new Error('expired_link');
    if (invite.purpose === 'invite') {
      const id = crypto.randomUUID();
      await tx.insert(schema.user).values({ id, email: invite.email, name });
      await tx.insert(schema.account).values({ id: crypto.randomUUID(), accountId: id, userId: id, providerId: 'credential', password: hashed });
    } else {
      const [user] = await tx.select().from(schema.user).where(eq(schema.user.email, invite.email));
      if (!user) throw new Error('invalid_account');
      await tx.update(schema.account).set({ password: hashed, updatedAt: new Date() }).where(and(eq(schema.account.userId, user.id), eq(schema.account.providerId, 'credential')));
      await tx.delete(schema.session).where(eq(schema.session.userId, user.id));
    }
  });
}
