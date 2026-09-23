import { sql, relations } from 'drizzle-orm';
import {
  uuid,
  varchar,
  integer,
  text,
  date,
  timestamp,
  foreignKey,
  unique,
  uniqueIndex,
  check,
  index,
} from 'drizzle-orm/pg-core';
import { taxonomySchema } from '../logical-schemas.js';
import { countries } from './geography.js';

/**
 * Controlled curriculum statuses.
 */
export const CURRICULUM_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type CurriculumStatus = (typeof CURRICULUM_STATUSES)[number];

/**
 * Controlled curriculum version statuses.
 */
export const CURRICULUM_VERSION_STATUSES = [
  'DRAFT',
  'PLANNED',
  'CURRENT',
  'HISTORICAL',
  'INACTIVE',
] as const;
export type CurriculumVersionStatus = (typeof CURRICULUM_VERSION_STATUSES)[number];

/**
 * Controlled taxonomy entity statuses.
 */
export const TAXONOMY_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type TaxonomyStatus = (typeof TAXONOMY_STATUSES)[number];

/**
 * 8.1 taxonomy.curricula
 * A country-specific curriculum definition (e.g. CBC or 8-4-4 in Kenya).
 */
export const curricula = taxonomySchema.table(
  'curricula',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    countryId: uuid('country_id')
      .notNull()
      .references(() => countries.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull(),
    code: varchar('code', { length: 50 }),
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
    unique('uq_curricula_country_slug').on(table.countryId, table.slug),
    unique('uq_curricula_id_country').on(table.id, table.countryId),
    check(
      'chk_curricula_name_not_empty',
      sql`length(trim(${table.name})) > 0`,
    ),
    check(
      'chk_curricula_slug_not_empty',
      sql`length(trim(${table.slug})) > 0`,
    ),
    check(
      'chk_curricula_status',
      sql`${table.status} IN ('ACTIVE', 'INACTIVE')`,
    ),
    index('idx_curricula_country_id').on(table.countryId),
    index('idx_curricula_slug').on(table.slug),
    index('idx_curricula_status').on(table.status),
  ],
);

/**
 * 8.2 taxonomy.curriculum_versions
 * Versioned curriculum iteration ensuring historical structures are immutable.
 */
export const curriculumVersions = taxonomySchema.table(
  'curriculum_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    curriculumId: uuid('curriculum_id')
      .notNull()
      .references(() => curricula.id, { onDelete: 'restrict' }),
    countryId: uuid('country_id')
      .notNull()
      .references(() => countries.id, { onDelete: 'restrict' }),
    versionName: varchar('version_name', { length: 100 }).notNull(),
    versionCode: varchar('version_code', { length: 50 }),
    slug: varchar('slug', { length: 100 }).notNull(),
    effectiveFrom: date('effective_from', { mode: 'string' }),
    effectiveTo: date('effective_to', { mode: 'string' }),
    status: varchar('status', { length: 20 }).notNull().default('CURRENT'),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'fk_curriculum_versions_curriculum_country',
      columns: [table.curriculumId, table.countryId],
      foreignColumns: [curricula.id, curricula.countryId],
    }).onDelete('restrict'),
    unique('uq_curriculum_versions_curriculum_slug').on(
      table.curriculumId,
      table.slug,
    ),
    unique('uq_curriculum_versions_id_curriculum').on(
      table.id,
      table.curriculumId,
    ),
    unique('uq_curriculum_versions_id_country').on(table.id, table.countryId),
    check(
      'chk_curriculum_versions_name_not_empty',
      sql`length(trim(${table.versionName})) > 0`,
    ),
    check(
      'chk_curriculum_versions_slug_not_empty',
      sql`length(trim(${table.slug})) > 0`,
    ),
    check(
      'chk_curriculum_versions_status',
      sql`${table.status} IN ('DRAFT', 'PLANNED', 'CURRENT', 'HISTORICAL', 'INACTIVE')`,
    ),
    index('idx_curriculum_versions_curriculum_id').on(table.curriculumId),
    index('idx_curriculum_versions_country_id').on(table.countryId),
    index('idx_curriculum_versions_status').on(table.status),
    index('idx_curriculum_versions_slug').on(table.slug),
  ],
);

/**
 * 8.3 taxonomy.education_levels
 * Hierarchy level within a curriculum version (e.g. Primary, Junior School, Senior School).
 */
