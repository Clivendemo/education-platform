import { sql, relations } from 'drizzle-orm';
import {
  uuid,
  varchar,
  timestamp,
  foreignKey,
  unique,
  check,
  index,
} from 'drizzle-orm/pg-core';
import { platformSchema } from '../logical-schemas.js';
import { countries, administrativeAreas } from './geography.js';

/**
 * Controlled school types for discovery and resource filtering.
 */
export const SCHOOL_TYPES = [
  'PRIMARY',
  'JUNIOR_SCHOOL',
  'SECONDARY',
  'SENIOR_SCHOOL',
  'INTEGRATED',
] as const;

export type SchoolType = (typeof SCHOOL_TYPES)[number];

/**
 * Controlled school status for lifecycle and public visibility.
 */
export const SCHOOL_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type SchoolStatus = (typeof SCHOOL_STATUSES)[number];

/**
 * 7.5 platform.schools
 * Lean first-class school entity linked to geography with database-enforced country consistency.
 */
export const schools = platformSchema.table(
  'schools',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    countryId: uuid('country_id')
      .notNull()
      .references(() => countries.id, { onDelete: 'restrict' }),
    administrativeAreaId: uuid('administrative_area_id').references(
      () => administrativeAreas.id,
      { onDelete: 'restrict' },
    ),
    name: varchar('name', { length: 255 }).notNull(),
    code: varchar('code', { length: 100 }),
    schoolType: varchar('school_type', { length: 50 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_schools_country_code').on(table.countryId, table.code),
    foreignKey({
      name: 'fk_schools_area_country',
      columns: [table.administrativeAreaId, table.countryId],
      foreignColumns: [
        administrativeAreas.id,
        administrativeAreas.countryId,
      ],
    }).onDelete('restrict'),
    check(
      'chk_schools_name_not_empty',
      sql`length(trim(${table.name})) > 0`,
    ),
    check(
      'chk_schools_type',
      sql`${table.schoolType} IN ('PRIMARY', 'JUNIOR_SCHOOL', 'SECONDARY', 'SENIOR_SCHOOL', 'INTEGRATED')`,
    ),
    check(
      'chk_schools_status',
      sql`${table.status} IN ('ACTIVE', 'INACTIVE')`,
    ),
    index('idx_schools_country_id').on(table.countryId),
    index('idx_schools_administrative_area_id').on(table.administrativeAreaId),
    index('idx_schools_school_type').on(table.schoolType),
    index('idx_schools_status').on(table.status),
    index('idx_schools_code').on(table.code),
  ],
);

export const schoolsRelations = relations(schools, ({ one }) => ({
  country: one(countries, {
    fields: [schools.countryId],
    references: [countries.id],
  }),
  administrativeArea: one(administrativeAreas, {
    fields: [schools.administrativeAreaId],
    references: [administrativeAreas.id],
  }),
}));
