import { sql, relations } from 'drizzle-orm';
import {
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  check,
  index,
} from 'drizzle-orm/pg-core';
import { governanceSchema } from '../logical-schemas.js';
import { countries } from './geography.js';
import { resources, resourceVersions } from './resource.js';
import { users } from './identity.js';

/**
 * Controlled Quality Check Statuses
 */
export const QUALITY_CHECK_STATUSES = ['PASSED', 'FAILED', 'FLAGGED'] as const;
export type QualityCheckStatus = (typeof QUALITY_CHECK_STATUSES)[number];

/**
 * Controlled Verification Statuses
 */
export const VERIFICATION_STATUSES = ['VERIFIED', 'REVOKED'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/**
 * Controlled Quality Check Type Statuses
 */
export const CHECK_TYPE_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type CheckTypeStatus = (typeof CHECK_TYPE_STATUSES)[number];

/**
 * governance.quality_check_types
 * Configurable, auditable criteria taxonomy for assessing pedagogical quality.
 * Supports both global criteria (country_id IS NULL) and country-specific criteria.
 */
export const qualityCheckTypes = governanceSchema.table(
  'quality_check_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 50 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    countryId: uuid('country_id').references(() => countries.id, {
      onDelete: 'restrict',
    }),
    requiredForVerification: boolean('required_for_verification')
      .notNull()
      .default(true),
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'chk_quality_check_types_code',
      sql`length(trim(${table.code})) > 0 AND ${table.code} ~ '^[A-Z0-9_]+$'`,
    ),
    check(
      'chk_quality_check_types_name',
      sql`length(trim(${table.name})) > 0`,
    ),
    check(
      'chk_quality_check_types_status',
      sql`${table.status} IN ('ACTIVE', 'INACTIVE')`,
    ),
    index('idx_quality_check_types_status').on(table.status),
    index('idx_quality_check_types_country').on(table.countryId),
  ],
);

/**
 * governance.resource_quality_checks
 * Immutable append-only ledger recording individual quality rubric evaluations.
 * Preserves complete reviewer audit history across repeated evaluation cycles.
 */
export const resourceQualityChecks = governanceSchema.table(
  'resource_quality_checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'restrict' }),
    resourceVersionId: uuid('resource_version_id')
      .notNull()
      .references(() => resourceVersions.id, { onDelete: 'restrict' }),
    checkTypeId: uuid('check_type_id')
      .notNull()
      .references(() => qualityCheckTypes.id, { onDelete: 'restrict' }),
    status: varchar('status', { length: 20 }).notNull(),
    notes: text('notes'),
    checkedBy: uuid('checked_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    checkedAt: timestamp('checked_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'chk_resource_quality_checks_status',
      sql`${table.status} IN ('PASSED', 'FAILED', 'FLAGGED')`,
    ),
    index('idx_res_quality_checks_version_type_date').on(
      table.resourceVersionId,
      table.checkTypeId,
      table.checkedAt,
    ),
    index('idx_res_quality_checks_resource_id').on(table.resourceId),
    index('idx_res_quality_checks_checked_by').on(table.checkedBy),
  ],
);

/**
 * governance.resource_verifications
 * Auditable, stateful verification lifecycle ledger.
 * Tracks official pedagogical verification grant and revocation with actor accountability.
 */
export const resourceVerifications = governanceSchema.table(
  'resource_verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'restrict' }),
    resourceVersionId: uuid('resource_version_id')
      .notNull()
      .references(() => resourceVersions.id, { onDelete: 'restrict' }),
    verificationStatus: varchar('verification_status', { length: 20 }).notNull(),
    reason: text('reason'),
    verifiedBy: uuid('verified_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    verifiedAt: timestamp('verified_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedBy: uuid('revoked_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'chk_res_verifications_status',
      sql`${table.verificationStatus} IN ('VERIFIED', 'REVOKED')`,
    ),
    check(
      'chk_res_verifications_revocation',
      sql`(${table.verificationStatus} = 'REVOKED' AND ${table.revokedAt} IS NOT NULL AND ${table.revokedBy} IS NOT NULL AND ${table.reason} IS NOT NULL AND length(trim(${table.reason})) > 0) OR (${table.verificationStatus} = 'VERIFIED' AND ${table.revokedAt} IS NULL)`,
    ),
    index('idx_res_verifications_resource_id').on(table.resourceId),
    index('idx_res_verifications_version_id').on(table.resourceVersionId),
    index('idx_res_verifications_status').on(table.verificationStatus),
  ],
);

// Drizzle Relations
export const qualityCheckTypesRelations = relations(
  qualityCheckTypes,
  ({ one, many }) => ({
    country: one(countries, {
      fields: [qualityCheckTypes.countryId],
      references: [countries.id],
    }),
    checks: many(resourceQualityChecks),
  }),
);

export const resourceQualityChecksRelations = relations(
  resourceQualityChecks,
  ({ one }) => ({
    resource: one(resources, {
      fields: [resourceQualityChecks.resourceId],
      references: [resources.id],
    }),
    resourceVersion: one(resourceVersions, {
      fields: [resourceQualityChecks.resourceVersionId],
      references: [resourceVersions.id],
    }),
    checkType: one(qualityCheckTypes, {
      fields: [resourceQualityChecks.checkTypeId],
      references: [qualityCheckTypes.id],
    }),
    reviewer: one(users, {
      fields: [resourceQualityChecks.checkedBy],
      references: [users.id],
    }),
  }),
);

export const resourceVerificationsRelations = relations(
  resourceVerifications,
  ({ one }) => ({
    resource: one(resources, {
      fields: [resourceVerifications.resourceId],
      references: [resources.id],
    }),
    resourceVersion: one(resourceVersions, {
      fields: [resourceVerifications.resourceVersionId],
      references: [resourceVersions.id],
    }),
    verifier: one(users, {
      fields: [resourceVerifications.verifiedBy],
      references: [users.id],
    }),
    revoker: one(users, {
      fields: [resourceVerifications.revokedBy],
      references: [users.id],
    }),
  }),
);

export type QualityCheckType = typeof qualityCheckTypes.$inferSelect;
export type NewQualityCheckType = typeof qualityCheckTypes.$inferInsert;
export type ResourceQualityCheck = typeof resourceQualityChecks.$inferSelect;
export type NewResourceQualityCheck = typeof resourceQualityChecks.$inferInsert;
export type ResourceVerification = typeof resourceVerifications.$inferSelect;
export type NewResourceVerification = typeof resourceVerifications.$inferInsert;