export const educationLevels = taxonomySchema.table(
  'education_levels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    curriculumVersionId: uuid('curriculum_version_id')
      .notNull()
      .references(() => curriculumVersions.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull(),
    code: varchar('code', { length: 50 }),
    description: text('description'),
    sequenceOrder: integer('sequence_order').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_education_levels_version_slug').on(
      table.curriculumVersionId,
      table.slug,
    ),
    unique('uq_education_levels_version_seq').on(
      table.curriculumVersionId,
      table.sequenceOrder,
    ),
    unique('uq_education_levels_id_version').on(
      table.id,
      table.curriculumVersionId,
    ),
    check(
      'chk_education_levels_seq',
      sql`${table.sequenceOrder} > 0`,
    ),
    check(
      'chk_education_levels_name_not_empty',
      sql`length(trim(${table.name})) > 0`,
    ),
    check(
      'chk_education_levels_status',
      sql`${table.status} IN ('ACTIVE', 'INACTIVE')`,
    ),
    index('idx_education_levels_version_id').on(table.curriculumVersionId),
    index('idx_education_levels_seq').on(table.sequenceOrder),
    index('idx_education_levels_status').on(table.status),
  ],
);

/**
 * 8.4 taxonomy.grades
 * Specific grade or form within an education level and curriculum version.
 */
export const grades = taxonomySchema.table(
  'grades',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    curriculumVersionId: uuid('curriculum_version_id')
      .notNull()
      .references(() => curriculumVersions.id, { onDelete: 'restrict' }),
    educationLevelId: uuid('education_level_id')
      .notNull()
      .references(() => educationLevels.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull(),
    code: varchar('code', { length: 50 }),
    description: text('description'),
    sequenceOrder: integer('sequence_order').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'fk_grades_level_version',
      columns: [table.educationLevelId, table.curriculumVersionId],
      foreignColumns: [educationLevels.id, educationLevels.curriculumVersionId],
    }).onDelete('restrict'),
    unique('uq_grades_version_slug').on(table.curriculumVersionId, table.slug),
    unique('uq_grades_version_seq').on(
      table.curriculumVersionId,
      table.sequenceOrder,
    ),
    unique('uq_grades_id_version').on(table.id, table.curriculumVersionId),
    unique('uq_grades_id_level').on(table.id, table.educationLevelId),
    check(
      'chk_grades_seq',
      sql`${table.sequenceOrder} > 0`,
    ),
    check(
      'chk_grades_name_not_empty',
      sql`length(trim(${table.name})) > 0`,
    ),
    check(
      'chk_grades_status',
      sql`${table.status} IN ('ACTIVE', 'INACTIVE')`,
    ),
    index('idx_grades_version_id').on(table.curriculumVersionId),
    index('idx_grades_level_id').on(table.educationLevelId),
    index('idx_grades_seq').on(table.sequenceOrder),
    index('idx_grades_status').on(table.status),
  ],
);

/**
 * 8.5 taxonomy.pathways
 * Optional specialization pathway associated with grades (e.g. STEM, Social Sciences, Arts & Sports).
 */
export const pathways = taxonomySchema.table(
  'pathways',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    curriculumVersionId: uuid('curriculum_version_id')
      .notNull()
      .references(() => curriculumVersions.id, { onDelete: 'restrict' }),
    educationLevelId: uuid('education_level_id')
      .notNull()
      .references(() => educationLevels.id, { onDelete: 'restrict' }),
    gradeId: uuid('grade_id')
      .notNull()
      .references(() => grades.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull(),
    code: varchar('code', { length: 50 }),
    description: text('description'),
    sequenceOrder: integer('sequence_order').notNull().default(1),
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'fk_pathways_grade_level',
      columns: [table.gradeId, table.educationLevelId],
      foreignColumns: [grades.id, grades.educationLevelId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_pathways_grade_version',
      columns: [table.gradeId, table.curriculumVersionId],
      foreignColumns: [grades.id, grades.curriculumVersionId],
    }).onDelete('restrict'),
    unique('uq_pathways_grade_slug').on(table.gradeId, table.slug),
    unique('uq_pathways_grade_seq').on(table.gradeId, table.sequenceOrder),
    unique('uq_pathways_id_grade').on(table.id, table.gradeId),
    unique('uq_pathways_id_version').on(table.id, table.curriculumVersionId),
    check(
      'chk_pathways_seq',
      sql`${table.sequenceOrder} > 0`,
    ),
    check(
      'chk_pathways_name_not_empty',
      sql`length(trim(${table.name})) > 0`,
    ),
    check(
      'chk_pathways_status',
      sql`${table.status} IN ('ACTIVE', 'INACTIVE')`,
    ),
    index('idx_pathways_grade_id').on(table.gradeId),
    index('idx_pathways_version_id').on(table.curriculumVersionId),
    index('idx_pathways_status').on(table.status),
  ],
);

