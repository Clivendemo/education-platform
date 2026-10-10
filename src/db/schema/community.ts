import { sql, relations } from 'drizzle-orm';
import {
  uuid,
  varchar,
  text,
  timestamp,
  bigint,
  integer,
  numeric,
  unique,
  check,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { communitySchema } from '../logical-schemas.js';
import { users } from './identity.js';
import { resources } from './resource.js';
import { orders, orderItems } from './commerce.js';

/**
 * Controlled Contributor Statuses (docs/DATABASE_SPEC.md Section 30.1)
 */
export const CONTRIBUTOR_STATUSES = [
  'ACTIVE',
  'PENDING_APPROVAL',
  'SUSPENDED',
  'INACTIVE',
] as const;
export type ContributorStatus = (typeof CONTRIBUTOR_STATUSES)[number];

/**
 * Controlled Contributor Verification Statuses (docs/DATABASE_SPEC.md Section 30.1)
 */
export const CONTRIBUTOR_VERIFICATION_STATUSES = [
  'UNVERIFIED',
  'PENDING',
  'VERIFIED',
  'REJECTED',
] as const;
export type ContributorVerificationStatus =
  (typeof CONTRIBUTOR_VERIFICATION_STATUSES)[number];

/**
 * Controlled Contributor Application Statuses (docs/DATABASE_SPEC.md Section 30.2)
 */
export const CONTRIBUTOR_APPLICATION_STATUSES = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
] as const;
export type ContributorApplicationStatus =
  (typeof CONTRIBUTOR_APPLICATION_STATUSES)[number];

/**
 * Controlled Contributor Submission Statuses (docs/DATABASE_SPEC.md Section 30.3)
 */
export const CONTRIBUTOR_SUBMISSION_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'PROCESSING',
  'REVIEW',
  'APPROVED',
  'REJECTED',
  'PUBLISHED',
] as const;
export type ContributorSubmissionStatus =
  (typeof CONTRIBUTOR_SUBMISSION_STATUSES)[number];

/**
 * Controlled Contributor Revenue Rule Statuses (docs/DATABASE_SPEC.md Section 30.6)
 */
export const CONTRIBUTOR_REVENUE_RULE_STATUSES = [
  'ACTIVE',
  'INACTIVE',
  'RETIRED',
] as const;
export type ContributorRevenueRuleStatus =
  (typeof CONTRIBUTOR_REVENUE_RULE_STATUSES)[number];

/**
 * Controlled Contributor Earning Statuses (docs/DATABASE_SPEC.md Section 30.7)
 */
export const CONTRIBUTOR_EARNING_STATUSES = [
  'PENDING',
  'AVAILABLE',
  'PAID',
  'CANCELLED',
] as const;
export type ContributorEarningStatus =
  (typeof CONTRIBUTOR_EARNING_STATUSES)[number];

/**
 * community.contributors
 * Decoupled educator/author profile linked to identity.users.
 */
export const contributors = communitySchema.table(
  'contributors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    displayName: varchar('display_name', { length: 100 }).notNull(),
    bio: text('bio'),
    profileSlug: varchar('profile_slug', { length: 100 }).notNull(),
    verificationStatus: varchar('verification_status', { length: 30 })
      .notNull()
      .default('UNVERIFIED'),
    status: varchar('status', { length: 30 }).notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    suspendedBy: uuid('suspended_by').references(() => users.id),
  },
  (table) => [
    unique('uq_contributors_user_id').on(table.userId),
    unique('uq_contributors_profile_slug').on(table.profileSlug),
    check(
      'chk_contributors_status',
      sql`${table.status} IN ('ACTIVE', 'PENDING_APPROVAL', 'SUSPENDED', 'INACTIVE')`,
    ),
    check(
      'chk_contributors_verification',
      sql`${table.verificationStatus} IN ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED')`,
    ),
    check(
      'chk_contributors_display_name',
      sql`length(trim(${table.displayName})) > 0 AND length(${table.displayName}) <= 100`,
    ),
    check(
      'chk_contributors_slug',
      sql`length(trim(${table.profileSlug})) > 0 AND ${table.profileSlug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`,
    ),
    check(
      'chk_contributors_suspension',
      sql`(${table.status} = 'SUSPENDED' AND ${table.suspendedAt} IS NOT NULL) OR (${table.status} != 'SUSPENDED')`,
    ),
    index('idx_contributors_status').on(table.status),
    index('idx_contributors_verification').on(table.verificationStatus),
  ],
);

/**
 * community.contributor_applications
 * Application workflow for users seeking contributor standing.
 */
