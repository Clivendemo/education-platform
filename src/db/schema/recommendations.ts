import { sql, relations } from 'drizzle-orm';
import {
  uuid,
  integer,
  text,
  timestamp,
  foreignKey,
  check,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { contentSchema } from '../logical-schemas.js';
import { countries } from './geography.js';
import { topics } from './curriculum.js';
import { resources } from './resource.js';
import { users } from './identity.js';

export const RECOMMENDATION_RULE_TYPES = ['PIN', 'EXCLUDE'] as const;
export type RecommendationRuleType = (typeof RECOMMENDATION_RULE_TYPES)[number];

export const RECOMMENDATION_RULE_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type RecommendationRuleStatus = (typeof RECOMMENDATION_RULE_STATUSES)[number];

export const recommendationRuleTypeEnum = contentSchema.enum(
  'recommendation_rule_type',
  RECOMMENDATION_RULE_TYPES,
);

export const recommendationRuleStatusEnum = contentSchema.enum(
  'recommendation_rule_status',
  RECOMMENDATION_RULE_STATUSES,
);

/**
 * content.resource_recommendation_rules
 * Country-scoped editorial PIN and EXCLUDE rules (audited soft-deactivation; physical DELETE disallowed).
 */
export const resourceRecommendationRules = contentSchema.table(
  'resource_recommendation_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    countryId: uuid('country_id')
      .notNull()
      .references(() => countries.id, { onDelete: 'restrict' }),
    ruleType: recommendationRuleTypeEnum('rule_type').notNull(),
    status: recommendationRuleStatusEnum('status').notNull().default('ACTIVE'),
    sourceResourceId: uuid('source_resource_id'),
    sourceTopicId: uuid('source_topic_id').references(() => topics.id, {
      onDelete: 'restrict',
    }),
    targetResourceId: uuid('target_resource_id').notNull(),
    priority: integer('priority'),
    reason: text('reason').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deactivatedBy: uuid('deactivated_by').references(() => users.id, {
      onDelete: 'restrict',
    }),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
    deactivationReason: text('deactivation_reason'),
  },
  (table) => [
    foreignKey({
      name: 'fk_rec_rules_target_resource_country',
      columns: [table.targetResourceId, table.countryId],
      foreignColumns: [resources.id, resources.countryId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_rec_rules_source_resource_country',
      columns: [table.sourceResourceId, table.countryId],
      foreignColumns: [resources.id, resources.countryId],
    }).onDelete('restrict'),
    check(
      'chk_rec_rules_scope_xor',
      sql`(${table.sourceResourceId} IS NOT NULL AND ${table.sourceTopicId} IS NULL) OR (${table.sourceResourceId} IS NULL AND ${table.sourceTopicId} IS NOT NULL)`,
    ),
    check(
      'chk_rec_rules_priority',
      sql`(${table.ruleType} = 'PIN' AND ${table.priority} BETWEEN 1 AND 10) OR (${table.ruleType} = 'EXCLUDE' AND ${table.priority} IS NULL)`,
    ),
    check(
      'chk_rec_rules_no_self_target',
      sql`${table.sourceResourceId} IS DISTINCT FROM ${table.targetResourceId}`,
    ),
    check(
      'chk_rec_rules_reason_not_empty',
      sql`length(trim(${table.reason})) >= 3`,
    ),
    check(
      'chk_rec_rules_deactivation_state',
      sql`(${table.status} = 'ACTIVE' AND ${table.deactivatedAt} IS NULL AND ${table.deactivatedBy} IS NULL AND ${table.deactivationReason} IS NULL) OR (${table.status} = 'INACTIVE' AND ${table.deactivatedAt} IS NOT NULL AND ${table.deactivatedBy} IS NOT NULL AND ${table.deactivationReason} IS NOT NULL AND length(trim(${table.deactivationReason})) >= 3)`,
    ),
    uniqueIndex('uq_rec_rules_active_source_resource_target')
      .on(table.sourceResourceId, table.targetResourceId)
      .where(sql`${table.status} = 'ACTIVE' AND ${table.sourceResourceId} IS NOT NULL`),
    uniqueIndex('uq_rec_rules_active_source_topic_target')
      .on(table.sourceTopicId, table.targetResourceId)
      .where(sql`${table.status} = 'ACTIVE' AND ${table.sourceTopicId} IS NOT NULL`),
    index('idx_rec_rules_active_res_lookup')
      .on(table.countryId, table.sourceResourceId, table.ruleType, table.priority)
      .where(sql`${table.status} = 'ACTIVE' AND ${table.sourceResourceId} IS NOT NULL`),
    index('idx_rec_rules_active_topic_lookup')
      .on(table.countryId, table.sourceTopicId, table.ruleType, table.priority)
      .where(sql`${table.status} = 'ACTIVE' AND ${table.sourceTopicId} IS NOT NULL`),
  ],
);

export const resourceRecommendationRulesRelations = relations(
  resourceRecommendationRules,
  ({ one }) => ({
    country: one(countries, {
      fields: [resourceRecommendationRules.countryId],
      references: [countries.id],
    }),
    sourceResource: one(resources, {
      fields: [resourceRecommendationRules.sourceResourceId],
      references: [resources.id],
      relationName: 'recommendationSourceResource',
    }),
    targetResource: one(resources, {
      fields: [resourceRecommendationRules.targetResourceId],
      references: [resources.id],
      relationName: 'recommendationTargetResource',
    }),
    sourceTopic: one(topics, {
      fields: [resourceRecommendationRules.sourceTopicId],
      references: [topics.id],
    }),
    creator: one(users, {
      fields: [resourceRecommendationRules.createdBy],
      references: [users.id],
      relationName: 'recommendationRuleCreator',
    }),
    deactivator: one(users, {
      fields: [resourceRecommendationRules.deactivatedBy],
      references: [users.id],
      relationName: 'recommendationRuleDeactivator',
    }),
  }),
);

export type ResourceRecommendationRule = typeof resourceRecommendationRules.$inferSelect;
export type NewResourceRecommendationRule = typeof resourceRecommendationRules.$inferInsert;
