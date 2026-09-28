import { sql, relations } from 'drizzle-orm';
import {
  uuid,
  varchar,
  integer,
  bigint,
  boolean,
  timestamp,
  jsonb,
  check,
  unique,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { filesSchema } from '../logical-schemas.js';
import { resourceVersions } from './resource.js';

/**
 * Controlled File Lifecycle Statuses
 */
export const FILE_STATUSES = [
  'PENDING',
  'AVAILABLE',
  'QUARANTINED',
  'ARCHIVED',
  'FAILED',
] as const;
export type FileStatus = (typeof FILE_STATUSES)[number];

/**
 * Supported Storage Providers
 */
export const STORAGE_PROVIDERS = [
  'CLOUDFLARE_R2',
  'AWS_S3',
  'MEMORY',
] as const;
export type StorageProviderType = (typeof STORAGE_PROVIDERS)[number];

/**
 * Controlled File Types for Educational Resources
 */
export const RESOURCE_FILE_TYPES = [
  'MAIN_DOCUMENT',
  'MARKING_SCHEME',
  'SUPPLEMENTARY',
  'CURRICULUM_GUIDE',
  'ACTIVITY_SHEET',
  'AUDIO_RESOURCE',
  'OTHER',
] as const;
export type ResourceFileType = (typeof RESOURCE_FILE_TYPES)[number];

/**
 * files.resource_files
 * Authoritative PostgreSQL metadata record for binary assets attached to a resource version.
 */
export const resourceFiles = filesSchema.table(
  'resource_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resourceVersionId: uuid('resource_version_id')
      .notNull()
      .references(() => resourceVersions.id, { onDelete: 'restrict' }),
    storageProvider: varchar('storage_provider', { length: 32 })
      .notNull()
      .default('CLOUDFLARE_R2'),
    storageBucket: varchar('storage_bucket', { length: 128 }).notNull(),
    objectKey: varchar('object_key', { length: 512 }).notNull(),
    originalFilename: varchar('original_filename', { length: 255 }).notNull(),
    fileExtension: varchar('file_extension', { length: 20 }).notNull(),
    fileType: varchar('file_type', { length: 32 })
      .notNull()
      .default('MAIN_DOCUMENT'),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }).notNull(),
    checksumSha256: varchar('checksum_sha256', { length: 64 }).notNull(),
    storageMetadata: jsonb('storage_metadata').default(sql`'{}'::jsonb`),
    status: varchar('status', { length: 20 }).notNull().default('AVAILABLE'),
    isPrimary: boolean('is_primary').notNull().default(false),
    sequenceOrder: integer('sequence_order').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_resource_files_bucket_key').on(
      table.storageBucket,
      table.objectKey,
    ),
    unique('uq_resource_files_version_seq').on(
      table.resourceVersionId,
      table.sequenceOrder,
    ),
    unique('uq_resource_files_version_checksum').on(
      table.resourceVersionId,
      table.checksumSha256,
    ),
    uniqueIndex('uq_resource_files_primary_version')
      .on(table.resourceVersionId)
      .where(sql`${table.isPrimary} = true`),
    check(
      'chk_resource_files_status',
      sql`${table.status} IN ('PENDING', 'AVAILABLE', 'QUARANTINED', 'ARCHIVED', 'FAILED')`,
    ),
    check(
      'chk_resource_files_storage_provider',
      sql`${table.storageProvider} IN ('CLOUDFLARE_R2', 'AWS_S3', 'MEMORY')`,
    ),
    check('chk_resource_files_file_size_bytes', sql`${table.fileSizeBytes} > 0`),
    check('chk_resource_files_sequence_order', sql`${table.sequenceOrder} > 0`),
    check(
      'chk_resource_files_sha256',
      sql`length(trim(${table.checksumSha256})) = 64`,
    ),
    check(
      'chk_resource_files_filename',
      sql`length(trim(${table.originalFilename})) > 0`,
    ),
    check(
      'chk_resource_files_file_extension',
      sql`length(trim(${table.fileExtension})) > 0`,
    ),
    check(
      'chk_resource_files_object_key',
      sql`length(trim(${table.objectKey})) > 0`,
    ),
    check(
      'chk_resource_files_storage_bucket',
      sql`length(trim(${table.storageBucket})) > 0`,
    ),
    check(
      'chk_resource_files_file_type',
      sql`${table.fileType} IN ('MAIN_DOCUMENT', 'MARKING_SCHEME', 'SUPPLEMENTARY', 'CURRICULUM_GUIDE', 'ACTIVITY_SHEET', 'AUDIO_RESOURCE', 'OTHER')`,
    ),
    index('idx_resource_files_version_id').on(table.resourceVersionId),
    index('idx_resource_files_checksum').on(table.checksumSha256),
    index('idx_resource_files_status').on(table.status),
  ],
);

// Drizzle Relations
export const resourceFilesRelations = relations(resourceFiles, ({ one }) => ({
  resourceVersion: one(resourceVersions, {
    fields: [resourceFiles.resourceVersionId],
    references: [resourceVersions.id],
  }),
}));
