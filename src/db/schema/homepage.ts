import { sql, relations } from 'drizzle-orm';
import {
  uuid,
  integer,
  smallint,
  varchar,
  text,
  timestamp,
  foreignKey,
  unique,
  uniqueIndex,
  index,
  check,
  customType,
} from 'drizzle-orm/pg-core';
import { contentSchema } from '../logical-schemas.js';
import { countries } from './geography.js';
import { subjects } from './curriculum.js';
import { resources } from './resource.js';
import { educationUpdates } from './updates.js';
import { calendarEvents } from './calendar.js';
import { users } from './identity.js';

export const HOMEPAGE_CONFIG_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'PUBLISHED',
  'SUPERSEDED',
  'ROLLED_BACK',
  'ARCHIVED',
  'DISCARDED',
] as const;
export type HomepageConfigStatus = (typeof HOMEPAGE_CONFIG_STATUSES)[number];

/**
 * Canonical 6 Homepage Slots in locked order 1..6 (Decision D1 / R17-02).
 */
export const HOMEPAGE_SLOT_KEYS = [
  'trending_resources',
  'most_downloaded_resources',
  'curated_resources',
  'education_updates',
  'calendar_highlights',
  'curriculum_shortcuts',
] as const;
export type HomepageSlotKey = (typeof HOMEPAGE_SLOT_KEYS)[number];

export const HOMEPAGE_SLOT_MODES = [
  'AUTOMATED',
  'CURATED_HYBRID',
  'MANUAL_OVERRIDE',
] as const;
export type HomepageSlotMode = (typeof HOMEPAGE_SLOT_MODES)[number];

export const HOMEPAGE_ENTITY_TYPES = [
  'RESOURCE',
  'UPDATE',
  'CALENDAR_EVENT',
  'SUBJECT',
] as const;
export type HomepageEntityType = (typeof HOMEPAGE_ENTITY_TYPES)[number];

export interface CanonicalSlotSpec {
  slotKey: HomepageSlotKey;
  slotOrder: 1 | 2 | 3 | 4 | 5 | 6;
  entityType: HomepageEntityType;
  defaultTitle: string;
  defaultSubtitle: string;
  defaultMaxItems: 6;
}

export const CANONICAL_HOMEPAGE_SLOTS: readonly CanonicalSlotSpec[] = [
  {
    slotKey: 'trending_resources',
    slotOrder: 1,
    entityType: 'RESOURCE',
    defaultTitle: 'Trending Resources',
    defaultSubtitle: 'Popular curriculum-aligned materials engaging educators and learners now.',
    defaultMaxItems: 6,
  },
  {
    slotKey: 'most_downloaded_resources',
    slotOrder: 2,
    entityType: 'RESOURCE',
    defaultTitle: 'Most Downloaded Resources',
    defaultSubtitle: 'Essential classroom documents and past papers downloaded across schools.',
    defaultMaxItems: 6,
  },
  {
    slotKey: 'curated_resources',
    slotOrder: 3,
    entityType: 'RESOURCE',
    defaultTitle: 'Curated Resources',
    defaultSubtitle: 'Editorially verified teaching and revision materials selected for quality.',
    defaultMaxItems: 6,
  },
  {
    slotKey: 'education_updates',
    slotOrder: 4,
    entityType: 'UPDATE',
    defaultTitle: 'Education Updates',
    defaultSubtitle: 'Official circulars, curriculum notices, and national education advisories.',
    defaultMaxItems: 6,
  },
  {
    slotKey: 'calendar_highlights',
    slotOrder: 5,
    entityType: 'CALENDAR_EVENT',
    defaultTitle: 'Calendar Highlights',
    defaultSubtitle: 'Upcoming term dates, national examinations, and official academic milestones.',
    defaultMaxItems: 6,
  },
  {
    slotKey: 'curriculum_shortcuts',
    slotOrder: 6,
    entityType: 'SUBJECT',
    defaultTitle: 'Curriculum Shortcuts',
    defaultSubtitle: 'Browse published learning materials directly by active grade and subject.',
    defaultMaxItems: 6,
  },
] as const;

