import { sql, relations } from 'drizzle-orm';
import {
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  check,
  index,
  uniqueIndex,
  integer,
  bigint,
  jsonb,
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

/**
 * governance.audit_logs
 * Immutable, append-only centralized audit trail for cross-cutting platform operations.
 */
export const auditLogs = governanceSchema.table(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: varchar('event_id', { length: 64 }).notNull().unique(),
    action: varchar('action', { length: 64 }).notNull(),
    entityType: varchar('entity_type', { length: 64 }).notNull(),
    entityId: uuid('entity_id'),
    actorType: varchar('actor_type', { length: 20 }).notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    actorSnapshot: jsonb('actor_snapshot').notNull().default('{}'),
    outcome: varchar('outcome', { length: 20 }).notNull(),
    requestId: varchar('request_id', { length: 64 }),
    countryId: uuid('country_id').references(() => countries.id, {
      onDelete: 'set null',
    }),
    beforeState: jsonb('before_state'),
    afterState: jsonb('after_state'),
    context: jsonb('context').notNull().default('{}'),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'chk_audit_logs_actor_type',
      sql`actor_type IN ('AUTHENTICATED', 'ANONYMOUS', 'SYSTEM')`,
    ),
    check(
      'chk_audit_logs_outcome',
      sql`outcome IN ('SUCCESS', 'DENIED', 'FAILED')`,
    ),
    check(
      'chk_audit_logs_context_bytes',
      sql`octet_length(context::text) <= 4096`,
    ),
    check(
      'chk_audit_logs_actor_snapshot_bytes',
      sql`octet_length(actor_snapshot::text) <= 2048`,
    ),
    index('idx_audit_logs_occurred_action').on(table.occurredAt.desc(), table.action),
    index('idx_audit_logs_entity').on(table.entityType, table.entityId),
    index('idx_audit_logs_actor').on(table.actorUserId, table.occurredAt.desc()),
    index('idx_audit_logs_request_id').on(table.requestId),
  ],
);

/**
 * governance.retention_policies
 * Configurable data retention and lifecycle policies.
 */