export const contributorApplications = communitySchema.table(
  'contributor_applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    applicationText: text('application_text').notNull(),
    status: varchar('status', { length: 30 }).notNull().default('SUBMITTED'),
    reviewNotes: text('review_notes'),
    submittedAt: timestamp('submitted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
  },
  (table) => [
    check(
      'chk_contributor_app_status',
      sql`${table.status} IN ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED')`,
    ),
    check(
      'chk_contributor_app_text',
      sql`length(trim(${table.applicationText})) > 0`,
    ),
    check(
      'chk_contributor_app_review',
      sql`(${table.status} IN ('APPROVED', 'REJECTED') AND ${table.reviewedAt} IS NOT NULL AND ${table.reviewedBy} IS NOT NULL) OR (${table.status} IN ('SUBMITTED', 'UNDER_REVIEW'))`,
    ),
    check(
      'chk_contributor_app_rejection_notes',
      sql`(${table.status} = 'REJECTED' AND ${table.reviewNotes} IS NOT NULL AND length(trim(${table.reviewNotes})) > 0) OR (${table.status} != 'REJECTED')`,
    ),
    uniqueIndex('uq_contributor_active_application')
      .on(table.userId)
      .where(sql`${table.status} IN ('SUBMITTED', 'UNDER_REVIEW')`),
    index('idx_contributor_apps_user_id').on(table.userId),
    index('idx_contributor_apps_status').on(table.status),
  ],
);

/**
 * community.contributor_submissions
 * Controlled ingestion drafts created by contributors for editorial intake.
 */
export const contributorSubmissions = communitySchema.table(
  'contributor_submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contributorId: uuid('contributor_id')
      .notNull()
      .references(() => contributors.id, { onDelete: 'restrict' }),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    proposedPriceMinor: bigint('proposed_price_minor', { mode: 'number' }),
    proposedCurrencyCode: varchar('proposed_currency_code', { length: 3 }),
    status: varchar('status', { length: 30 }).notNull().default('DRAFT'),
    resourceId: uuid('resource_id').references(() => resources.id, {
      onDelete: 'set null',
    }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'chk_contributor_subs_status',
      sql`${table.status} IN ('DRAFT', 'SUBMITTED', 'PROCESSING', 'REVIEW', 'APPROVED', 'REJECTED', 'PUBLISHED')`,
    ),
    check(
      'chk_contributor_subs_title',
      sql`length(trim(${table.title})) > 0`,
    ),
    check(
      'chk_contributor_subs_pricing',
      sql`(${table.proposedPriceMinor} IS NULL AND ${table.proposedCurrencyCode} IS NULL) OR (${table.proposedPriceMinor} >= 0 AND ${table.proposedCurrencyCode} = 'KES')`,
    ),
    index('idx_contributor_subs_contributor_id').on(table.contributorId),
    index('idx_contributor_subs_status').on(table.status),
    index('idx_contributor_subs_resource_id').on(table.resourceId),
  ],
);

/**
 * community.contributor_revenue_rules
 * Historical and time-bound commission rules (Prompt 22 / docs/DATABASE_SPEC.md Section 30.6).
 */
