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

/**
 * Controlled Publication Event Types
 */
export const PUBLICATION_EVENT_TYPES = [
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'PUBLISHED',
  'ARCHIVED',
  'RETURNED_TO_DRAFT',
] as const;
export type PublicationEventType = (typeof PUBLICATION_EVENT_TYPES)[number];

/**
 * content.publication_events
 * Immutable audit ledger tracking all state transitions for resources and versions.
 */
export const publicationEvents = contentSchema.table(
  'publication_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'restrict' }),
    resourceVersionId: uuid('resource_version_id').references(
      () => resourceVersions.id,
      { onDelete: 'restrict' },
    ),
    eventType: varchar('event_type', { length: 32 }).notNull(),
    fromStatus: varchar('from_status', { length: 32 }).notNull(),
    toStatus: varchar('to_status', { length: 32 }).notNull(),
    actorUserId: uuid('actor_user_id'), // Nullable; reserved for future auth/RBAC phase
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'chk_publication_events_event_type',
      sql`${table.eventType} IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'PUBLISHED', 'ARCHIVED', 'RETURNED_TO_DRAFT')`,
    ),
    check(
      'chk_publication_events_rejection_reason',
      sql`(${table.eventType} = 'REJECTED' AND ${table.reason} IS NOT NULL AND length(trim(${table.reason})) > 0) OR (${table.eventType} != 'REJECTED')`,
    ),
    index('idx_publication_events_resource_id').on(table.resourceId),
    index('idx_publication_events_version_id').on(table.resourceVersionId),
    index('idx_publication_events_created_at').on(table.createdAt),
  ],
);

export const publicationEventsRelations = relations(
  publicationEvents,
  ({ one }) => ({
    resource: one(resources, {
      fields: [publicationEvents.resourceId],
      references: [resources.id],
    }),
    resourceVersion: one(resourceVersions, {
      fields: [publicationEvents.resourceVersionId],
      references: [resourceVersions.id],
    }),
  }),
);