export const CANONICAL_SLOT_BY_KEY: Readonly<Record<HomepageSlotKey, CanonicalSlotSpec>> = {
  trending_resources: CANONICAL_HOMEPAGE_SLOTS[0],
  most_downloaded_resources: CANONICAL_HOMEPAGE_SLOTS[1],
  curated_resources: CANONICAL_HOMEPAGE_SLOTS[2],
  education_updates: CANONICAL_HOMEPAGE_SLOTS[3],
  calendar_highlights: CANONICAL_HOMEPAGE_SLOTS[4],
  curriculum_shortcuts: CANONICAL_HOMEPAGE_SLOTS[5],
};

const xid8Column = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'xid8';
  },
  fromDriver(value: string): string {
    return String(value);
  },
});

export const homepageConfigStatusEnum = contentSchema.enum(
  'homepage_config_status',
  HOMEPAGE_CONFIG_STATUSES,
);

export const homepageSlotKeyEnum = contentSchema.enum(
  'homepage_slot_key',
  HOMEPAGE_SLOT_KEYS,
);

export const homepageSlotModeEnum = contentSchema.enum(
  'homepage_slot_mode',
  HOMEPAGE_SLOT_MODES,
);

export const homepageEntityTypeEnum = contentSchema.enum(
  'homepage_entity_type',
  HOMEPAGE_ENTITY_TYPES,
);

/**
 * content.homepage_configurations (25 columns)
 * Country-scoped, versioned editorial homepage configurations with scheduled windows,
 * single-active-draft / single-published partial unique indexes, and GiST schedule exclusion.
 */
export const homepageConfigurations = contentSchema.table(
  'homepage_configurations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    countryId: uuid('country_id')
      .notNull()
      .references(() => countries.id, { onDelete: 'restrict' }),
    versionNumber: integer('version_number').notNull(),
    title: varchar('title', { length: 160 }).notNull(),
    notes: text('notes'),
    status: homepageConfigStatusEnum('status').notNull().default('DRAFT'),
    scheduledStartAt: timestamp('scheduled_start_at', { withTimezone: true }),
    scheduledUntilAt: timestamp('scheduled_until_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedBy: uuid('published_by').references(() => users.id, {
      onDelete: 'restrict',
    }),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    supersededByConfigurationId: uuid('superseded_by_configuration_id'),
    rolledBackAt: timestamp('rolled_back_at', { withTimezone: true }),
    rolledBackBy: uuid('rolled_back_by').references(() => users.id, {
      onDelete: 'restrict',
    }),
    rollbackReason: text('rollback_reason'),
    restoredFromConfigurationId: uuid('restored_from_configuration_id'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedBy: uuid('archived_by').references(() => users.id, {
      onDelete: 'restrict',
    }),
    discardedAt: timestamp('discarded_at', { withTimezone: true }),
    discardedBy: uuid('discarded_by').references(() => users.id, {
      onDelete: 'restrict',
    }),
    discardReason: text('discard_reason'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_homepage_cfg_id_country').on(table.id, table.countryId),
    unique('uq_homepage_cfg_country_version').on(
      table.countryId,
      table.versionNumber,
    ),
    foreignKey({
      name: 'fk_homepage_cfg_superseded_by',
      columns: [table.supersededByConfigurationId, table.countryId],
      foreignColumns: [table.id, table.countryId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_homepage_cfg_restored_from',
      columns: [table.restoredFromConfigurationId, table.countryId],
      foreignColumns: [table.id, table.countryId],
    }).onDelete('restrict'),
    uniqueIndex('uq_homepage_cfg_one_active_draft_per_country')
      .on(table.countryId)
      .where(sql`${table.status} = 'DRAFT'`),
    uniqueIndex('uq_homepage_cfg_one_published_per_country')
      .on(table.countryId)
      .where(sql`${table.status} = 'PUBLISHED'`),
    index('idx_homepage_cfg_country_status_version').on(
      table.countryId,
      table.status,
      table.versionNumber.desc(),
    ),
    index('idx_homepage_cfg_scheduled_due')
      .on(table.countryId, table.scheduledStartAt.asc())
      .where(sql`${table.status} = 'SCHEDULED'`),
    check('chk_homepage_cfg_version_positive', sql`${table.versionNumber} >= 1`),
    check(
      'chk_homepage_cfg_title_not_empty',
      sql`length(trim(${table.title})) BETWEEN 1 AND 160`,
    ),
    check(
      'chk_homepage_cfg_notes_length',
      sql`${table.notes} IS NULL OR length(${table.notes}) <= 2000`,
    ),
  ],
);

/**
 * content.homepage_configuration_slots
 * Exact 6 canonical ordered slots per homepage configuration.
 */
export const homepageConfigurationSlots = contentSchema.table(
  'homepage_configuration_slots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    configurationId: uuid('configuration_id').notNull(),
    countryId: uuid('country_id').notNull(),
    slotKey: homepageSlotKeyEnum('slot_key').notNull(),
    slotOrder: smallint('slot_order').notNull(),
    entityType: homepageEntityTypeEnum('entity_type').notNull(),
    mode: homepageSlotModeEnum('mode').notNull().default('AUTOMATED'),
    sectionTitle: varchar('section_title', { length: 120 }).notNull(),
    sectionSubtitle: varchar('section_subtitle', { length: 240 }),
    maxItems: smallint('max_items').notNull().default(6),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_homepage_slots_cfg_key').on(table.configurationId, table.slotKey),
    unique('uq_homepage_slots_cfg_order').on(
      table.configurationId,
      table.slotOrder,
    ),
    unique('uq_homepage_slots_id_cfg_country_type').on(
      table.id,
      table.configurationId,
      table.countryId,
      table.entityType,
    ),
    foreignKey({
      name: 'fk_homepage_slots_cfg_country',
      columns: [table.configurationId, table.countryId],
      foreignColumns: [homepageConfigurations.id, homepageConfigurations.countryId],
    }).onDelete('restrict'),
    index('idx_homepage_slots_cfg_order').on(
      table.configurationId,
      table.slotOrder.asc(),
    ),
    check('chk_homepage_slots_order_range', sql`${table.slotOrder} BETWEEN 1 AND 6`),
    check('chk_homepage_slots_max_items_range', sql`${table.maxItems} BETWEEN 1 AND 6`),
  ],
);

