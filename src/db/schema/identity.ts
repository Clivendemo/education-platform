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
  primaryKey,
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
 * Role statuses (DATABASE_SPEC.md Section 17.1)
 */
export const ROLE_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type RoleStatus = (typeof ROLE_STATUSES)[number];

/**
 * Role types (DATABASE_SPEC.md Section 17.1)
 */
export const ROLE_TYPES = ['SYSTEM', 'ORGANIZATIONAL', 'CUSTOM'] as const;
export type RoleType = (typeof ROLE_TYPES)[number];

/**
 * Permission statuses (DATABASE_SPEC.md Section 17.2)
 */
export const PERMISSION_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type PermissionStatus = (typeof PERMISSION_STATUSES)[number];

/**
 * Permission allowed scope types (Correction 5)
 */
export const PERMISSION_SCOPE_TYPES = ['GLOBAL', 'SCOPED', 'ANY'] as const;
export type PermissionScopeType = (typeof PERMISSION_SCOPE_TYPES)[number];

/**
 * User role assignment statuses (DATABASE_SPEC.md Section 17.4)
 */
export const USER_ROLE_STATUSES = ['ACTIVE', 'REVOKED', 'EXPIRED'] as const;
export type UserRoleStatus = (typeof USER_ROLE_STATUSES)[number];

/**
 * User role scope types (DATABASE_SPEC.md Section 17.4, 20)
 */
export const USER_ROLE_SCOPE_TYPES = ['COUNTRY', 'SCHOOL', 'RESOURCE'] as const;
export type UserRoleScopeType = (typeof USER_ROLE_SCOPE_TYPES)[number];

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
  userRoles: many(userRoles),
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

/**
 * 17.1 identity.roles
 * Canonical and custom platform roles.
 */
export const roles = identitySchema.table(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 50 }).notNull(),
    description: text('description'),
    roleType: varchar('role_type', { length: 32 }).notNull().default('SYSTEM'),
    status: varchar('status', { length: 32 }).notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_roles_slug').on(table.slug),
    check('chk_roles_status', sql`${table.status} IN ('ACTIVE', 'INACTIVE')`),
    check(
      'chk_roles_type',
      sql`${table.roleType} IN ('SYSTEM', 'ORGANIZATIONAL', 'CUSTOM')`,
    ),
    index('idx_roles_status').on(table.status),
  ],
);

/**
 * 17.2 identity.permissions
 * Fine-grained resource action permissions.
 */
export const permissions = identitySchema.table(
  'permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 100 }).notNull(),
    resource: varchar('resource', { length: 50 }).notNull(),
    action: varchar('action', { length: 50 }).notNull(),
    scopeType: varchar('scope_type', { length: 32 }).notNull().default('ANY'),
    description: text('description'),
    status: varchar('status', { length: 32 }).notNull().default('ACTIVE'),
  },
  (table) => [
    unique('uq_permissions_name').on(table.name),
    check(
      'chk_permissions_status',
      sql`${table.status} IN ('ACTIVE', 'INACTIVE')`,
    ),
    check(
      'chk_permissions_scope_type',
      sql`${table.scopeType} IN ('GLOBAL', 'SCOPED', 'ANY')`,
    ),
    index('idx_permissions_resource_action').on(table.resource, table.action),
  ],
);

/**
 * 17.3 identity.role_permissions
 * Join table mapping roles to their granted permissions.
 */
export const rolePermissions = identitySchema.table(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.roleId, table.permissionId],
      name: 'pk_role_permissions',
    }),
    index('idx_role_permissions_permission_id').on(table.permissionId),
  ],
);

/**
 * 17.4 identity.user_roles
 * User role assignments, supporting global and scoped roles, expiration, and auditability.
 */
export const userRoles = identitySchema.table(
  'user_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    scopeType: varchar('scope_type', { length: 32 }),
    scopeId: uuid('scope_id'),
    status: varchar('status', { length: 32 }).notNull().default('ACTIVE'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    check(
      'chk_user_roles_status',
      sql`${table.status} IN ('ACTIVE', 'REVOKED', 'EXPIRED')`,
    ),
    check(
      'chk_user_roles_scope_type',
      sql`${table.scopeType} IS NULL OR ${table.scopeType} IN ('COUNTRY', 'SCHOOL', 'RESOURCE')`,
    ),
    check(
      'chk_user_roles_scope_consistency',
      sql`(${table.scopeType} IS NULL AND ${table.scopeId} IS NULL) OR (${table.scopeType} IS NOT NULL AND ${table.scopeId} IS NOT NULL)`,
    ),
    check(
      'chk_user_roles_dates',
      sql`${table.endsAt} IS NULL OR ${table.startsAt} IS NULL OR ${table.endsAt} > ${table.startsAt}`,
    ),
    uniqueIndex('uq_user_roles_active')
      .on(
        table.userId,
        table.roleId,
        sql`COALESCE(${table.scopeType}, '')`,
        sql`COALESCE(${table.scopeId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      )
      .where(sql`${table.status} = 'ACTIVE'`),
    index('idx_user_roles_user_id').on(table.userId),
    index('idx_user_roles_role_id').on(table.roleId),
    index('idx_user_roles_scope').on(table.scopeType, table.scopeId),
  ],
);

export const rolesRelations = relations(roles, ({ many }) => ({
  rolePermissions: many(rolePermissions),
  userRoles: many(userRoles),
}));

export const permissionsRelations = relations(permissions, ({ many }) => ({
  rolePermissions: many(rolePermissions),
}));

export const rolePermissionsRelations = relations(
  rolePermissions,
  ({ one }) => ({
    role: one(roles, {
      fields: [rolePermissions.roleId],
      references: [roles.id],
    }),
    permission: one(permissions, {
      fields: [rolePermissions.permissionId],
      references: [permissions.id],
    }),
  }),
);

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, {
    fields: [userRoles.userId],
    references: [users.id],
  }),
  role: one(roles, {
    fields: [userRoles.roleId],
    references: [roles.id],
  }),
  creator: one(users, {
    fields: [userRoles.createdBy],
    references: [users.id],
  }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AuthIdentity = typeof authIdentities.$inferSelect;
export type NewAuthIdentity = typeof authIdentities.$inferInsert;
export type UserSession = typeof userSessions.$inferSelect;
export type NewUserSession = typeof userSessions.$inferInsert;
export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;
export type Permission = typeof permissions.$inferSelect;
export type NewPermission = typeof permissions.$inferInsert;
export type RolePermission = typeof rolePermissions.$inferSelect;
export type NewRolePermission = typeof rolePermissions.$inferInsert;
export type UserRole = typeof userRoles.$inferSelect;
export type NewUserRole = typeof userRoles.$inferInsert;
