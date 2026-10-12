import { sql, relations } from 'drizzle-orm';
import {
  uuid,
  varchar,
  integer,
  text,
  timestamp,
  unique,
  check,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { contentSchema } from '../logical-schemas.js';
import { countries } from './geography.js';
import { curricula } from './curriculum.js';
import { resources } from './resource.js';
import { users } from './identity.js';

/**
 * Controlled publication status for Education Updates.
 */
export const UPDATE_PUBLICATION_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type UpdatePublicationStatus = (typeof UPDATE_PUBLICATION_STATUSES)[number];

/**
 * Controlled category status for Education Update Categories.
 */
export const UPDATE_CATEGORY_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type UpdateCategoryStatus = (typeof UPDATE_CATEGORY_STATUSES)[number];

/**
 * 31.2 content.education_update_categories
 * Controlled classification of education-related news, circulars, and advisories.
 */
export const educationUpdateCategories = contentSchema.table(
  'education_update_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull(),
    description: text('description'),
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_education_update_categories_slug').on(table.slug),
    check(
      'chk_education_update_categories_name',
      sql`length(trim(${table.name})) > 0`,
    ),
    check(
      'chk_education_update_categories_slug',
      sql`length(trim(${table.slug})) > 0`,
    ),
    check(
      'chk_education_update_categories_status',
      sql`${table.status} IN ('ACTIVE', 'INACTIVE')`,
    ),
    index('idx_education_update_categories_status').on(table.status),
    index('idx_education_update_categories_slug').on(table.slug),
  ],
);

/**
 * 31.1 content.education_updates
 * Independent education updates entity supporting national & regional advisories.
 */
export const educationUpdates = contentSchema.table(
  'education_updates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    countryId: uuid('country_id').references(() => countries.id, {
      onDelete: 'restrict',
    }),
    categoryId: uuid('category_id').references(
      () => educationUpdateCategories.id,
      { onDelete: 'restrict' },
    ),
    title: varchar('title', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 255 }).notNull(),
    summary: text('summary'),
    body: text('body').notNull(),
    seoTitle: varchar('seo_title', { length: 255 }),
    seoDescription: text('seo_description'),
    publicationStatus: varchar('publication_status', { length: 20 })
      .notNull()
      .default('DRAFT'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
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
  (table) => [
    unique('uq_education_updates_slug').on(table.slug),
    check(
      'chk_education_updates_title',
      sql`length(trim(${table.title})) > 0`,
    ),
    check(
      'chk_education_updates_slug',
      sql`length(trim(${table.slug})) > 0`,
    ),
    check(
      'chk_education_updates_body',
      sql`length(trim(${table.body})) > 0`,
    ),
    check(
      'chk_education_updates_status',
      sql`${table.publicationStatus} IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')`,
    ),
    check(
      'chk_education_updates_published_at',
      sql`(${table.publicationStatus} = 'DRAFT' AND ${table.publishedAt} IS NULL) OR (${table.publicationStatus} IN ('PUBLISHED', 'ARCHIVED'))`,
    ),
    index('idx_education_updates_status_pub').on(
      table.publicationStatus,
      table.publishedAt,
    ),
    index('idx_education_updates_country_status').on(
      table.countryId,
      table.publicationStatus,
    ),
    index('idx_education_updates_category_status').on(
      table.categoryId,
      table.publicationStatus,
    ),
    index('idx_education_updates_slug').on(table.slug),
  ],
);

/**
 * 31.3 content.education_update_curricula
 * Many-to-many relationship linking education updates to relevant curricula.
 */
export const educationUpdateCurricula = contentSchema.table(
  'education_update_curricula',
  {
    updateId: uuid('update_id')
      .notNull()
      .references(() => educationUpdates.id, { onDelete: 'cascade' }),
    curriculumId: uuid('curriculum_id')
      .notNull()
      .references(() => curricula.id, { onDelete: 'restrict' }),
  },
  (table) => [
    primaryKey({
      name: 'pk_education_update_curricula',
      columns: [table.updateId, table.curriculumId],
    }),
    index('idx_update_curricula_curriculum').on(table.curriculumId),
  ],
);

/**
 * 31.4 content.education_update_resources
 * Ordered association linking education updates to educational resources.
 */
export const educationUpdateResources = contentSchema.table(
  'education_update_resources',
  {
    updateId: uuid('update_id')
      .notNull()
      .references(() => educationUpdates.id, { onDelete: 'cascade' }),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    displayOrder: integer('display_order').notNull().default(0),
  },
  (table) => [
    primaryKey({
      name: 'pk_education_update_resources',
      columns: [table.updateId, table.resourceId],
    }),
    index('idx_update_resources_resource').on(table.resourceId),
    index('idx_update_resources_order').on(table.updateId, table.displayOrder),
  ],
);

// Drizzle Relations
export const educationUpdateCategoriesRelations = relations(
  educationUpdateCategories,
  ({ many }) => ({
    updates: many(educationUpdates),
  }),
);

export const educationUpdatesRelations = relations(
  educationUpdates,
  ({ one, many }) => ({
    country: one(countries, {
      fields: [educationUpdates.countryId],
      references: [countries.id],
    }),
    category: one(educationUpdateCategories, {
      fields: [educationUpdates.categoryId],
      references: [educationUpdateCategories.id],
    }),
    createdByUser: one(users, {
      fields: [educationUpdates.createdBy],
      references: [users.id],
    }),
    updatedByUser: one(users, {
      fields: [educationUpdates.updatedBy],
      references: [users.id],
    }),
    curricula: many(educationUpdateCurricula),
    resources: many(educationUpdateResources),
  }),
);

export const educationUpdateCurriculaRelations = relations(
  educationUpdateCurricula,
  ({ one }) => ({
    update: one(educationUpdates, {
      fields: [educationUpdateCurricula.updateId],
      references: [educationUpdates.id],
    }),
    curriculum: one(curricula, {
      fields: [educationUpdateCurricula.curriculumId],
      references: [curricula.id],
    }),
  }),
);

export const educationUpdateResourcesRelations = relations(
  educationUpdateResources,
  ({ one }) => ({
    update: one(educationUpdates, {
      fields: [educationUpdateResources.updateId],
      references: [educationUpdates.id],
    }),
    resource: one(resources, {
      fields: [educationUpdateResources.resourceId],
      references: [resources.id],
    }),
  }),
);