/**
 * content.homepage_configuration_items
 * Editorially pinned items within a slot (strict XOR entity target + windowing).
 */
export const homepageConfigurationItems = contentSchema.table(
  'homepage_configuration_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slotId: uuid('slot_id').notNull(),
    configurationId: uuid('configuration_id').notNull(),
    countryId: uuid('country_id').notNull(),
    entityType: homepageEntityTypeEnum('entity_type').notNull(),
    position: smallint('position').notNull(),
    resourceId: uuid('resource_id'),
    updateId: uuid('update_id').references(() => educationUpdates.id, {
      onDelete: 'restrict',
    }),
    calendarEventId: uuid('calendar_event_id').references(
      () => calendarEvents.id,
      { onDelete: 'restrict' },
    ),
    subjectId: uuid('subject_id').references(() => subjects.id, {
      onDelete: 'restrict',
    }),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    pinNote: varchar('pin_note', { length: 500 }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_homepage_items_slot_position').on(table.slotId, table.position),
    foreignKey({
      name: 'fk_homepage_items_slot_cfg_country_type',
      columns: [
        table.slotId,
        table.configurationId,
        table.countryId,
        table.entityType,
      ],
      foreignColumns: [
        homepageConfigurationSlots.id,
        homepageConfigurationSlots.configurationId,
        homepageConfigurationSlots.countryId,
        homepageConfigurationSlots.entityType,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_homepage_items_resource_country',
      columns: [table.resourceId, table.countryId],
      foreignColumns: [resources.id, resources.countryId],
    }).onDelete('restrict'),
    uniqueIndex('uq_homepage_items_slot_resource')
      .on(table.slotId, table.resourceId)
      .where(sql`${table.resourceId} IS NOT NULL`),
    uniqueIndex('uq_homepage_items_slot_update')
      .on(table.slotId, table.updateId)
      .where(sql`${table.updateId} IS NOT NULL`),
    uniqueIndex('uq_homepage_items_slot_calendar_event')
      .on(table.slotId, table.calendarEventId)
      .where(sql`${table.calendarEventId} IS NOT NULL`),
    uniqueIndex('uq_homepage_items_slot_subject')
      .on(table.slotId, table.subjectId)
      .where(sql`${table.subjectId} IS NOT NULL`),
    index('idx_homepage_items_cfg_slot_pos').on(
      table.configurationId,
      table.slotId,
      table.position.asc(),
    ),
    check('chk_homepage_items_position_range', sql`${table.position} BETWEEN 1 AND 6`),
  ],
);

/**
 * content.homepage_configuration_rollbacks
 * Immutable append-only xid8 transaction-paired rollback ledger (Decision D3 / C45).
 */
export const homepageConfigurationRollbacks = contentSchema.table(
  'homepage_configuration_rollbacks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    countryId: uuid('country_id')
      .notNull()
      .references(() => countries.id, { onDelete: 'restrict' }),
    rolledBackConfigurationId: uuid('rolled_back_configuration_id').notNull(),
    targetSourceConfigurationId: uuid('target_source_configuration_id').notNull(),
    cloneConfigurationId: uuid('clone_configuration_id').notNull(),
    txid: xid8Column('txid')
      .notNull()
      .default(sql`pg_current_xact_id()`),
    reason: text('reason').notNull(),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_homepage_rollbacks_predecessor').on(
      table.rolledBackConfigurationId,
    ),
    unique('uq_homepage_rollbacks_clone').on(table.cloneConfigurationId),
    foreignKey({
      name: 'fk_homepage_rollbacks_predecessor_country',
      columns: [table.rolledBackConfigurationId, table.countryId],
      foreignColumns: [homepageConfigurations.id, homepageConfigurations.countryId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_homepage_rollbacks_target_source_country',
      columns: [table.targetSourceConfigurationId, table.countryId],
      foreignColumns: [homepageConfigurations.id, homepageConfigurations.countryId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_homepage_rollbacks_clone_country',
      columns: [table.cloneConfigurationId, table.countryId],
      foreignColumns: [homepageConfigurations.id, homepageConfigurations.countryId],
    }).onDelete('restrict'),
    index('idx_homepage_rollbacks_country_occurred').on(
      table.countryId,
      table.occurredAt.desc(),
    ),
  ],
);

export const homepageConfigurationsRelations = relations(
  homepageConfigurations,
  ({ one, many }) => ({
    country: one(countries, {
      fields: [homepageConfigurations.countryId],
      references: [countries.id],
    }),
    slots: many(homepageConfigurationSlots),
    items: many(homepageConfigurationItems),
  }),
);

export const homepageConfigurationSlotsRelations = relations(
  homepageConfigurationSlots,
  ({ one, many }) => ({
    configuration: one(homepageConfigurations, {
      fields: [homepageConfigurationSlots.configurationId],
      references: [homepageConfigurations.id],
    }),
    items: many(homepageConfigurationItems),
  }),
);

export const homepageConfigurationItemsRelations = relations(
  homepageConfigurationItems,
  ({ one }) => ({
    slot: one(homepageConfigurationSlots, {
      fields: [homepageConfigurationItems.slotId],
      references: [homepageConfigurationSlots.id],
    }),
    configuration: one(homepageConfigurations, {
      fields: [homepageConfigurationItems.configurationId],
      references: [homepageConfigurations.id],
    }),
  }),
);

export type HomepageConfiguration = typeof homepageConfigurations.$inferSelect;
export type NewHomepageConfiguration = typeof homepageConfigurations.$inferInsert;
export type HomepageConfigurationSlot = typeof homepageConfigurationSlots.$inferSelect;
export type NewHomepageConfigurationSlot = typeof homepageConfigurationSlots.$inferInsert;
export type HomepageConfigurationItem = typeof homepageConfigurationItems.$inferSelect;
export type NewHomepageConfigurationItem = typeof homepageConfigurationItems.$inferInsert;
export type HomepageConfigurationRollback = typeof homepageConfigurationRollbacks.$inferSelect;
export type NewHomepageConfigurationRollback = typeof homepageConfigurationRollbacks.$inferInsert;