/**
 * 8.6 taxonomy.subjects
 * Curriculum-specific subject associated with a grade and optionally a pathway.
 */
export const subjects = taxonomySchema.table(
  'subjects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    curriculumVersionId: uuid('curriculum_version_id')
      .notNull()
      .references(() => curriculumVersions.id, { onDelete: 'restrict' }),
    educationLevelId: uuid('education_level_id')
      .notNull()
      .references(() => educationLevels.id, { onDelete: 'restrict' }),
    gradeId: uuid('grade_id')
      .notNull()
      .references(() => grades.id, { onDelete: 'restrict' }),
    pathwayId: uuid('pathway_id').references(() => pathways.id, {
      onDelete: 'restrict',
    }),
    name: varchar('name', { length: 150 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull(),
    code: varchar('code', { length: 50 }),
    description: text('description'),
    sequenceOrder: integer('sequence_order').notNull().default(1),
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'fk_subjects_grade_level',
      columns: [table.gradeId, table.educationLevelId],
      foreignColumns: [grades.id, grades.educationLevelId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_subjects_grade_version',
      columns: [table.gradeId, table.curriculumVersionId],
      foreignColumns: [grades.id, grades.curriculumVersionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_subjects_pathway_grade',
      columns: [table.pathwayId, table.gradeId],
      foreignColumns: [pathways.id, pathways.gradeId],
    }).onDelete('restrict'),
    unique('uq_subjects_id_version').on(table.id, table.curriculumVersionId),
    unique('uq_subjects_id_grade').on(table.id, table.gradeId),
    uniqueIndex('uq_subjects_grade_no_pathway_slug')
      .on(table.gradeId, table.slug)
      .where(sql`${table.pathwayId} IS NULL`),
    uniqueIndex('uq_subjects_grade_pathway_slug')
      .on(table.gradeId, table.pathwayId, table.slug)
      .where(sql`${table.pathwayId} IS NOT NULL`),
    uniqueIndex('uq_subjects_grade_no_pathway_seq')
      .on(table.gradeId, table.sequenceOrder)
      .where(sql`${table.pathwayId} IS NULL`),
    uniqueIndex('uq_subjects_grade_pathway_seq')
      .on(table.gradeId, table.pathwayId, table.sequenceOrder)
      .where(sql`${table.pathwayId} IS NOT NULL`),
    check(
      'chk_subjects_seq',
      sql`${table.sequenceOrder} > 0`,
    ),
    check(
      'chk_subjects_name_not_empty',
      sql`length(trim(${table.name})) > 0`,
    ),
    check(
      'chk_subjects_status',
      sql`${table.status} IN ('ACTIVE', 'INACTIVE')`,
    ),
    index('idx_subjects_grade_id').on(table.gradeId),
    index('idx_subjects_pathway_id').on(table.pathwayId),
    index('idx_subjects_version_id').on(table.curriculumVersionId),
    index('idx_subjects_status').on(table.status),
  ],
);

/**
 * 8.7 taxonomy.topics
 * Hierarchical topic and sub-topic structures scoped to a curriculum subject.
 */
export const topics = taxonomySchema.table(
  'topics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    curriculumVersionId: uuid('curriculum_version_id')
      .notNull()
      .references(() => curriculumVersions.id, { onDelete: 'restrict' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'restrict' }),
    parentId: uuid('parent_id'),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 150 }).notNull(),
    code: varchar('code', { length: 50 }),
    description: text('description'),
    sequenceOrder: integer('sequence_order').notNull().default(1),
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'fk_topics_subject_version',
      columns: [table.subjectId, table.curriculumVersionId],
      foreignColumns: [subjects.id, subjects.curriculumVersionId],
    }).onDelete('restrict'),
    unique('uq_topics_id_subject').on(table.id, table.subjectId),
    foreignKey({
      name: 'fk_topics_parent_subject',
      columns: [table.parentId, table.subjectId],
      foreignColumns: [table.id, table.subjectId],
    }).onDelete('restrict'),
    check(
      'chk_topics_no_self_parent',
      sql`${table.id} <> ${table.parentId}`,
    ),
    uniqueIndex('uq_topics_subject_no_parent_slug')
      .on(table.subjectId, table.slug)
      .where(sql`${table.parentId} IS NULL`),
    uniqueIndex('uq_topics_parent_slug')
      .on(table.parentId, table.slug)
      .where(sql`${table.parentId} IS NOT NULL`),
    uniqueIndex('uq_topics_subject_no_parent_seq')
      .on(table.subjectId, table.sequenceOrder)
      .where(sql`${table.parentId} IS NULL`),
    uniqueIndex('uq_topics_parent_seq')
      .on(table.parentId, table.sequenceOrder)
      .where(sql`${table.parentId} IS NOT NULL`),
    check(
      'chk_topics_seq',
      sql`${table.sequenceOrder} > 0`,
    ),
    check(
      'chk_topics_name_not_empty',
      sql`length(trim(${table.name})) > 0`,
    ),
    check(
      'chk_topics_status',
      sql`${table.status} IN ('ACTIVE', 'INACTIVE')`,
    ),
    index('idx_topics_subject_id').on(table.subjectId),
    index('idx_topics_parent_id').on(table.parentId),
    index('idx_topics_version_id').on(table.curriculumVersionId),
    index('idx_topics_status').on(table.status),
  ],
);