export const contributorRevenueRules = communitySchema.table(
  'contributor_revenue_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 100 }).notNull(),
    contributorShareBasisPoints: integer('contributor_share_basis_points')
      .notNull()
      .default(7000),
    percentage: numeric('percentage', { precision: 7, scale: 4 })
      .notNull()
      .default('70.0000'),
    currencyCode: varchar('currency_code', { length: 3 })
      .notNull()
      .default('KES'),
    effectiveFrom: timestamp('effective_from', { withTimezone: true })
      .notNull()
      .defaultNow(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
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
      'chk_revenue_rules_status',
      sql`${table.status} IN ('ACTIVE', 'INACTIVE', 'RETIRED')`,
    ),
    check(
      'chk_revenue_rules_currency',
      sql`${table.currencyCode} = 'KES'`,
    ),
    check(
      'chk_revenue_rules_bps',
      sql`${table.contributorShareBasisPoints} >= 0 AND ${table.contributorShareBasisPoints} <= 10000`,
    ),
    check(
      'chk_revenue_rules_pct',
      sql`${table.percentage} >= 0 AND ${table.percentage} <= 100`,
    ),
    check(
      'chk_revenue_rules_dates',
      sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} >= ${table.effectiveFrom}`,
    ),
    index('idx_revenue_rules_status').on(table.status, table.effectiveFrom),
  ],
);

/**
 * community.contributor_earnings
 * Append-only immutable financial ledger of earnings attributed to contributors (Prompt 22 / docs/DATABASE_SPEC.md Section 30.7).
 */
export const contributorEarnings = communitySchema.table(
  'contributor_earnings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contributorId: uuid('contributor_id')
      .notNull()
      .references(() => contributors.id, { onDelete: 'restrict' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    orderItemId: uuid('order_item_id')
      .notNull()
      .references(() => orderItems.id, { onDelete: 'restrict' }),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'restrict' }),
    revenueRuleId: uuid('revenue_rule_id')
      .notNull()
      .references(() => contributorRevenueRules.id, { onDelete: 'restrict' }),
    grossAmountMinor: bigint('gross_amount_minor', { mode: 'bigint' }).notNull(),
    platformAmountMinor: bigint('platform_amount_minor', { mode: 'bigint' }).notNull(),
    contributorAmountMinor: bigint('contributor_amount_minor', { mode: 'bigint' }).notNull(),
    currencyCode: varchar('currency_code', { length: 3 })
      .notNull()
      .default('KES'),
    status: varchar('status', { length: 20 }).notNull().default('PENDING'),
    maturesAt: timestamp('matures_at', { withTimezone: true }).notNull(),
    maturedAt: timestamp('matured_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_earnings_order_item_contributor').on(
      table.orderItemId,
      table.contributorId,
    ),
    check(
      'chk_earnings_status',
      sql`${table.status} IN ('PENDING', 'AVAILABLE', 'PAID', 'CANCELLED')`,
    ),
    check(
      'chk_earnings_currency',
      sql`${table.currencyCode} = 'KES'`,
    ),
    check(
      'chk_earnings_amounts_positive',
      sql`${table.grossAmountMinor} >= 0 AND ${table.platformAmountMinor} >= 0 AND ${table.contributorAmountMinor} >= 0`,
    ),
    check(
      'chk_earnings_zero_sum',
      sql`${table.grossAmountMinor} = (${table.platformAmountMinor} + ${table.contributorAmountMinor})`,
    ),
    check(
      'chk_earnings_maturity',
      sql`(${table.status} = 'PENDING') OR (${table.status} = 'AVAILABLE' AND ${table.maturedAt} IS NOT NULL) OR (${table.status} IN ('PAID', 'CANCELLED'))`,
    ),
    index('idx_earnings_contributor_status').on(table.contributorId, table.status),
    index('idx_earnings_order_id').on(table.orderId),
    index('idx_earnings_resource_id').on(table.resourceId),
    index('idx_earnings_status_matures_at').on(table.status, table.maturesAt),
    index('idx_earnings_created_at').on(table.createdAt),
  ],
);

/**
 * Relations
 */
export const contributorsRelations = relations(contributors, ({ one, many }) => ({
  user: one(users, {
    fields: [contributors.userId],
    references: [users.id],
  }),
  suspendedByUser: one(users, {
    fields: [contributors.suspendedBy],
    references: [users.id],
  }),
  submissions: many(contributorSubmissions),
  resources: many(resources),
  earnings: many(contributorEarnings),
}));

export const contributorApplicationsRelations = relations(
  contributorApplications,
  ({ one }) => ({
    user: one(users, {
      fields: [contributorApplications.userId],
      references: [users.id],
    }),
    reviewedByUser: one(users, {
      fields: [contributorApplications.reviewedBy],
      references: [users.id],
    }),
  }),
);

export const contributorSubmissionsRelations = relations(
  contributorSubmissions,
  ({ one }) => ({
    contributor: one(contributors, {
      fields: [contributorSubmissions.contributorId],
      references: [contributors.id],
    }),
    resource: one(resources, {
      fields: [contributorSubmissions.resourceId],
      references: [resources.id],
    }),
    reviewedByUser: one(users, {
      fields: [contributorSubmissions.reviewedBy],
      references: [users.id],
    }),
  }),
);

export const contributorRevenueRulesRelations = relations(
  contributorRevenueRules,
  ({ many }) => ({
    earnings: many(contributorEarnings),
  }),
);

export const contributorEarningsRelations = relations(
  contributorEarnings,
  ({ one }) => ({
    contributor: one(contributors, {
      fields: [contributorEarnings.contributorId],
      references: [contributors.id],
    }),
    order: one(orders, {
      fields: [contributorEarnings.orderId],
      references: [orders.id],
    }),
    orderItem: one(orderItems, {
      fields: [contributorEarnings.orderItemId],
      references: [orderItems.id],
    }),
    resource: one(resources, {
      fields: [contributorEarnings.resourceId],
      references: [resources.id],
    }),
    revenueRule: one(contributorRevenueRules, {
      fields: [contributorEarnings.revenueRuleId],
      references: [contributorRevenueRules.id],
    }),
  }),
);

export type Contributor = typeof contributors.$inferSelect;
export type NewContributor = typeof contributors.$inferInsert;
export type ContributorApplication =
  typeof contributorApplications.$inferSelect;
export type NewContributorApplication =
  typeof contributorApplications.$inferInsert;
export type ContributorSubmission =
  typeof contributorSubmissions.$inferSelect;
export type NewContributorSubmission =
  typeof contributorSubmissions.$inferInsert;
export type ContributorRevenueRule =
  typeof contributorRevenueRules.$inferSelect;
export type NewContributorRevenueRule =
  typeof contributorRevenueRules.$inferInsert;
export type ContributorEarning =
  typeof contributorEarnings.$inferSelect;
export type NewContributorEarning =
  typeof contributorEarnings.$inferInsert;
