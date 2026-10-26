import { sql, type SQL } from 'drizzle-orm';
import {
  resources,
  resourceVersions,
  resourceFiles,
  resourceFeedback,
} from '../db/schemas.js';

/**
 * Canonical 6 Operational Attention Flags (Prompt 31 Revision 4).
 * Single source of truth shared across:
 * 1. GET /api/v1/admin/dashboard/overview (counts & distinct resource count)
 * 2. GET /api/v1/admin/resources (row projection & ?attentionFlag filter)
 * 3. GET /api/v1/admin/publications/review-queue (row projection)
 * 4. GET /api/v1/admin/resources/:id (detail projection)
 */
export const ADMIN_ATTENTION_FLAGS = [
  'PENDING_REVIEW',
  'APPROVED_AWAITING_PUBLISH',
  'PUBLISHED_WITHOUT_AVAILABLE_FILE',
  'IN_REVIEW_WITHOUT_CANDIDATE_VERSION',
  'HAS_PROBLEMATIC_FILES',
  'HAS_OPEN_DEFECT_FEEDBACK',
] as const;

export type AdminAttentionFlag = (typeof ADMIN_ATTENTION_FLAGS)[number];

export interface RawAttentionBooleanColumns {
  flagPendingReview: boolean;
  flagApprovedAwaitingPublish: boolean;
  flagPublishedWithoutAvailableFile: boolean;
  flagInReviewWithoutCandidateVersion: boolean;
  flagHasProblematicFiles: boolean;
  flagHasOpenDefectFeedback: boolean;
}

type ResourceTableRef = typeof resources;

/**
 * 1. PENDING_REVIEW: parent resource is currently IN_REVIEW.
 */
export function sqlPendingReview(_r: ResourceTableRef = resources): SQL<boolean> {
  return sql<boolean>`("content"."resources"."status" = 'IN_REVIEW')`;
}

/**
 * 2. APPROVED_AWAITING_PUBLISH: parent resource is APPROVED and awaiting final publication.
 */
export function sqlApprovedAwaitingPublish(_r: ResourceTableRef = resources): SQL<boolean> {
  return sql<boolean>`("content"."resources"."status" = 'APPROVED')`;
}

/**
 * 3. PUBLISHED_WITHOUT_AVAILABLE_FILE: parent resource is PUBLISHED, and lacks an AVAILABLE
 * primary file (is_primary = true AND status = 'AVAILABLE') on a PUBLISHED resource version.
 */
export function sqlPublishedWithoutAvailableFile(
  _r: ResourceTableRef = resources,
): SQL<boolean> {
  return sql<boolean>`("content"."resources"."status" = 'PUBLISHED' AND NOT EXISTS (
    SELECT 1
    FROM ${resourceVersions} rv
    INNER JOIN ${resourceFiles} rf ON rf.resource_version_id = rv.id
    WHERE rv.resource_id = "content"."resources"."id"
      AND rv.status = 'PUBLISHED'
      AND rf.is_primary = true
      AND rf.status = 'AVAILABLE'
  ))`;
}

/**
 * 4. IN_REVIEW_WITHOUT_CANDIDATE_VERSION: parent resource is IN_REVIEW or APPROVED,
 * and zero resource_versions exist in status = 'IN_REVIEW' (required by approveResource,
 * rejectResource, and publishResourceVersion).
 */
export function sqlInReviewWithoutCandidateVersion(
  _r: ResourceTableRef = resources,
): SQL<boolean> {
  return sql<boolean>`("content"."resources"."status" IN ('IN_REVIEW', 'APPROVED') AND NOT EXISTS (
    SELECT 1
    FROM ${resourceVersions} rv
    WHERE rv.resource_id = "content"."resources"."id"
      AND rv.status = 'IN_REVIEW'
  ))`;
}

/**
 * 5. HAS_PROBLEMATIC_FILES: parent resource is non-terminal (status <> 'ARCHIVED') and has
 * at least one active/non-historical version (DRAFT, IN_REVIEW, APPROVED, PUBLISHED)
 * with an attached file in QUARANTINED or FAILED status.
 */
export function sqlHasProblematicFiles(_r: ResourceTableRef = resources): SQL<boolean> {
  return sql<boolean>`("content"."resources"."status" <> 'ARCHIVED' AND EXISTS (
    SELECT 1
    FROM ${resourceVersions} rv
    INNER JOIN ${resourceFiles} rf ON rf.resource_version_id = rv.id
    WHERE rv.resource_id = "content"."resources"."id"
      AND rv.status IN ('DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED')
      AND rf.status IN ('QUARANTINED', 'FAILED')
  ))`;
}

