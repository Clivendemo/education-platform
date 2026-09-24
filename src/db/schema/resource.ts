import { sql, relations } from 'drizzle-orm';
import {
  uuid,
  varchar,
  integer,
  text,
  timestamp,
  foreignKey,
  unique,
  check,
  index,
} from 'drizzle-orm/pg-core';
import { contentSchema } from '../logical-schemas.js';
import { countries } from './geography.js';
import { schools } from './schools.js';
import {
  curricula,
  curriculumVersions,
  educationLevels,
  grades,
  pathways,
  subjects,
  topics,
} from './curriculum.js';

/**
 * 8 Approved MVP Content Pillars
 */
export const RESOURCE_PILLARS = [
  'PAST_PAPERS',
  'LESSON_PLANS',
  'SCHEMES_OF_WORK',
  'NOTES_REVISION',
  'SCHOOL_DOCUMENTS',
  'ACADEMIC_CALENDAR',
  'EDUCATION_UPDATES',
  'TEACHER_RESOURCES',
] as const;
export type ResourcePillar = (typeof RESOURCE_PILLARS)[number];

/**
 * Controlled Resource Types Statuses
 */
export const RESOURCE_TYPE_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type ResourceTypeStatus = (typeof RESOURCE_TYPE_STATUSES)[number];

/**
 * Controlled Resource Lifecycle Statuses
 */
export const RESOURCE_STATUSES = [
  'DRAFT',
  'IN_REVIEW',
  'APPROVED',
  'PUBLISHED',
  'ARCHIVED',
  'REJECTED',
] as const;
export type ResourceStatus = (typeof RESOURCE_STATUSES)[number];

/**
 * Controlled Quality Classifications
 */
export const QUALITY_LABELS = ['STANDARD', 'VERIFIED', 'PREMIUM'] as const;
export type QualityLabel = (typeof QUALITY_LABELS)[number];

/**
 * content.resource_types
 * Controlled classification of educational resources matching the 8 approved MVP content pillars.
 */
export const resourceTypes = contentSchema.table(
  'resource_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 50 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull(),
    pillar: varchar('pillar', { length: 50 }).notNull(),
    description: text('description'),
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
    sequenceOrder: integer('sequence_order').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_resource_types_code').on(table.code),
    unique('uq_resource_types_slug').on(table.slug),
    check(
      'chk_resource_types_status',
      sql`${table.status} IN ('ACTIVE', 'INACTIVE')`,
    ),
    check(
      'chk_resource_types_pillar',
      sql`${table.pillar} IN ('PAST_PAPERS', 'LESSON_PLANS', 'SCHEMES_OF_WORK', 'NOTES_REVISION', 'SCHOOL_DOCUMENTS', 'ACADEMIC_CALENDAR', 'EDUCATION_UPDATES', 'TEACHER_RESOURCES')`,
    ),
    check(
      'chk_resource_types_seq',
      sql`${table.sequenceOrder} > 0`,
    ),
    check(
      'chk_resource_types_code_not_empty',
      sql`length(trim(${table.code})) > 0`,
    ),
    check(
      'chk_resource_types_name_not_empty',
      sql`length(trim(${table.name})) > 0`,
    ),
    check(
      'chk_resource_types_slug_not_empty',
      sql`length(trim(${table.slug})) > 0`,
    ),
    index('idx_resource_types_status_seq').on(table.status, table.sequenceOrder),
    index('idx_resource_types_pillar').on(table.pillar),
  ],
);

/**
 * content.resources
 * Logical educational resource entity (country-scoped, metadata-driven, file-independent).
 */
