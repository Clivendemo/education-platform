import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { systemSchema } from '../logical-schemas.js';

/**
 * Distributed token-bucket state for Tier 2 security-critical rate limits (`Migration 0024`).
 * Retains UUID `id` primary key for 100% cursor compatibility with `RetentionService`.
 */
export const rateLimitBuckets = systemSchema.table(
  'rate_limit_buckets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bucketKey: varchar('bucket_key', { length: 160 }).notNull(),
    policyId: varchar('policy_id', { length: 64 }).notNull(),
    millitokens: bigint('millitokens', { mode: 'bigint' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('uq_rate_limit_buckets_bucket_key').on(table.bucketKey),
    index('idx_rate_limit_buckets_expires_at').on(table.expiresAt),
    check(
      'chk_rlb_bucket_key_bounds',
      sql`length(btrim(${table.bucketKey})) >= 16 AND length(${table.bucketKey}) <= 160`,
    ),
    check(
      'chk_rlb_policy_id_bounds',
      sql`length(btrim(${table.policyId})) >= 3 AND length(${table.policyId}) <= 64`,
    ),
    check(
      'chk_rlb_millitokens_bounds',
      sql`${table.millitokens} >= 0 AND ${table.millitokens} <= 1000000000`,
    ),
    check(
      'chk_rlb_expires_after_updated',
      sql`${table.expiresAt} > ${table.updatedAt}`,
    ),
  ],
);

/**
 * Two-phase atomic admission ledger (`UNCLAIMED -> CLAIMED`) preventing duplicate token burn
 * on ambiguous `Tx1` commits while guaranteeing terminal single-winner handler execution (`Tx2`).
 */
export const rateLimitAdmissions = systemSchema.table(
  'rate_limit_admissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    admissionKey: varchar('admission_key', { length: 200 }).notNull(),
    status: varchar('status', { length: 20 }).notNull(),
    claimToken: uuid('claim_token').notNull(),
    payloadFingerprint: varchar('payload_fingerprint', { length: 128 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('uq_rate_limit_admissions_key').on(table.admissionKey),
    index('idx_rate_limit_admissions_expires_at').on(table.expiresAt),
    check(
      'chk_rla_admission_key_bounds',
      sql`length(btrim(${table.admissionKey})) >= 16 AND length(${table.admissionKey}) <= 200`,
    ),
    check(
      'chk_rla_status_valid',
      sql`${table.status} IN ('UNCLAIMED', 'CLAIMED')`,
    ),
    check(
      'chk_rla_fingerprint_bounds',
      sql`length(btrim(${table.payloadFingerprint})) >= 32 AND length(${table.payloadFingerprint}) <= 128`,
    ),
    check(
      'chk_rla_claimed_at_consistency',
      sql`(${table.status} = 'UNCLAIMED' AND ${table.claimedAt} IS NULL) OR (${table.status} = 'CLAIMED' AND ${table.claimedAt} IS NOT NULL)`,
    ),
    check(
      'chk_rla_expires_after_created',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  ],
);

export type RateLimitBucket = typeof rateLimitBuckets.$inferSelect;
export type NewRateLimitBucket = typeof rateLimitBuckets.$inferInsert;
export type RateLimitAdmission = typeof rateLimitAdmissions.$inferSelect;
export type NewRateLimitAdmission = typeof rateLimitAdmissions.$inferInsert;