/**
 * 6. HAS_OPEN_DEFECT_FEEDBACK: parent resource is non-terminal (status <> 'ARCHIVED') and has
 * at least one open feedback item (PENDING, UNDER_REVIEW, REOPENED) whose category is not HELPFUL.
 */
export function sqlHasOpenDefectFeedback(_r: ResourceTableRef = resources): SQL<boolean> {
  return sql<boolean>`("content"."resources"."status" <> 'ARCHIVED' AND EXISTS (
    SELECT 1
    FROM ${resourceFeedback} fb
    WHERE fb.resource_id = "content"."resources"."id"
      AND fb.status IN ('PENDING', 'UNDER_REVIEW', 'REOPENED')
      AND fb.feedback_type <> 'HELPFUL'
  ))`;
}

/**
 * Boolean OR across all 6 canonical flags (used to count distinct resources requiring attention).
 */
export function sqlAnyAttentionFlag(r: ResourceTableRef = resources): SQL<boolean> {
  return sql<boolean>`(
    ${sqlPendingReview(r)}
    OR ${sqlApprovedAwaitingPublish(r)}
    OR ${sqlPublishedWithoutAvailableFile(r)}
    OR ${sqlInReviewWithoutCandidateVersion(r)}
    OR ${sqlHasProblematicFiles(r)}
    OR ${sqlHasOpenDefectFeedback(r)}
  )`;
}

/**
 * Maps a single AdminAttentionFlag filter parameter to its authoritative SQL predicate.
 */
export function sqlAttentionWhereClause(
  flag: AdminAttentionFlag,
  r: ResourceTableRef = resources,
): SQL<boolean> {
  switch (flag) {
    case 'PENDING_REVIEW':
      return sqlPendingReview(r);
    case 'APPROVED_AWAITING_PUBLISH':
      return sqlApprovedAwaitingPublish(r);
    case 'PUBLISHED_WITHOUT_AVAILABLE_FILE':
      return sqlPublishedWithoutAvailableFile(r);
    case 'IN_REVIEW_WITHOUT_CANDIDATE_VERSION':
      return sqlInReviewWithoutCandidateVersion(r);
    case 'HAS_PROBLEMATIC_FILES':
      return sqlHasProblematicFiles(r);
    case 'HAS_OPEN_DEFECT_FEEDBACK':
      return sqlHasOpenDefectFeedback(r);
  }
}

/**
 * Standard Drizzle select projection for all 6 attention flags on a resource query.
 */
export function sqlAttentionSelectFields(r: ResourceTableRef = resources) {
  return {
    flagPendingReview: sqlPendingReview(r),
    flagApprovedAwaitingPublish: sqlApprovedAwaitingPublish(r),
    flagPublishedWithoutAvailableFile: sqlPublishedWithoutAvailableFile(r),
    flagInReviewWithoutCandidateVersion: sqlInReviewWithoutCandidateVersion(r),
    flagHasProblematicFiles: sqlHasProblematicFiles(r),
    flagHasOpenDefectFeedback: sqlHasOpenDefectFeedback(r),
  };
}

/**
 * Converts projected SQL boolean columns into the ordered AdminAttentionFlag[] array.
 * Handles overlapping flags deterministically in canonical ADMIN_ATTENTION_FLAGS order.
 */
export function mapAttentionFlagsFromRow(
  row: RawAttentionBooleanColumns,
): AdminAttentionFlag[] {
  const flags: AdminAttentionFlag[] = [];
  if (row.flagPendingReview) {
    flags.push('PENDING_REVIEW');
  }
  if (row.flagApprovedAwaitingPublish) {
    flags.push('APPROVED_AWAITING_PUBLISH');
  }
  if (row.flagPublishedWithoutAvailableFile) {
    flags.push('PUBLISHED_WITHOUT_AVAILABLE_FILE');
  }
  if (row.flagInReviewWithoutCandidateVersion) {
    flags.push('IN_REVIEW_WITHOUT_CANDIDATE_VERSION');
  }
  if (row.flagHasProblematicFiles) {
    flags.push('HAS_PROBLEMATIC_FILES');
  }
  if (row.flagHasOpenDefectFeedback) {
    flags.push('HAS_OPEN_DEFECT_FEEDBACK');
  }
  return flags;
}