export const resources = contentSchema.table(
  'resources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    countryId: uuid('country_id')
      .notNull()
      .references(() => countries.id, { onDelete: 'restrict' }),
    resourceTypeId: uuid('resource_type_id')
      .notNull()
      .references(() => resourceTypes.id, { onDelete: 'restrict' }),
    schoolId: uuid('school_id').references(() => schools.id, {
      onDelete: 'restrict',
    }),
    curriculumId: uuid('curriculum_id').references(() => curricula.id, {
      onDelete: 'restrict',
    }),
    curriculumVersionId: uuid('curriculum_version_id').references(
      () => curriculumVersions.id,
      { onDelete: 'restrict' },
    ),
    educationLevelId: uuid('education_level_id').references(
      () => educationLevels.id,
      { onDelete: 'restrict' },
    ),
    gradeId: uuid('grade_id').references(() => grades.id, {
      onDelete: 'restrict',
    }),
    pathwayId: uuid('pathway_id').references(() => pathways.id, {
      onDelete: 'restrict',
    }),
    subjectId: uuid('subject_id').references(() => subjects.id, {
      onDelete: 'restrict',
    }),
    topicId: uuid('topic_id').references(() => topics.id, {
      onDelete: 'restrict',
    }),
    title: varchar('title', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 255 }).notNull(),
    description: text('description'),
    status: varchar('status', { length: 20 }).notNull().default('DRAFT'),
    qualityLabel: varchar('quality_label', { length: 20 })
      .notNull()
      .default('STANDARD'),
    sourceName: varchar('source_name', { length: 150 }),
    sourceReference: varchar('source_reference', { length: 255 }),
    academicYear: integer('academic_year'),
    term: integer('term'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_resources_country_slug').on(table.countryId, table.slug),
    unique('uq_resources_id_country').on(table.id, table.countryId),
    check(
      'chk_resources_title_not_empty',
      sql`length(trim(${table.title})) > 0`,
    ),
    check(
      'chk_resources_slug_not_empty',
      sql`length(trim(${table.slug})) > 0`,
    ),
    check(
      'chk_resources_status',
      sql`${table.status} IN ('DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED', 'REJECTED')`,
    ),
    check(
      'chk_resources_quality_label',
      sql`${table.qualityLabel} IN ('STANDARD', 'VERIFIED', 'PREMIUM')`,
    ),
    check(
      'chk_resources_term',
      sql`${table.term} IS NULL OR ${table.term} IN (1, 2, 3)`,
    ),
    check(
      'chk_resources_academic_year',
      sql`${table.academicYear} IS NULL OR (${table.academicYear} >= 1970 AND ${table.academicYear} <= 2100)`,
    ),
    // Explicit Parent-Dependency check for optional curriculum hierarchy
    check(
      'chk_resources_curriculum_parent_deps',
      sql`(${table.topicId} IS NULL OR ${table.subjectId} IS NOT NULL) AND (${table.subjectId} IS NULL OR ${table.gradeId} IS NOT NULL) AND (${table.pathwayId} IS NULL OR ${table.gradeId} IS NOT NULL) AND (${table.gradeId} IS NULL OR ${table.educationLevelId} IS NOT NULL) AND (${table.educationLevelId} IS NULL OR ${table.curriculumVersionId} IS NOT NULL) AND (${table.curriculumVersionId} IS NULL OR ${table.curriculumId} IS NOT NULL)`,
    ),
    // Composite Foreign Key ensuring school belongs to the same country as the resource
    foreignKey({
      name: 'fk_resources_school_country',
      columns: [table.schoolId, table.countryId],
      foreignColumns: [schools.id, schools.countryId],
    }).onDelete('restrict'),
    // Composite Foreign Keys ensuring strict taxonomy consistency
    foreignKey({
      name: 'fk_resources_curriculum_country',
      columns: [table.curriculumId, table.countryId],
      foreignColumns: [curricula.id, curricula.countryId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_resources_version_country',
      columns: [table.curriculumVersionId, table.countryId],
      foreignColumns: [curriculumVersions.id, curriculumVersions.countryId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_resources_version_curriculum',
      columns: [table.curriculumVersionId, table.curriculumId],
      foreignColumns: [curriculumVersions.id, curriculumVersions.curriculumId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_resources_level_version',
      columns: [table.educationLevelId, table.curriculumVersionId],
      foreignColumns: [educationLevels.id, educationLevels.curriculumVersionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_resources_grade_version',
      columns: [table.gradeId, table.curriculumVersionId],
      foreignColumns: [grades.id, grades.curriculumVersionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_resources_grade_level',
      columns: [table.gradeId, table.educationLevelId],
      foreignColumns: [grades.id, grades.educationLevelId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_resources_pathway_grade',
      columns: [table.pathwayId, table.gradeId],
      foreignColumns: [pathways.id, pathways.gradeId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_resources_subject_grade',
      columns: [table.subjectId, table.gradeId],
      foreignColumns: [subjects.id, subjects.gradeId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_resources_topic_subject',
      columns: [table.topicId, table.subjectId],
      foreignColumns: [topics.id, topics.subjectId],
    }).onDelete('restrict'),
    index('idx_resources_country_id').on(table.countryId),
    index('idx_resources_resource_type_id').on(table.resourceTypeId),
    index('idx_resources_school_id').on(table.schoolId),
    index('idx_resources_status').on(table.status),
    index('idx_resources_quality_label').on(table.qualityLabel),
    index('idx_resources_grade_id').on(table.gradeId),
    index('idx_resources_subject_id').on(table.subjectId),
    index('idx_resources_topic_id').on(table.topicId),
    index('idx_resources_academic_year').on(table.academicYear),
  ],
);

/**
 * content.resource_versions
 * Specific, version-controlled revision of a resource.
 */
export const resourceVersions = contentSchema.table(
  'resource_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'restrict' }),
    versionNumber: integer('version_number').notNull(),
    versionLabel: varchar('version_label', { length: 50 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    changeSummary: text('change_summary'),
    status: varchar('status', { length: 20 }).notNull().default('DRAFT'),
    qualityLabel: varchar('quality_label', { length: 20 })
      .notNull()
      .default('STANDARD'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_resource_versions_resource_num').on(
      table.resourceId,
      table.versionNumber,
    ),
    check('chk_resource_versions_num', sql`${table.versionNumber} > 0`),
    check(
      'chk_resource_versions_title_not_empty',
      sql`length(trim(${table.title})) > 0`,
    ),
    check(
      'chk_resource_versions_status',
      sql`${table.status} IN ('DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED', 'REJECTED')`,
    ),
    check(
      'chk_resource_versions_quality_label',
      sql`${table.qualityLabel} IN ('STANDARD', 'VERIFIED', 'PREMIUM')`,
    ),
    check(
      'chk_resource_versions_published_at',
      sql`(${table.status} = 'PUBLISHED' AND ${table.publishedAt} IS NOT NULL) OR (${table.status} <> 'PUBLISHED')`,
    ),
    index('idx_resource_versions_resource_id').on(table.resourceId),
    index('idx_resource_versions_status').on(table.status),
    index('idx_resource_versions_published_at').on(table.publishedAt),
  ],
);

// Drizzle Relations
export const resourceTypesRelations = relations(resourceTypes, ({ many }) => ({
  resources: many(resources),
}));

export const resourcesRelations = relations(resources, ({ one, many }) => ({
  country: one(countries, {
    fields: [resources.countryId],
    references: [countries.id],
  }),
  resourceType: one(resourceTypes, {
    fields: [resources.resourceTypeId],
    references: [resourceTypes.id],
  }),
  school: one(schools, {
    fields: [resources.schoolId],
    references: [schools.id],
  }),
  curriculum: one(curricula, {
    fields: [resources.curriculumId],
    references: [curricula.id],
  }),
  curriculumVersion: one(curriculumVersions, {
    fields: [resources.curriculumVersionId],
    references: [curriculumVersions.id],
  }),
  educationLevel: one(educationLevels, {
    fields: [resources.educationLevelId],
    references: [educationLevels.id],
  }),
  grade: one(grades, {
    fields: [resources.gradeId],
    references: [grades.id],
  }),
  pathway: one(pathways, {
    fields: [resources.pathwayId],
    references: [pathways.id],
  }),
  subject: one(subjects, {
    fields: [resources.subjectId],
    references: [subjects.id],
  }),
  topic: one(topics, {
    fields: [resources.topicId],
    references: [topics.id],
  }),
  versions: many(resourceVersions),
}));

export const resourceVersionsRelations = relations(
  resourceVersions,
  ({ one }) => ({
    resource: one(resources, {
      fields: [resourceVersions.resourceId],
      references: [resources.id],
    }),
  }),
);
