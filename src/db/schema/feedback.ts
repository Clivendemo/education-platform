import { sql, relations } from 'drizzle-orm';
import {
  uuid,
  varchar,
  text,
  timestamp,
  check,
  index,
} from 'drizzle-orm/pg-core';
import { contentSchema } from '../logical-schemas.js';
import { resources, resourceVersions } from './resource.js';
import { users } from './identity.js';

/**
 * 7 Canonical Controlled Feedback Categories from DATABASE_SPEC.md Section 24.1
 */
export const FEEDBACK_TYPES = [
  'HELPFUL',
  'OUTDATED',
  'INCORRECT',
  'MISSING_INFORMATION',
  'POOR_FORMATTING',
  'WRONG_CLASSIFICATION',
  'FILE_PROBLEM',
] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

/**
 * Controlled Feedback Triage Lifecycle Statuses
 */
export const FEEDBACK_STATUSES = [
  'PENDING',
  'UNDER_REVIEW',
  'ACCEPTED',
  'REJECTED',
  'REOPENED',
] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/**
 * content.resource_feedback
 * Controlled, auditable feedback submitted by anonymous visitors or registered users.
 */
export const resourceFeedback = contentSchema.table(
  'resource_feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'restrict' }),
    resourceVersionId: uuid('resource_version_id')
      .notNull()
      .references(() => resourceVersions.id, { onDelete: 'restrict' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'restrict' }),
    sessionId: varchar('session_id', { length: 64 }), // SHA-256 hex digest of rf_sid cookie
    feedbackType: varchar('feedback_type', { length: 32 }).notNull(),
    details: text('details'),
    status: varchar('status', { length: 20 }).notNull().default('PENDING'),
    reviewedBy: uuid('reviewed_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'chk_feedback_type',
      sql`${table.feedbackType} IN ('HELPFUL', 'OUTDATED', 'INCORRECT', 'MISSING_INFORMATION', 'POOR_FORMATTING', 'WRONG_CLASSIFICATION', 'FILE_PROBLEM')`,
    ),
    check(
      'chk_feedback_status',
      sql`${table.status} IN ('PENDING', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'REOPENED')`,
    ),
    check(
      'chk_feedback_exactly_one_identity',
      sql`(${table.userId} IS NOT NULL AND ${table.sessionId} IS NULL) OR (${table.userId} IS NULL AND ${table.sessionId} IS NOT NULL)`,
    ),
    check(
      'chk_feedback_details_len',
      sql`${table.details} IS NULL OR (length(trim(${table.details})) > 0 AND length(${table.details}) <= 1000)`,
    ),
    check(
      'chk_feedback_reviewed',
      sql`(${table.status} = 'PENDING' AND ${table.reviewedAt} IS NULL AND ${table.reviewedBy} IS NULL) OR (${table.status} != 'PENDING')`,
    ),
    index('idx_resource_feedback_resource_id').on(table.resourceId),
    index('idx_resource_feedback_version_id').on(table.resourceVersionId),
    index('idx_resource_feedback_status').on(table.status),
    index('idx_resource_feedback_type').on(table.feedbackType),
    index('idx_resource_feedback_user_id').on(table.userId),
    index('idx_resource_feedback_session_id').on(table.sessionId),
    index('idx_resource_feedback_created_at').on(table.createdAt),
  ],
);

/**
 * content.resource_feedback_events
 * Immutable append-only audit ledger tracking feedback triage state transitions.
 */
export const resourceFeedbackEvents = contentSchema.table(
  'resource_feedback_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    feedbackId: uuid('feedback_id')
      .notNull()
      .references(() => resourceFeedback.id, { onDelete: 'restrict' }),
    fromStatus: varchar('from_status', { length: 20 }).notNull(),
    toStatus: varchar('to_status', { length: 20 }).notNull(),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    internalNote: text('internal_note'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'chk_feedback_events_from_status',
      sql`${table.fromStatus} IN ('PENDING', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'REOPENED')`,
    ),
    check(
      'chk_feedback_events_to_status',
      sql`${table.toStatus} IN ('PENDING', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'REOPENED')`,
    ),
    check(
      'chk_feedback_events_note_len',
      sql`${table.internalNote} IS NULL OR length(${table.internalNote}) <= 2000`,
    ),
    index('idx_res_feedback_events_feedback_id').on(table.feedbackId),
    index('idx_res_feedback_events_created_at').on(table.createdAt),
    index('idx_res_feedback_events_actor').on(table.actorUserId),
  ],
);

// Drizzle Relations
export const resourceFeedbackRelations = relations(
  resourceFeedback,
  ({ one, many }) => ({
    resource: one(resources, {
      fields: [resourceFeedback.resourceId],
      references: [resources.id],
    }),
    resourceVersion: one(resourceVersions, {
      fields: [resourceFeedback.resourceVersionId],
      references: [resourceVersions.id],
    }),
    user: one(users, {
      fields: [resourceFeedback.userId],
      references: [users.id],
    }),
    reviewer: one(users, {
      fields: [resourceFeedback.reviewedBy],
      references: [users.id],
    }),
    events: many(resourceFeedbackEvents),
  }),
);

export const resourceFeedbackEventsRelations = relations(
  resourceFeedbackEvents,
  ({ one }) => ({
    feedback: one(resourceFeedback, {
      fields: [resourceFeedbackEvents.feedbackId],
      references: [resourceFeedback.id],
    }),
    actor: one(users, {
      fields: [resourceFeedbackEvents.actorUserId],
      references: [users.id],
    }),
  }),
);

export type ResourceFeedback = typeof resourceFeedback.$inferSelect;
export type NewResourceFeedback = typeof resourceFeedback.$inferInsert;
export type ResourceFeedbackEvent = typeof resourceFeedbackEvents.$inferSelect;
export type NewResourceFeedbackEvent = typeof resourceFeedbackEvents.$inferInsert;
