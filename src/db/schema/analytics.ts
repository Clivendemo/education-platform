import { sql, relations } from 'drizzle-orm';
import {
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  check,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { analyticsSchema } from '../logical-schemas.js';
import { users } from './identity.js';
import { countries } from './geography.js';

/**
 * 38.1 analytics.analytics_event_types
 * Configurable catalog of platform events.
 */
export const analyticsEventTypes = analyticsSchema.table(
  'analytics_event_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 64 }).notNull(),
    eventCode: varchar('event_code', { length: 32 }).notNull(),
    description: text('description'),
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
    configuration: jsonb('configuration').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_analytics_event_types_code').on(table.eventCode),
    check(
      'chk_analytics_event_types_status',
      sql`${table.status} IN ('ACTIVE', 'DISABLED', 'ARCHIVED')`,
    ),
    check(
      'chk_analytics_event_types_code',
      sql`${table.eventCode} ~ '^[a-z0-9_]{2,32}$'`,
    ),
  ],
);

/**
 * 38.2 analytics.analytics_events
 * Immutable append-only telemetry ledger.
 * Supports anonymous, authenticated, and system-originated activity.
 */
export const analyticsEvents = analyticsSchema.table(
  'analytics_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventTypeId: uuid('event_type_id')
      .notNull()
      .references(() => analyticsEventTypes.id, { onDelete: 'restrict' }),
    actorType: varchar('actor_type', { length: 20 })
      .notNull()
      .default('ANONYMOUS'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    anonymousSessionHash: varchar('anonymous_session_hash', { length: 64 }),
    idempotencyKey: varchar('idempotency_key', { length: 128 }),
    countryId: uuid('country_id').references(() => countries.id, { onDelete: 'set null' }),
    entityType: varchar('entity_type', { length: 32 }),
    entityId: uuid('entity_id'),
    context: jsonb('context').notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Concurrency-safe deduplication key index
    uniqueIndex('uq_analytics_events_idempotency').on(table.idempotencyKey),

    // Time-window aggregation and event type filtering index
    index('idx_analytics_events_window').on(table.occurredAt.desc(), table.eventTypeId),

    // Country-partitioned time-window index
    index('idx_analytics_events_country_window')
      .on(table.countryId, table.occurredAt.desc())
      .where(sql`${table.countryId} IS NOT NULL`),

    // Actor metrics aggregation index
    index('idx_analytics_events_actor_metrics').on(
      table.occurredAt,
      table.userId,
      table.anonymousSessionHash,
    ),

    check(
      'chk_analytics_events_actor_type',
      sql`${table.actorType} IN ('AUTHENTICATED', 'ANONYMOUS', 'SYSTEM')`,
    ),

    // Guarantees non-invalid records even when ON DELETE SET NULL occurs on user_id
    check(
      'chk_analytics_events_actor',
      sql`(${table.actorType} = 'AUTHENTICATED') OR (${table.actorType} = 'ANONYMOUS' AND ${table.anonymousSessionHash} IS NOT NULL) OR (${table.actorType} = 'SYSTEM')`,
    ),

    // Protects JSONB column from unbounded storage
    check(
      'chk_analytics_events_context_size',
      sql`pg_column_size(${table.context}) <= 4096`,
    ),
  ],
);

export const analyticsEventTypesRelations = relations(
  analyticsEventTypes,
  ({ many }) => ({
    events: many(analyticsEvents),
  }),
);

export const analyticsEventsRelations = relations(analyticsEvents, ({ one }) => ({
  eventType: one(analyticsEventTypes, {
    fields: [analyticsEvents.eventTypeId],
    references: [analyticsEventTypes.id],
  }),
  user: one(users, {
    fields: [analyticsEvents.userId],
    references: [users.id],
  }),
  country: one(countries, {
    fields: [analyticsEvents.countryId],
    references: [countries.id],
  }),
}));
