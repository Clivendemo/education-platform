import { sql, relations } from 'drizzle-orm';
import {
  uuid,
  varchar,
  text,
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
 * Controlled Malware Scan Statuses (Wave 1 WP6)
 */
export const MALWARE_SCAN_STATUSES = [
  'PENDING',
  'CLEAN',
  'INFECTED',
  'SCAN_ERROR',
] as const;
export type MalwareScanStatus = (typeof MALWARE_SCAN_STATUSES)[number];

/**
 * Controlled File Processing Job Statuses
 */
export const FILE_PROCESSING_JOB_STATUSES = [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'QUARANTINED',
  'FAILED',
] as const;
export type FileProcessingJobStatus = (typeof FILE_PROCESSING_JOB_STATUSES)[number];

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
    status: varchar('status', { length: 20 }).notNull().default('PENDING'),
    malwareScanStatus: varchar('malware_scan_status', { length: 30 })
      .notNull()
      .default('PENDING'),
    malwareScanSignature: varchar('malware_scan_signature', { length: 255 }),
    scannedAt: timestamp('scanned_at', { withTimezone: true }),
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
      'chk_resource_files_scan_status',
      sql`${table.malwareScanStatus} IN ('PENDING', 'CLEAN', 'INFECTED', 'SCAN_ERROR')`,
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
    index('idx_res_files_created_id_desc').on(
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index('idx_res_files_updated_id_desc').on(
      table.updatedAt.desc(),
      table.id.desc(),
    ),
    index('idx_res_files_size_id_desc').on(
      table.fileSizeBytes.desc(),
      table.id.desc(),
    ),
    index('idx_res_files_status_created_id_desc').on(
      table.status,
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);

/**
 * files.file_processing_jobs
 * Durable queue & lease-fenced state machine for asynchronous malware scanning and promotion.
 */
export const fileProcessingJobs = filesSchema.table(
  'file_processing_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => resourceFiles.id, { onDelete: 'cascade' }),
    stagedObjectKey: varchar('staged_object_key', { length: 512 }).notNull(),
    targetObjectKey: varchar('target_object_key', { length: 512 }).notNull(),
    expectedSha256: varchar('expected_sha256', { length: 64 }).notNull(),
    expectedSizeBytes: bigint('expected_size_bytes', { mode: 'number' }).notNull(),
    cleanVerifiedSha256: varchar('clean_verified_sha256', { length: 64 }),
    status: varchar('status', { length: 24 }).notNull().default('PENDING'),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    fencingToken: bigint('fencing_token', { mode: 'number' }).notNull().default(0),
    lockedBy: varchar('locked_by', { length: 100 }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    nextRunAt: timestamp('next_run_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_file_processing_jobs_file_id').on(table.fileId),
    check(
      'chk_file_processing_jobs_status',
      sql`${table.status} IN ('PENDING', 'RUNNING', 'COMPLETED', 'QUARANTINED', 'FAILED')`,
    ),
    check('chk_file_processing_jobs_size', sql`${table.expectedSizeBytes} > 0`),
    check(
      'chk_file_processing_jobs_attempts',
      sql`${table.attemptCount} >= 0 AND ${table.maxAttempts} >= 1`,
    ),
    index('idx_file_processing_jobs_claim').on(
      table.status,
      table.nextRunAt,
      table.leaseExpiresAt,
    ),
  ],
);

/**
 * files.file_processing_history
 * Immutable audit trail of scan, lease, promotion, and recovery transitions.
 */
export const fileProcessingHistory = filesSchema.table(
  'file_processing_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => fileProcessingJobs.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id')
      .notNull()
      .references(() => resourceFiles.id, { onDelete: 'cascade' }),
    eventType: varchar('event_type', { length: 40 }).notNull(),
    fencingToken: bigint('fencing_token', { mode: 'number' }).notNull().default(0),
    workerId: varchar('worker_id', { length: 100 }),
    details: jsonb('details').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_file_processing_history_file_id').on(
      table.fileId,
      table.createdAt.desc(),
    ),
  ],
);

// Drizzle Relations
export const resourceFilesRelations = relations(resourceFiles, ({ one }) => ({
  resourceVersion: one(resourceVersions, {
    fields: [resourceFiles.resourceVersionId],
    references: [resourceVersions.id],
  }),
}));
