import { sql, relations } from 'drizzle-orm';
import {
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  unique,
  check,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { identitySchema } from '../logical-schemas.js';

/**
 * User account lifecycle statuses (DATABASE_SPEC.md Section 15.1)
 */
export const USER_STATUSES = [
  'ACTIVE',
  'SUSPENDED',
  'DISABLED',
  'PENDING_VERIFICATION',
] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * Authentication identity provider types (DATABASE_SPEC.md Section 16.1)
 */
export const AUTH_PROVIDERS = [
  'LOCAL_PASSWORD',
  'GOOGLE',
  'MAGIC_LINK',
] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

/**
 * Auth identity statuses
 */
export const AUTH_IDENTITY_STATUSES = [
  'ACTIVE',
  'SUSPENDED',
  'DISABLED',
] as const;
export type AuthIdentityStatus = (typeof AUTH_IDENTITY_STATUSES)[number];

/**
 * 15.1 identity.users
 * Central user profile entity.
 */
export const users = identitySchema.table(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    displayName: varchar('display_name', { length: 255 }),
    email: varchar('email', { length: 255 }),
    phone: varchar('phone', { length: 50 }),
    status: varchar('status', { length: 32 }).notNull().default('ACTIVE'),
    profileData: jsonb('profile_data').default({}),
    savedResourceVersionIds: uuid('saved_resource_version_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'chk_users_status',
      sql`${table.status} IN ('ACTIVE', 'SUSPENDED', 'DISABLED', 'PENDING_VERIFICATION')`,
    ),
    uniqueIndex('uq_users_active_email')
      .on(sql`lower(${table.email})`)
      .where(sql`${table.deletedAt} IS NULL AND ${table.email} IS NOT NULL`),
    index('idx_users_status').on(table.status),
  ],
);

/**
 * 16.1 identity.auth_identities
 * Credentials and auth identities separate from user profile.
 */
export const authIdentities = identitySchema.table(
  'auth_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 32 })
      .notNull()
      .default('LOCAL_PASSWORD'),
    providerSubject: varchar('provider_subject', { length: 255 }).notNull(),
    email: varchar('email', { length: 255 }),
    passwordHash: text('password_hash'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    status: varchar('status', { length: 32 }).notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_auth_identities_provider_subject').on(
      table.provider,
      table.providerSubject,
    ),
    check(
      'chk_auth_identities_status',
      sql`${table.status} IN ('ACTIVE', 'SUSPENDED', 'DISABLED')`,
    ),
    check(
      'chk_auth_identities_provider',
      sql`${table.provider} IN ('LOCAL_PASSWORD', 'GOOGLE', 'MAGIC_LINK')`,
    ),
    index('idx_auth_identities_user_id').on(table.userId),
    index('idx_auth_identities_email').on(sql`lower(${table.email})`),
  ],
);

/**
 * 16.2 identity.user_sessions
 * Server-managed sessions storing SHA-256 token hash (never plaintext tokens).
 */
export const userSessions = identitySchema.table(
  'user_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    deviceMetadata: jsonb('device_metadata').default({}),
  },
  (table) => [
    unique('uq_user_sessions_token_hash').on(table.tokenHash),
    index('idx_user_sessions_user_id').on(table.userId),
    index('idx_user_sessions_token_hash').on(table.tokenHash),
    index('idx_user_sessions_active')
      .on(table.tokenHash, table.expiresAt)
      .where(sql`${table.revokedAt} IS NULL`),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  authIdentities: many(authIdentities),
  userSessions: many(userSessions),
}));

export const authIdentitiesRelations = relations(authIdentities, ({ one }) => ({
  user: one(users, {
    fields: [authIdentities.userId],
    references: [users.id],
  }),
}));

export const userSessionsRelations = relations(userSessions, ({ one }) => ({
  user: one(users, {
    fields: [userSessions.userId],
    references: [users.id],
  }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AuthIdentity = typeof authIdentities.$inferSelect;
export type NewAuthIdentity = typeof authIdentities.$inferInsert;
export type UserSession = typeof userSessions.$inferSelect;
export type NewUserSession = typeof userSessions.$inferInsert;
