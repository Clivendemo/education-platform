import { sql } from 'drizzle-orm';
import {
  uuid,
  varchar,
  integer,
  timestamp,
  jsonb,
  foreignKey,
  unique,
  check,
  index,
} from 'drizzle-orm/pg-core';
import { platformSchema } from '../logical-schemas.js';

/**
 * 7.1 platform.countries
 * Defines supported countries with case-insensitive unique ISO codes and URL prefixes.
 */
export const countries = platformSchema.table(
  'countries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 100 }).notNull(),
    isoCode: varchar('iso_code', { length: 3 }).notNull(),
    urlPrefix: varchar('url_prefix', { length: 10 }).notNull(),
    defaultLanguageCode: varchar('default_language_code', { length: 10 })
      .notNull()
      .default('en'),
    currencyCode: varchar('currency_code', { length: 3 })
      .notNull()
      .default('KES'),
    educationTerminologyConfig: jsonb('education_terminology_config')
      .notNull()
      .default({}),
    paymentConfig: jsonb('payment_config').notNull().default({}),
    policyConfig: jsonb('policy_config').notNull().default({}),
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_countries_iso_code').on(table.isoCode),
    unique('uq_countries_url_prefix').on(table.urlPrefix),
    check(
      'chk_countries_iso_code_upper',
      sql`${table.isoCode} = upper(${table.isoCode})`,
    ),
    check(
      'chk_countries_url_prefix_lower',
      sql`${table.urlPrefix} = lower(${table.urlPrefix})`,
    ),
    check(
      'chk_countries_status',
      sql`${table.status} IN ('ACTIVE', 'INACTIVE')`,
    ),
  ],
);

/**
 * 7.2 platform.administrative_area_types
 * Defines configurable administrative hierarchy types (e.g. County, Sub-County, Ward).
 * Enforces strict country consistency and hierarchical level validity.
 */
export const administrativeAreaTypes = platformSchema.table(
  'administrative_area_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    countryId: uuid('country_id')
      .notNull()
      .references(() => countries.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull(),
    hierarchyLevel: integer('hierarchy_level').notNull(),
    parentTypeId: uuid('parent_type_id'),
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_area_types_id_country').on(table.id, table.countryId),
    unique('uq_area_types_id_parent_type').on(table.id, table.parentTypeId),
    unique('uq_area_types_country_slug').on(table.countryId, table.slug),
    unique('uq_area_types_country_level').on(table.countryId, table.hierarchyLevel),
    foreignKey({
      name: 'fk_area_types_parent_country',
      columns: [table.parentTypeId, table.countryId],
      foreignColumns: [table.id, table.countryId],
    }).onDelete('restrict'),
    check('chk_area_types_level', sql`${table.hierarchyLevel} > 0`),
    check(
      'chk_area_types_parent_level',
      sql`(${table.hierarchyLevel} = 1 AND ${table.parentTypeId} IS NULL) OR (${table.hierarchyLevel} > 1 AND ${table.parentTypeId} IS NOT NULL)`,
    ),
    check(
      'chk_area_types_status',
      sql`${table.status} IN ('ACTIVE', 'INACTIVE')`,
    ),
  ],
);

/**
 * 7.3 platform.administrative_areas
 * Hierarchical geographical administrative areas.
 * Enforces composite country and type consistency, preventing cross-country or cross-level hierarchy corruption.
 */
export const administrativeAreas = platformSchema.table(
  'administrative_areas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    countryId: uuid('country_id')
      .notNull()
      .references(() => countries.id, { onDelete: 'restrict' }),
    typeId: uuid('type_id').notNull(),
    parentTypeId: uuid('parent_type_id'),
    parentId: uuid('parent_id'),
    name: varchar('name', { length: 150 }).notNull(),
    code: varchar('code', { length: 50 }),
    slug: varchar('slug', { length: 150 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_areas_id_country').on(table.id, table.countryId),
    unique('uq_areas_id_type').on(table.id, table.typeId),
    unique('uq_areas_country_type_slug').on(
      table.countryId,
      table.typeId,
      table.slug,
    ),
    foreignKey({
      name: 'fk_areas_type_country',
      columns: [table.typeId, table.countryId],
      foreignColumns: [
        administrativeAreaTypes.id,
        administrativeAreaTypes.countryId,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_areas_type_parent_type',
      columns: [table.typeId, table.parentTypeId],
      foreignColumns: [
        administrativeAreaTypes.id,
        administrativeAreaTypes.parentTypeId,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_areas_parent_country',
      columns: [table.parentId, table.countryId],
      foreignColumns: [table.id, table.countryId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_areas_parent_area_type',
      columns: [table.parentId, table.parentTypeId],
      foreignColumns: [table.id, table.typeId],
    }).onDelete('restrict'),
    check(
      'chk_areas_no_self_parent',
      sql`${table.parentId} IS NULL OR ${table.parentId} <> ${table.id}`,
    ),
    check(
      'chk_areas_parent_presence',
      sql`(${table.parentTypeId} IS NULL AND ${table.parentId} IS NULL) OR (${table.parentTypeId} IS NOT NULL AND ${table.parentId} IS NOT NULL)`,
    ),
    check(
      'chk_areas_status',
      sql`${table.status} IN ('ACTIVE', 'INACTIVE')`,
    ),
    index('idx_areas_country_id').on(table.countryId),
    index('idx_areas_type_id').on(table.typeId),
    index('idx_areas_parent_id').on(table.parentId),
  ],
);