export const retentionPolicies = governanceSchema.table(
  'retention_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    policyCode: varchar('policy_code', { length: 64 }).notNull().unique(),
    name: varchar('name', { length: 128 }).notNull(),
    description: text('description'),
    dataCategory: varchar('data_category', { length: 64 }).notNull(),
    targetIdentifier: varchar('target_identifier', { length: 64 }).notNull(),
    referencePoint: varchar('reference_point', { length: 64 }).notNull(),
    retentionDurationDays: integer('retention_duration_days').notNull(),
    disposition: varchar('disposition', { length: 20 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('DRAFT'),
    version: integer('version').notNull().default(1),
    legalBasis: text('legal_basis'),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    updatedBy: uuid('updated_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  () => [
    check('chk_retention_duration_days', sql`retention_duration_days > 0`),
    check('chk_retention_disposition', sql`disposition IN ('DELETE', 'ANONYMIZE', 'ARCHIVE')`),
    check('chk_retention_status', sql`status IN ('DRAFT', 'ACTIVE', 'INACTIVE', 'SUPERSEDED')`),
    check('chk_retention_version', sql`version >= 1`),
    check('chk_retention_audit_duration', sql`data_category != 'AUDIT_LOGS' OR retention_duration_days >= 2555`),
  ],
);

/**
 * governance.retention_policy_versions
 * Append-only immutable version snapshots of retention policies.
 */
export const retentionPolicyVersions = governanceSchema.table(
  'retention_policy_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    policyId: uuid('policy_id')
      .notNull()
      .references(() => retentionPolicies.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    policySnapshot: jsonb('policy_snapshot').notNull(),
    changeReason: text('change_reason').notNull(),
    changedBy: uuid('changed_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_retention_policy_version').on(table.policyId, table.version),
  ],
);

/**
 * governance.data_retention_actions
 * Durable execution tracking, audit checkpoints, and progress metrics for retention sweeps.
 */
export const dataRetentionActions = governanceSchema.table(
  'data_retention_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    executionId: varchar('execution_id', { length: 64 }).notNull().unique(),
    policyId: uuid('policy_id')
      .notNull()
      .references(() => retentionPolicies.id, { onDelete: 'restrict' }),
    policyVersion: integer('policy_version').notNull(),
    dataCategory: varchar('data_category', { length: 64 }).notNull(),
    action: varchar('action', { length: 20 }).notNull(),
    isDryRun: boolean('is_dry_run').notNull().default(false),
    status: varchar('status', { length: 20 }).notNull(),
    evaluatedCount: bigint('evaluated_count', { mode: 'number' }).notNull().default(0),
    affectedCount: bigint('affected_count', { mode: 'number' }).notNull().default(0),
    skippedCount: bigint('skipped_count', { mode: 'number' }).notNull().default(0),
    failedCount: bigint('failed_count', { mode: 'number' }).notNull().default(0),
    batchCount: integer('batch_count').notNull().default(0),
    cutoffTime: timestamp('cutoff_time', { withTimezone: true }).notNull(),
    fenceToken: integer('fence_token').notNull().default(1),
    workerId: varchar('worker_id', { length: 64 }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    resumedFromExecutionId: uuid('resumed_from_execution_id'),
    lastCursorId: uuid('last_cursor_id'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    executedBy: uuid('executed_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    errorMessage: varchar('error_message', { length: 1024 }),
    diagnosticData: jsonb('diagnostic_data').notNull().default('{}'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check('chk_retention_actions_action', sql`action IN ('DELETE', 'ANONYMIZE', 'ARCHIVE')`),
    check('chk_retention_actions_status', sql`status IN ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED')`),
    check('chk_retention_actions_diagnostic_bytes', sql`octet_length(diagnostic_data::text) <= 8192`),
    index('idx_retention_actions_policy_created').on(table.policyId, table.createdAt.desc()),
    index('idx_retention_actions_lease').on(table.status, table.leaseExpiresAt),
  ],
);

// Relations
export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  actorUser: one(users, {
    fields: [auditLogs.actorUserId],
    references: [users.id],
  }),
  country: one(countries, {
    fields: [auditLogs.countryId],
    references: [countries.id],
  }),
}));

export const retentionPoliciesRelations = relations(
  retentionPolicies,
  ({ one, many }) => ({
    creator: one(users, {
      fields: [retentionPolicies.createdBy],
      references: [users.id],
    }),
    updater: one(users, {
      fields: [retentionPolicies.updatedBy],
      references: [users.id],
    }),
    versions: many(retentionPolicyVersions),
    executions: many(dataRetentionActions),
  }),
);

export const retentionPolicyVersionsRelations = relations(
  retentionPolicyVersions,
  ({ one }) => ({
    policy: one(retentionPolicies, {
      fields: [retentionPolicyVersions.policyId],
      references: [retentionPolicies.id],
    }),
    changer: one(users, {
      fields: [retentionPolicyVersions.changedBy],
      references: [users.id],
    }),
  }),
);

export const dataRetentionActionsRelations = relations(
  dataRetentionActions,
  ({ one }) => ({
    policy: one(retentionPolicies, {
      fields: [dataRetentionActions.policyId],
      references: [retentionPolicies.id],
    }),
    executor: one(users, {
      fields: [dataRetentionActions.executedBy],
      references: [users.id],
    }),
  }),
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
export type RetentionPolicy = typeof retentionPolicies.$inferSelect;
export type NewRetentionPolicy = typeof retentionPolicies.$inferInsert;
export type RetentionPolicyVersion = typeof retentionPolicyVersions.$inferSelect;
export type NewRetentionPolicyVersion = typeof retentionPolicyVersions.$inferInsert;
export type DataRetentionAction = typeof dataRetentionActions.$inferSelect;
export type NewDataRetentionAction = typeof dataRetentionActions.$inferInsert;