/**
 * Relations definitions for Drizzle ORM queries
 */
export const curriculaRelations = relations(curricula, ({ one, many }) => ({
  country: one(countries, {
    fields: [curricula.countryId],
    references: [countries.id],
  }),
  versions: many(curriculumVersions),
}));

export const curriculumVersionsRelations = relations(
  curriculumVersions,
  ({ one, many }) => ({
    curriculum: one(curricula, {
      fields: [curriculumVersions.curriculumId],
      references: [curricula.id],
    }),
    country: one(countries, {
      fields: [curriculumVersions.countryId],
      references: [countries.id],
    }),
    educationLevels: many(educationLevels),
    grades: many(grades),
    subjects: many(subjects),
  }),
);

export const educationLevelsRelations = relations(
  educationLevels,
  ({ one, many }) => ({
    curriculumVersion: one(curriculumVersions, {
      fields: [educationLevels.curriculumVersionId],
      references: [curriculumVersions.id],
    }),
    grades: many(grades),
  }),
);

export const gradesRelations = relations(grades, ({ one, many }) => ({
  curriculumVersion: one(curriculumVersions, {
    fields: [grades.curriculumVersionId],
    references: [curriculumVersions.id],
  }),
  educationLevel: one(educationLevels, {
    fields: [grades.educationLevelId],
    references: [educationLevels.id],
  }),
  pathways: many(pathways),
  subjects: many(subjects),
}));

export const pathwaysRelations = relations(pathways, ({ one, many }) => ({
  grade: one(grades, {
    fields: [pathways.gradeId],
    references: [grades.id],
  }),
  educationLevel: one(educationLevels, {
    fields: [pathways.educationLevelId],
    references: [educationLevels.id],
  }),
  curriculumVersion: one(curriculumVersions, {
    fields: [pathways.curriculumVersionId],
    references: [curriculumVersions.id],
  }),
  subjects: many(subjects),
}));

export const subjectsRelations = relations(subjects, ({ one, many }) => ({
  grade: one(grades, {
    fields: [subjects.gradeId],
    references: [grades.id],
  }),
  pathway: one(pathways, {
    fields: [subjects.pathwayId],
    references: [pathways.id],
  }),
  educationLevel: one(educationLevels, {
    fields: [subjects.educationLevelId],
    references: [educationLevels.id],
  }),
  curriculumVersion: one(curriculumVersions, {
    fields: [subjects.curriculumVersionId],
    references: [curriculumVersions.id],
  }),
  topics: many(topics),
}));

export const topicsRelations = relations(topics, ({ one, many }) => ({
  subject: one(subjects, {
    fields: [topics.subjectId],
    references: [subjects.id],
  }),
  parent: one(topics, {
    fields: [topics.parentId],
    references: [topics.id],
    relationName: 'subTopics',
  }),
  subTopics: many(topics, {
    relationName: 'subTopics',
  }),
  curriculumVersion: one(curriculumVersions, {
    fields: [topics.curriculumVersionId],
    references: [curriculumVersions.id],
  }),
}));
