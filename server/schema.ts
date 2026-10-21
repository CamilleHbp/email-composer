import { pgTable, text, timestamp, boolean, integer, jsonb, uuid, index } from 'drizzle-orm/pg-core';
import type { EmailDocument } from '../shared/model';

export const user = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  role: text('role').notNull().default('user'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
export const session = pgTable('sessions', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
  ipAddress: text('ip_address'), userAgent: text('user_agent'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
export const account = pgTable('accounts', {
  id: text('id').primaryKey(), accountId: text('account_id').notNull(), providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'), refreshToken: text('refresh_token'), idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'), refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'), password: text('password'),
  createdAt: timestamp('created_at').notNull().defaultNow(), updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
export const verification = pgTable('verifications', {
  id: text('id').primaryKey(), identifier: text('identifier').notNull(), value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(), updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey().defaultRandom(), hash: text('hash').notNull().unique(),
  email: text('email').notNull(), purpose: text('purpose').notNull(),
  expiresAt: timestamp('expires_at').notNull(), usedAt: timestamp('used_at'),
});
export const collections = pgTable('collections', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: text('owner_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
});
export const templates = pgTable('templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: text('owner_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), kind: text('kind').notNull().default('draft'),
  document: jsonb('document').$type<EmailDocument>().notNull(),
  revision: integer('revision').notNull().default(1), shared: boolean('shared').notNull().default(false),
  collectionId: uuid('collection_id').references(() => collections.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, t => [index('templates_owner_idx').on(t.ownerId)]);
export const assets = pgTable('assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: text('owner_id').notNull().references(() => user.id),
  key: text('object_key').notNull().unique(), publishedKey: text('published_key').unique(),
  publicationNonce: uuid('publication_nonce').notNull().defaultRandom(),
  name: text('name').notNull(), mime: text('mime').notNull(), bytes: integer('bytes').notNull(),
  width: integer('width').notNull(), height: integer('height').notNull(),
  sha256: text('sha256').notNull(), createdAt: timestamp('created_at').notNull().defaultNow(),
}, t => [index('assets_owner_idx').on(t.ownerId)]);
