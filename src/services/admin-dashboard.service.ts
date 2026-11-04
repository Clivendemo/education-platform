import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { db as defaultDb, type AppDatabase } from '../db/index.js';
import {
  analyticsEvents,
  auditLogs,
  contributors,
  contributorApplications,
  countries,
  curricula,
  dataRetentionActions,
  educationLevels,
  educationUpdates,
  grades,
  notificationDeliveries,
  publicationEvents,
  qualityCheckTypes,
  resourceFeedback,
  resourceFiles,
  resourceQualityChecks,
  resources,
  resourceTypes,
  resourceVerifications,
  resourceVersions,
  retentionPolicies,
  schools,
  subjects,
  topics,
  users,
  type FileStatus,
  type PublicationEventType,
  type QualityLabel,
  type ResourceFileType,
  type ResourceStatus,
  type StorageProviderType,
} from '../db/schemas.js';
import {
  ADMIN_ATTENTION_FLAGS,
  mapAttentionFlagsFromRow,
  sqlAnyAttentionFlag,
  sqlApprovedAwaitingPublish,
  sqlAttentionSelectFields,
  sqlAttentionWhereClause,
  sqlHasOpenDefectFeedback,
  sqlHasProblematicFiles,
  sqlInReviewWithoutCandidateVersion,
  sqlPendingReview,
  sqlPublishedWithoutAvailableFile,
  type AdminAttentionFlag,
} from './admin-attention.js';
import {
  defaultRbacService,
  type PermissionAccessResolution,
  type RbacService,
} from './rbac.service.js';
import {
  defaultFileStorageService,
  FileStorageError,
  type FileStorageService,
} from './file-storage.service.js';
import {
  defaultAuditService,
  type ActorSnapshot,
  type AuditService,
} from './audit.service.js';
import { GENERIC_FORBIDDEN_MESSAGE } from '../routes/hooks/authorize.js';

export class AdminDashboardError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
    public readonly metadata?: {
      targetCountryId?: string | null;
      entityType?: string;
      entityId?: string | null;
    },
  ) {
    super(message);
    this.name = 'AdminDashboardError';
  }
}

export type EffectiveCountryScope =
  | { mode: 'GLOBAL' }
  | { mode: 'SINGLE'; countryId: string }
  | { mode: 'MULTI'; countryIds: string[] };

export interface AdminActorContext {
  actorUserId: string;
  actorSnapshot: ActorSnapshot;
  requestId?: string | null;
}

export interface AdminOverviewParams {
  actorUserId: string;
  dashboardAccess: PermissionAccessResolution;
  countryId?: string;
}

export interface AdminListResourcesParams {
  countryId?: string;
  status?: ResourceStatus;
  qualityLabel?: QualityLabel;
  resourceTypeId?: string;
  curriculumId?: string;
  educationLevelId?: string;
  gradeId?: string;
  subjectId?: string;
  topicId?: string;
  schoolId?: string;
  contributorId?: string;
  academicYear?: number;
  term?: number;
  attentionFlag?: AdminAttentionFlag;
  search?: string;
  sortBy?: 'updatedAt' | 'createdAt' | 'title';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface AdminReviewQueueParams {
  countryId?: string;
  queueState?: 'ALL' | 'IN_REVIEW' | 'APPROVED';
  resourceTypeId?: string;
  gradeId?: string;
  subjectId?: string;
  sortBy?: 'updatedAt' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface AdminListPublicationEventsParams {
  countryId?: string;
  resourceId?: string;
  eventType?: PublicationEventType;
  actorUserId?: string;
  fromDate?: Date;
  toDate?: Date;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface AdminListFilesParams {
  countryId?: string;
  resourceId?: string;
  resourceVersionId?: string;
  status?: FileStatus;
  storageProvider?: StorageProviderType;
  fileType?: ResourceFileType;
  isPrimary?: boolean;
  versionStatus?: ResourceStatus;
  checksumSha256?: string;
  sortBy?: 'createdAt' | 'updatedAt' | 'fileSizeBytes';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface ControlledAdminFileRecord {
  id: string;
  resourceVersionId: string;
  resourceId: string;
  country: {
    id: string;
    name: string;
    isoCode: string;
  };
  versionNumber: number;
  versionLabel: string;
  versionStatus: string;
  immutableUnderPublishedVersion: boolean;
  storageProvider: string;
  originalFilename: string;
  fileExtension: string;
  fileType: string;
  mimeType: string;
  fileSizeBytes: number;
  checksumSha256: string;
  status: string;
  isPrimary: boolean;
  sequenceOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminPaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export interface AdminDashboardService {
  getOverview(params: AdminOverviewParams): Promise<Record<string, unknown>>;
  listResources(
    params: AdminListResourcesParams,
    access: PermissionAccessResolution,
  ): Promise<AdminPaginatedResponse<Record<string, unknown>>>;
  getResourceById(
    resourceId: string,
    actorUserId: string,
    access: PermissionAccessResolution,
  ): Promise<Record<string, unknown>>;
  getReviewQueue(
    params: AdminReviewQueueParams,
    access: PermissionAccessResolution,
  ): Promise<AdminPaginatedResponse<Record<string, unknown>>>;
  listPublicationEvents(
    params: AdminListPublicationEventsParams,
    access: PermissionAccessResolution,
  ): Promise<AdminPaginatedResponse<Record<string, unknown>>>;
  listFiles(
    params: AdminListFilesParams,
    access: PermissionAccessResolution,
  ): Promise<AdminPaginatedResponse<ControlledAdminFileRecord>>;
  getFileById(
    fileId: string,
    access: PermissionAccessResolution,
  ): Promise<Record<string, unknown>>;
  verifyFileIntegrity(
    fileId: string,
    actorContext: AdminActorContext,
    access: PermissionAccessResolution,
    options?: { signal?: AbortSignal },
  ): Promise<Record<string, unknown>>;
}

function escapeLikePattern(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export function resolveEffectiveCountryScope(
  access: PermissionAccessResolution,
  requestedCountryId?: string,
): EffectiveCountryScope {
  if (!access.granted) {
    throw new AdminDashboardError('FORBIDDEN', GENERIC_FORBIDDEN_MESSAGE, 403);
  }

  if (requestedCountryId) {
    if (!access.hasGlobalGrant && !access.countryIds.includes(requestedCountryId)) {
      throw new AdminDashboardError('FORBIDDEN', GENERIC_FORBIDDEN_MESSAGE, 403, {
        targetCountryId: requestedCountryId,
      });
    }
    return { mode: 'SINGLE', countryId: requestedCountryId };
  }

  if (access.hasGlobalGrant) {
    return { mode: 'GLOBAL' };
  }

  if (access.countryIds.length === 1) {
    return { mode: 'SINGLE', countryId: access.countryIds[0] };
  }

  if (access.countryIds.length > 1) {
    return { mode: 'MULTI', countryIds: access.countryIds };
  }

  throw new AdminDashboardError('FORBIDDEN', GENERIC_FORBIDDEN_MESSAGE, 403);
}

function buildCountryCondition(
  countryColumn: any,
  scope: EffectiveCountryScope,
): SQL | undefined {
  if (scope.mode === 'GLOBAL') {
    return undefined;
  }
  if (scope.mode === 'SINGLE') {
    return eq(countryColumn, scope.countryId);
  }
  return inArray(countryColumn, scope.countryIds);
}

function intersectCountryScopeWithPermission(
  baseScope: EffectiveCountryScope,
  subAccess: PermissionAccessResolution,
): EffectiveCountryScope | null {
  if (!subAccess.granted) {
    return null;
  }
  if (subAccess.hasGlobalGrant) {
    return baseScope;
  }
  if (baseScope.mode === 'GLOBAL') {
    if (subAccess.countryIds.length === 1) {
      return { mode: 'SINGLE', countryId: subAccess.countryIds[0] };
    }
    if (subAccess.countryIds.length > 1) {
      return { mode: 'MULTI', countryIds: subAccess.countryIds };
    }
    return null;
  }
  if (baseScope.mode === 'SINGLE') {
    return subAccess.countryIds.includes(baseScope.countryId) ? baseScope : null;
  }
  const overlap = baseScope.countryIds.filter((id) => subAccess.countryIds.includes(id));
  if (overlap.length === 0) return null;
  if (overlap.length === 1) return { mode: 'SINGLE', countryId: overlap[0] };
  return { mode: 'MULTI', countryIds: overlap };
}

export interface VerifyRateLimiterOptions {
  maxRequestsPerWindow?: number;
  windowMs?: number;
  nowFn?: () => number;
}

export class DefaultAdminDashboardService implements AdminDashboardService {
  private readonly verifyBuckets = new Map<string, number[]>();
  private readonly maxVerifyPerWindow: number;
  private readonly verifyWindowMs: number;
  private readonly nowFn: () => number;

  constructor(
    private readonly dbInstance: AppDatabase = defaultDb,
    private readonly rbacService: RbacService = defaultRbacService,
    private readonly fileStorageService: FileStorageService = defaultFileStorageService,
    private readonly auditService: AuditService = defaultAuditService,
    rateLimitOpts?: VerifyRateLimiterOptions,
  ) {
    this.maxVerifyPerWindow = rateLimitOpts?.maxRequestsPerWindow ?? 20;
    this.verifyWindowMs = rateLimitOpts?.windowMs ?? 60_000;
    this.nowFn = rateLimitOpts?.nowFn ?? (() => Date.now());
  }

  private enforceVerifyRateLimit(actorUserId: string): void {
    const now = this.nowFn();
    const cutoff = now - this.verifyWindowMs;
    const recent = (this.verifyBuckets.get(actorUserId) ?? []).filter((ts) => ts > cutoff);

    if (recent.length >= this.maxVerifyPerWindow) {
      this.verifyBuckets.set(actorUserId, recent);
      throw new AdminDashboardError(
        'RATE_LIMIT_EXCEEDED',
        'Too many file integrity verification requests. Please wait before retrying.',
        429,
      );
    }

    recent.push(now);
    this.verifyBuckets.set(actorUserId, recent);
  }

  private async resolveSubAccess(
    userId: string,
    permissionName: string,
  ): Promise<PermissionAccessResolution> {
    if (typeof this.rbacService.resolvePermissionAccess === 'function') {
      return this.rbacService.resolvePermissionAccess(userId, permissionName);
    }
    const granted = await this.rbacService.hasPermission(userId, permissionName);
    return {
      granted,
      hasGlobalGrant: granted,
      countryIds: [],
    };
  }

  /**
   * 1. GET /api/v1/admin/dashboard/overview
   */
  async getOverview(params: AdminOverviewParams): Promise<Record<string, unknown>> {
    const effectiveScope = resolveEffectiveCountryScope(
      params.dashboardAccess,
      params.countryId,
    );
    const resourceScopeCond = buildCountryCondition(resources.countryId, effectiveScope);

    const now = new Date();
    const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const cutoff7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // 1a. Resource lifecycle, quality, queue, and canonical 6-flag attention summary in one pass
    const [resourceStatsRow] = await this.dbInstance
      .select({
        total: sql<number>`count(*)::int`,
        draftCount: sql<number>`count(*) FILTER (WHERE ${resources.status} = 'DRAFT')::int`,
        inReviewCount: sql<number>`count(*) FILTER (WHERE ${resources.status} = 'IN_REVIEW')::int`,
        approvedCount: sql<number>`count(*) FILTER (WHERE ${resources.status} = 'APPROVED')::int`,
        publishedCount: sql<number>`count(*) FILTER (WHERE ${resources.status} = 'PUBLISHED')::int`,
        archivedCount: sql<number>`count(*) FILTER (WHERE ${resources.status} = 'ARCHIVED')::int`,
        rejectedCount: sql<number>`count(*) FILTER (WHERE ${resources.status} = 'REJECTED')::int`,
        standardCount: sql<number>`count(*) FILTER (WHERE ${resources.qualityLabel} = 'STANDARD')::int`,
        verifiedCount: sql<number>`count(*) FILTER (WHERE ${resources.qualityLabel} = 'VERIFIED')::int`,
        premiumCount: sql<number>`count(*) FILTER (WHERE ${resources.qualityLabel} = 'PREMIUM')::int`,
        oldestQueuedUpdatedAt: sql<Date | string | null>`min(${resources.updatedAt}) FILTER (WHERE ${resources.status} IN ('IN_REVIEW', 'APPROVED'))`,
        totalRequiringAttention: sql<number>`count(*) FILTER (WHERE ${sqlAnyAttentionFlag(resources)})::int`,
        attPendingReview: sql<number>`count(*) FILTER (WHERE ${sqlPendingReview(resources)})::int`,
        attApprovedAwaitingPublish: sql<number>`count(*) FILTER (WHERE ${sqlApprovedAwaitingPublish(resources)})::int`,
        attPublishedWithoutAvailableFile: sql<number>`count(*) FILTER (WHERE ${sqlPublishedWithoutAvailableFile(resources)})::int`,
        attInReviewWithoutCandidateVersion: sql<number>`count(*) FILTER (WHERE ${sqlInReviewWithoutCandidateVersion(resources)})::int`,
        attHasProblematicFiles: sql<number>`count(*) FILTER (WHERE ${sqlHasProblematicFiles(resources)})::int`,
        attHasOpenDefectFeedback: sql<number>`count(*) FILTER (WHERE ${sqlHasOpenDefectFeedback(resources)})::int`,
      })
      .from(resources)
      .where(resourceScopeCond);

    // 1b. Publication activity counts & recent 10 events (country-scoped via resources)
    const pubWhereCond = resourceScopeCond ? and(resourceScopeCond) : undefined;
    const [pubWindowStats] = await this.dbInstance
      .select({
        last24hCount: sql<number>`count(*) FILTER (WHERE ${publicationEvents.createdAt} >= ${cutoff24h})::int`,
        last7dCount: sql<number>`count(*) FILTER (WHERE ${publicationEvents.createdAt} >= ${cutoff7d})::int`,
      })
      .from(publicationEvents)
      .innerJoin(resources, eq(publicationEvents.resourceId, resources.id))
      .where(pubWhereCond);

    const recentPubEvents = await this.dbInstance
      .select({
        id: publicationEvents.id,
        resourceId: publicationEvents.resourceId,
        resourceTitle: resources.title,
        resourceSlug: resources.slug,
        countryId: resources.countryId,
        resourceVersionId: publicationEvents.resourceVersionId,
        eventType: publicationEvents.eventType,
        fromStatus: publicationEvents.fromStatus,
        toStatus: publicationEvents.toStatus,
        actorUserId: publicationEvents.actorUserId,
        createdAt: publicationEvents.createdAt,
      })
      .from(publicationEvents)
      .innerJoin(resources, eq(publicationEvents.resourceId, resources.id))
      .where(pubWhereCond)
      .orderBy(desc(publicationEvents.createdAt), desc(publicationEvents.id))
      .limit(10);

    // Resolve optional domain sub-permissions in parallel
    const [
      fileReadAccess,
      qualityReadAccess,
      feedbackReadAccess,
      updateReadAccess,
      contributorManageAccess,
      notificationReadAccess,
      analyticsReadAccess,
      auditReadAccess,
      retentionReadAccess,
    ] = await Promise.all([
      this.resolveSubAccess(params.actorUserId, 'file.admin.read'),
      this.resolveSubAccess(params.actorUserId, 'quality.read'),
      this.resolveSubAccess(params.actorUserId, 'feedback.read'),
      this.resolveSubAccess(params.actorUserId, 'update.read'),
      this.resolveSubAccess(params.actorUserId, 'contributor.manage'),
      this.resolveSubAccess(params.actorUserId, 'notification.admin.read'),
      this.resolveSubAccess(params.actorUserId, 'analytics.read'),
      this.resolveSubAccess(params.actorUserId, 'audit.read'),
      this.resolveSubAccess(params.actorUserId, 'retention.read'),
    ]);

    const redactedSections: string[] = [];

    // 1c. File storage summary (gated by file.admin.read)
    let fileStorageSection: Record<string, unknown> | null = null;
    const effectiveFileScope = intersectCountryScopeWithPermission(
      effectiveScope,
      fileReadAccess,
    );
    if (effectiveFileScope) {
      const fileCountryCond = buildCountryCondition(resources.countryId, effectiveFileScope);
      const [fileStats] = await this.dbInstance
        .select({
          totalFiles: sql<number>`count(*)::int`,
          totalBytes: sql<number>`COALESCE(sum(${resourceFiles.fileSizeBytes}), 0)::bigint`,
          pendingCount: sql<number>`count(*) FILTER (WHERE ${resourceFiles.status} = 'PENDING')::int`,
          availableCount: sql<number>`count(*) FILTER (WHERE ${resourceFiles.status} = 'AVAILABLE')::int`,
          quarantinedCount: sql<number>`count(*) FILTER (WHERE ${resourceFiles.status} = 'QUARANTINED')::int`,
          archivedCount: sql<number>`count(*) FILTER (WHERE ${resourceFiles.status} = 'ARCHIVED')::int`,
          failedCount: sql<number>`count(*) FILTER (WHERE ${resourceFiles.status} = 'FAILED')::int`,
          r2Count: sql<number>`count(*) FILTER (WHERE ${resourceFiles.storageProvider} = 'CLOUDFLARE_R2')::int`,
          s3Count: sql<number>`count(*) FILTER (WHERE ${resourceFiles.storageProvider} = 'AWS_S3')::int`,
          memoryCount: sql<number>`count(*) FILTER (WHERE ${resourceFiles.storageProvider} = 'MEMORY')::int`,
        })
        .from(resourceFiles)
        .innerJoin(
          resourceVersions,
          eq(resourceFiles.resourceVersionId, resourceVersions.id),
        )
        .innerJoin(resources, eq(resourceVersions.resourceId, resources.id))
        .where(fileCountryCond);

      fileStorageSection = {
        totalFiles: Number(fileStats?.totalFiles ?? 0),
        totalBytes: Number(fileStats?.totalBytes ?? 0),
        byStatus: {
          PENDING: Number(fileStats?.pendingCount ?? 0),
          AVAILABLE: Number(fileStats?.availableCount ?? 0),
          QUARANTINED: Number(fileStats?.quarantinedCount ?? 0),
          ARCHIVED: Number(fileStats?.archivedCount ?? 0),
          FAILED: Number(fileStats?.failedCount ?? 0),
        },
        byProvider: {
          CLOUDFLARE_R2: Number(fileStats?.r2Count ?? 0),
          AWS_S3: Number(fileStats?.s3Count ?? 0),
          MEMORY: Number(fileStats?.memoryCount ?? 0),
        },
      };
    } else {
      redactedSections.push('fileStorage');
    }

    // 1d. Quality Governance summary (gated by quality.read)
    let qualityGovernanceSection: Record<string, unknown> | null = null;
    if (qualityReadAccess.granted) {
      const [verStats] = await this.dbInstance
        .select({
          activeVerificationsCount: sql<number>`count(*) FILTER (WHERE ${resourceVerifications.verificationStatus} = 'VERIFIED')::int`,
          revokedVerificationsCount: sql<number>`count(*) FILTER (WHERE ${resourceVerifications.verificationStatus} = 'REVOKED')::int`,
        })
        .from(resourceVerifications)
        .innerJoin(resources, eq(resourceVerifications.resourceId, resources.id))
        .where(resourceScopeCond);

      const checkConditions: SQL[] = [gte(resourceQualityChecks.checkedAt, cutoff7d)];
      if (resourceScopeCond) checkConditions.push(resourceScopeCond);

      const [checkStats] = await this.dbInstance
        .select({
          passedCount: sql<number>`count(*) FILTER (WHERE ${resourceQualityChecks.status} = 'PASSED')::int`,
          failedCount: sql<number>`count(*) FILTER (WHERE ${resourceQualityChecks.status} = 'FAILED')::int`,
          flaggedCount: sql<number>`count(*) FILTER (WHERE ${resourceQualityChecks.status} = 'FLAGGED')::int`,
        })
        .from(resourceQualityChecks)
        .innerJoin(resources, eq(resourceQualityChecks.resourceId, resources.id))
        .where(and(...checkConditions));

      qualityGovernanceSection = {
        activeVerificationsCount: Number(verStats?.activeVerificationsCount ?? 0),
        revokedVerificationsCount: Number(verStats?.revokedVerificationsCount ?? 0),
        checksLast7dByStatus: {
          PASSED: Number(checkStats?.passedCount ?? 0),
          FAILED: Number(checkStats?.failedCount ?? 0),
          FLAGGED: Number(checkStats?.flaggedCount ?? 0),
        },
      };
    } else {
      redactedSections.push('qualityGovernance');
    }

    // 1e. Feedback Moderation summary (gated by feedback.read)
    let feedbackModerationSection: Record<string, unknown> | null = null;
    if (feedbackReadAccess.granted) {
      const [fbStats] = await this.dbInstance
        .select({
          pendingCount: sql<number>`count(*) FILTER (WHERE ${resourceFeedback.status} = 'PENDING')::int`,
          underReviewCount: sql<number>`count(*) FILTER (WHERE ${resourceFeedback.status} = 'UNDER_REVIEW')::int`,
          reopenedCount: sql<number>`count(*) FILTER (WHERE ${resourceFeedback.status} = 'REOPENED')::int`,
          acceptedCount: sql<number>`count(*) FILTER (WHERE ${resourceFeedback.status} = 'ACCEPTED')::int`,
          rejectedCount: sql<number>`count(*) FILTER (WHERE ${resourceFeedback.status} = 'REJECTED')::int`,
          openDefectsCount: sql<number>`count(*) FILTER (WHERE ${resourceFeedback.status} IN ('PENDING', 'UNDER_REVIEW', 'REOPENED') AND ${resourceFeedback.feedbackType} <> 'HELPFUL')::int`,
        })
        .from(resourceFeedback)
        .innerJoin(resources, eq(resourceFeedback.resourceId, resources.id))
        .where(resourceScopeCond);

      const pending = Number(fbStats?.pendingCount ?? 0);
      const underReview = Number(fbStats?.underReviewCount ?? 0);
      const reopened = Number(fbStats?.reopenedCount ?? 0);

      feedbackModerationSection = {
        openTotal: pending + underReview + reopened,
        openDefectsCount: Number(fbStats?.openDefectsCount ?? 0),
        byStatus: {
          PENDING: pending,
          UNDER_REVIEW: underReview,
          REOPENED: reopened,
          ACCEPTED: Number(fbStats?.acceptedCount ?? 0),
          REJECTED: Number(fbStats?.rejectedCount ?? 0),
        },
      };
    } else {
      redactedSections.push('feedbackModeration');
    }

    // 1f. Education Updates summary (gated by update.read)
    let educationUpdatesSection: Record<string, unknown> | null = null;
    if (updateReadAccess.granted) {
      const updateCountryCond = buildCountryCondition(
        educationUpdates.countryId,
        effectiveScope,
      );
      const [updStats] = await this.dbInstance
        .select({
          total: sql<number>`count(*)::int`,
          draftCount: sql<number>`count(*) FILTER (WHERE ${educationUpdates.publicationStatus} = 'DRAFT')::int`,
          publishedCount: sql<number>`count(*) FILTER (WHERE ${educationUpdates.publicationStatus} = 'PUBLISHED')::int`,
          archivedCount: sql<number>`count(*) FILTER (WHERE ${educationUpdates.publicationStatus} = 'ARCHIVED')::int`,
        })
        .from(educationUpdates)
        .where(updateCountryCond);

      educationUpdatesSection = {
        total: Number(updStats?.total ?? 0),
        byStatus: {
          DRAFT: Number(updStats?.draftCount ?? 0),
          PUBLISHED: Number(updStats?.publishedCount ?? 0),
          ARCHIVED: Number(updStats?.archivedCount ?? 0),
        },
      };
    } else {
      redactedSections.push('educationUpdates');
    }

    // 1g. Contributors summary (platform-wide entity; gated by global contributor.manage when unscoped)
    let contributorsSection: Record<string, unknown> | null = null;
    if (contributorManageAccess.granted && effectiveScope.mode === 'GLOBAL') {
      const [contribStats] = await this.dbInstance
        .select({
          totalProfiles: sql<number>`count(*)::int`,
          activeCount: sql<number>`count(*) FILTER (WHERE ${contributors.status} = 'ACTIVE')::int`,
          suspendedCount: sql<number>`count(*) FILTER (WHERE ${contributors.status} = 'SUSPENDED')::int`,
          verifiedCount: sql<number>`count(*) FILTER (WHERE ${contributors.verificationStatus} = 'VERIFIED')::int`,
        })
        .from(contributors);

      const [appStats] = await this.dbInstance
        .select({
          pendingApplicationsCount: sql<number>`count(*) FILTER (WHERE ${contributorApplications.status} IN ('SUBMITTED', 'UNDER_REVIEW'))::int`,
        })
        .from(contributorApplications);

      contributorsSection = {
        totalProfiles: Number(contribStats?.totalProfiles ?? 0),
        activeProfiles: Number(contribStats?.activeCount ?? 0),
        suspendedProfiles: Number(contribStats?.suspendedCount ?? 0),
        verifiedProfiles: Number(contribStats?.verifiedCount ?? 0),
        pendingApplicationsCount: Number(appStats?.pendingApplicationsCount ?? 0),
      };
    } else {
      redactedSections.push('contributors');
    }

    // 1h. Notifications outbox summary (platform-wide; gated by notification.admin.read when unscoped)
    let notificationsSection: Record<string, unknown> | null = null;
    if (notificationReadAccess.granted && effectiveScope.mode === 'GLOBAL') {
      const [delivStats] = await this.dbInstance
        .select({
          pending: sql<number>`count(*) FILTER (WHERE ${notificationDeliveries.status} = 'PENDING')::int`,
          processing: sql<number>`count(*) FILTER (WHERE ${notificationDeliveries.status} = 'PROCESSING')::int`,
          sent: sql<number>`count(*) FILTER (WHERE ${notificationDeliveries.status} = 'SENT')::int`,
          delivered: sql<number>`count(*) FILTER (WHERE ${notificationDeliveries.status} = 'DELIVERED')::int`,
          failed: sql<number>`count(*) FILTER (WHERE ${notificationDeliveries.status} = 'FAILED')::int`,
          skipped: sql<number>`count(*) FILTER (WHERE ${notificationDeliveries.status} = 'SKIPPED')::int`,
        })
        .from(notificationDeliveries);

      notificationsSection = {
        deliveriesByStatus: {
          PENDING: Number(delivStats?.pending ?? 0),
          PROCESSING: Number(delivStats?.processing ?? 0),
          SENT: Number(delivStats?.sent ?? 0),
          DELIVERED: Number(delivStats?.delivered ?? 0),
          FAILED: Number(delivStats?.failed ?? 0),
          SKIPPED: Number(delivStats?.skipped ?? 0),
        },
      };
    } else {
      redactedSections.push('notifications');
    }

    // 1i. Analytics summary (gated by analytics.read; country-scoped when country filter active)
    let analyticsSection: Record<string, unknown> | null = null;
    if (analyticsReadAccess.granted) {
      const analyticsConds: SQL[] = [gte(analyticsEvents.occurredAt, cutoff7d)];
      const analyticsCountryCond = buildCountryCondition(
        analyticsEvents.countryId,
        effectiveScope,
      );
      if (analyticsCountryCond) {
        analyticsConds.push(analyticsCountryCond);
      }

      const [anStats] = await this.dbInstance
        .select({
          eventsLast24h: sql<number>`count(*) FILTER (WHERE ${analyticsEvents.occurredAt} >= ${cutoff24h})::int`,
          eventsLast7d: sql<number>`count(*)::int`,
        })
        .from(analyticsEvents)
        .where(and(...analyticsConds));

      analyticsSection = {
        eventsLast24h: Number(anStats?.eventsLast24h ?? 0),
        eventsLast7d: Number(anStats?.eventsLast7d ?? 0),
      };
    } else {
      redactedSections.push('analytics');
    }

    // 1j. Governance Audit & Retention summary (gated by audit.read / retention.read)
    let governanceAuditSection: Record<string, unknown> | null = null;
    if (auditReadAccess.granted || retentionReadAccess.granted) {
      let auditPart: Record<string, number> | null = null;
      if (auditReadAccess.granted) {
        const auditConds: SQL[] = [gte(auditLogs.occurredAt, cutoff24h)];
        const auditCountryCond = buildCountryCondition(
          auditLogs.countryId,
          effectiveScope,
        );
        if (auditCountryCond) {
          auditConds.push(auditCountryCond);
        }

        const [auStats] = await this.dbInstance
          .select({
            eventsLast24h: sql<number>`count(*)::int`,
            deniedLast24h: sql<number>`count(*) FILTER (WHERE ${auditLogs.outcome} = 'DENIED')::int`,
          })
          .from(auditLogs)
          .where(and(...auditConds));

        auditPart = {
          auditEventsLast24h: Number(auStats?.eventsLast24h ?? 0),
          auditDeniedLast24h: Number(auStats?.deniedLast24h ?? 0),
        };
      }

      let retentionPart: Record<string, number> | null = null;
      if (retentionReadAccess.granted && effectiveScope.mode === 'GLOBAL') {
        const [polStats] = await this.dbInstance
          .select({
            activePolicies: sql<number>`count(*) FILTER (WHERE ${retentionPolicies.status} = 'ACTIVE')::int`,
          })
          .from(retentionPolicies);

        const [execStats] = await this.dbInstance
          .select({
            failedRunsLast7d: sql<number>`count(*) FILTER (WHERE ${dataRetentionActions.status} IN ('FAILED', 'PARTIAL') AND ${dataRetentionActions.createdAt} >= ${cutoff7d})::int`,
          })
          .from(dataRetentionActions);

        retentionPart = {
          activeRetentionPoliciesCount: Number(polStats?.activePolicies ?? 0),
          failedRetentionRunsLast7dCount: Number(execStats?.failedRunsLast7d ?? 0),
        };
      }

      if (auditPart || retentionPart) {
        governanceAuditSection = {
          audit: auditPart,
          retention: retentionPart,
        };
      } else {
        redactedSections.push('governanceAudit');
      }
    } else {
      redactedSections.push('governanceAudit');
    }

    const pendingReviewCount = Number(resourceStatsRow?.inReviewCount ?? 0);
    const approvedAwaitingPublishCount = Number(resourceStatsRow?.approvedCount ?? 0);
    const oldestRaw = resourceStatsRow?.oldestQueuedUpdatedAt;
    const oldestQueuedUpdatedAt = oldestRaw
      ? new Date(oldestRaw).toISOString()
      : null;

    return {
      generatedAt: now.toISOString(),
      scope: {
        mode: effectiveScope.mode,
        countryIds:
          effectiveScope.mode === 'GLOBAL'
            ? null
            : effectiveScope.mode === 'SINGLE'
              ? [effectiveScope.countryId]
              : effectiveScope.countryIds,
        redactedSections,
      },
      resources: {
        total: Number(resourceStatsRow?.total ?? 0),
        byStatus: {
          DRAFT: Number(resourceStatsRow?.draftCount ?? 0),
          IN_REVIEW: pendingReviewCount,
          APPROVED: approvedAwaitingPublishCount,
          PUBLISHED: Number(resourceStatsRow?.publishedCount ?? 0),
          ARCHIVED: Number(resourceStatsRow?.archivedCount ?? 0),
          REJECTED: Number(resourceStatsRow?.rejectedCount ?? 0),
        },
        byQualityLabel: {
          STANDARD: Number(resourceStatsRow?.standardCount ?? 0),
          VERIFIED: Number(resourceStatsRow?.verifiedCount ?? 0),
          PREMIUM: Number(resourceStatsRow?.premiumCount ?? 0),
        },
      },
      reviewQueue: {
        pendingReviewCount,
        approvedAwaitingPublishCount,
        totalQueueCount: pendingReviewCount + approvedAwaitingPublishCount,
        oldestQueuedUpdatedAt,
      },
      attentionSummary: {
        totalResourcesRequiringAttention: Number(
          resourceStatsRow?.totalRequiringAttention ?? 0,
        ),
        byFlag: {
          PENDING_REVIEW: Number(resourceStatsRow?.attPendingReview ?? 0),
          APPROVED_AWAITING_PUBLISH: Number(
            resourceStatsRow?.attApprovedAwaitingPublish ?? 0,
          ),
          PUBLISHED_WITHOUT_AVAILABLE_FILE: Number(
            resourceStatsRow?.attPublishedWithoutAvailableFile ?? 0,
          ),
          IN_REVIEW_WITHOUT_CANDIDATE_VERSION: Number(
            resourceStatsRow?.attInReviewWithoutCandidateVersion ?? 0,
          ),
          HAS_PROBLEMATIC_FILES: Number(resourceStatsRow?.attHasProblematicFiles ?? 0),
          HAS_OPEN_DEFECT_FEEDBACK: Number(
            resourceStatsRow?.attHasOpenDefectFeedback ?? 0,
          ),
        },
      },
      recentPublicationActivity: {
        last24hCount: Number(pubWindowStats?.last24hCount ?? 0),
        last7dCount: Number(pubWindowStats?.last7dCount ?? 0),
        recentEvents: recentPubEvents.map((e) => ({
          id: e.id,
          resourceId: e.resourceId,
          resourceTitle: e.resourceTitle,
          resourceSlug: e.resourceSlug,
          countryId: e.countryId,
          resourceVersionId: e.resourceVersionId,
          eventType: e.eventType,
          fromStatus: e.fromStatus,
          toStatus: e.toStatus,
          actorUserId: e.actorUserId,
          createdAt: e.createdAt.toISOString(),
        })),
      },
      fileStorage: fileStorageSection,
      qualityGovernance: qualityGovernanceSection,
      feedbackModeration: feedbackModerationSection,
      educationUpdates: educationUpdatesSection,
      contributors: contributorsSection,
      notifications: notificationsSection,
      analytics: analyticsSection,
      governanceAudit: governanceAuditSection,
    };
  }

  /**
   * Builds the exact Drizzle query AST for GET /api/v1/admin/resources (also exposed for EXPLAIN verification).
   */
  buildAdminResourcesListQuery(
    params: AdminListResourcesParams,
    access: PermissionAccessResolution,
  ) {
    const effectiveScope = resolveEffectiveCountryScope(access, params.countryId);
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [];
    const countryCond = buildCountryCondition(resources.countryId, effectiveScope);
    if (countryCond) conditions.push(countryCond);

    if (params.status) conditions.push(eq(resources.status, params.status));
    if (params.qualityLabel) {
      conditions.push(eq(resources.qualityLabel, params.qualityLabel));
    }
    if (params.resourceTypeId) {
      conditions.push(eq(resources.resourceTypeId, params.resourceTypeId));
    }
    if (params.curriculumId) {
      conditions.push(eq(resources.curriculumId, params.curriculumId));
    }
    if (params.educationLevelId) {
      conditions.push(eq(resources.educationLevelId, params.educationLevelId));
    }
    if (params.gradeId) conditions.push(eq(resources.gradeId, params.gradeId));
    if (params.subjectId) conditions.push(eq(resources.subjectId, params.subjectId));
    if (params.topicId) conditions.push(eq(resources.topicId, params.topicId));
    if (params.schoolId) conditions.push(eq(resources.schoolId, params.schoolId));
    if (params.contributorId) {
      conditions.push(eq(resources.contributorId, params.contributorId));
    }
    if (params.academicYear !== undefined) {
      conditions.push(eq(resources.academicYear, params.academicYear));
    }
    if (params.term !== undefined) {
      conditions.push(eq(resources.term, params.term));
    }
    if (params.attentionFlag) {
      conditions.push(sqlAttentionWhereClause(params.attentionFlag, resources));
    }
    if (params.search && params.search.trim().length > 0) {
      const pattern = `%${escapeLikePattern(params.search.trim())}%`;
      conditions.push(
        or(
          sql`${resources.title} ILIKE ${pattern} ESCAPE '\\'`,
          sql`${resources.slug} ILIKE ${pattern} ESCAPE '\\'`,
        )!,
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const sortBy = params.sortBy ?? 'updatedAt';
    const sortOrder = params.sortOrder ?? (sortBy === 'title' ? 'asc' : 'desc');

    let orderByClauses: SQL[];
    if (sortBy === 'title') {
      orderByClauses =
        sortOrder === 'asc'
          ? [sql`lower(${resources.title}) ASC`, asc(resources.id)]
          : [sql`lower(${resources.title}) DESC`, desc(resources.id)];
    } else if (sortBy === 'createdAt') {
      orderByClauses =
        sortOrder === 'asc'
          ? [asc(resources.createdAt), asc(resources.id)]
          : [desc(resources.createdAt), desc(resources.id)];
    } else {
      orderByClauses =
        sortOrder === 'asc'
          ? [asc(resources.updatedAt), asc(resources.id)]
          : [desc(resources.updatedAt), desc(resources.id)];
    }

    const listQuery = this.dbInstance
      .select({
        id: resources.id,
        countryId: resources.countryId,
        resourceTypeId: resources.resourceTypeId,
        schoolId: resources.schoolId,
        curriculumId: resources.curriculumId,
        educationLevelId: resources.educationLevelId,
        gradeId: resources.gradeId,
        subjectId: resources.subjectId,
        topicId: resources.topicId,
        contributorId: resources.contributorId,
        title: resources.title,
        slug: resources.slug,
        status: resources.status,
        qualityLabel: resources.qualityLabel,
        academicYear: resources.academicYear,
        term: resources.term,
        createdAt: resources.createdAt,
        updatedAt: resources.updatedAt,
        ...sqlAttentionSelectFields(resources),
      })
      .from(resources)
      .where(whereClause)
      .orderBy(...orderByClauses)
      .limit(pageSize)
      .offset(offset);

    return { listQuery, whereClause, page, pageSize };
  }

  /**
   * 2. GET /api/v1/admin/resources
   */
  async listResources(
    params: AdminListResourcesParams,
    access: PermissionAccessResolution,
  ): Promise<AdminPaginatedResponse<Record<string, unknown>>> {
    const { listQuery, whereClause, page, pageSize } =
      this.buildAdminResourcesListQuery(params, access);

    const [[totalRow], rows] = await Promise.all([
      this.dbInstance
        .select({ total: count() })
        .from(resources)
        .where(whereClause),
      listQuery,
    ]);

    const total = Number(totalRow?.total ?? 0);
    const totalPages = Math.ceil(total / pageSize);

    if (rows.length === 0) {
      return {
        data: [],
        meta: { page, pageSize, total, totalPages, hasMore: false },
      };
    }

    const pageIds = rows.map((r) => r.id);
    const countryIds = Array.from(new Set(rows.map((r) => r.countryId)));
    const typeIds = Array.from(new Set(rows.map((r) => r.resourceTypeId)));

    const [countryRows, typeRows, versionSummaryRows] = await Promise.all([
      this.dbInstance
        .select({
          id: countries.id,
          name: countries.name,
          isoCode: countries.isoCode,
        })
        .from(countries)
        .where(inArray(countries.id, countryIds)),
      this.dbInstance
        .select({
          id: resourceTypes.id,
          code: resourceTypes.code,
          name: resourceTypes.name,
          slug: resourceTypes.slug,
          pillar: resourceTypes.pillar,
        })
        .from(resourceTypes)
        .where(inArray(resourceTypes.id, typeIds)),
      this.dbInstance
        .select({
          resourceId: resourceVersions.resourceId,
          versionCount: sql<number>`count(*)::int`,
          latestVersionNumber: sql<number | null>`max(${resourceVersions.versionNumber})`,
          publishedVersionId: sql<string | null>`max(${resourceVersions.id}::text) FILTER (WHERE ${resourceVersions.status} = 'PUBLISHED')`,
        })
        .from(resourceVersions)
        .where(inArray(resourceVersions.resourceId, pageIds))
        .groupBy(resourceVersions.resourceId),
    ]);

    const countryMap = new Map(countryRows.map((c) => [c.id, c]));
    const typeMap = new Map(typeRows.map((t) => [t.id, t]));
    const verSummaryMap = new Map(versionSummaryRows.map((v) => [v.resourceId, v]));

    const data = rows.map((row) => {
      const verSummary = verSummaryMap.get(row.id);
      return {
        id: row.id,
        title: row.title,
        slug: row.slug,
        status: row.status,
        qualityLabel: row.qualityLabel,
        country: countryMap.get(row.countryId) ?? {
          id: row.countryId,
          name: '',
          isoCode: '',
        },
        resourceType: typeMap.get(row.resourceTypeId) ?? {
          id: row.resourceTypeId,
          code: '',
          name: '',
          slug: '',
          pillar: '',
        },
        taxonomyIds: {
          schoolId: row.schoolId,
          curriculumId: row.curriculumId,
          educationLevelId: row.educationLevelId,
          gradeId: row.gradeId,
          subjectId: row.subjectId,
          topicId: row.topicId,
          contributorId: row.contributorId,
        },
        academicYear: row.academicYear,
        term: row.term,
        versionSummary: {
          versionCount: Number(verSummary?.versionCount ?? 0),
          latestVersionNumber: verSummary?.latestVersionNumber ?? null,
          publishedVersionId: verSummary?.publishedVersionId ?? null,
        },
        attentionFlags: mapAttentionFlagsFromRow(row),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    });

    return {
      data,
      meta: {
        page,
        pageSize,
        total,
        totalPages,
        hasMore: page * pageSize < total,
      },
    };
  }

  /**
   * 3. GET /api/v1/admin/resources/:id
   * Evaluates attentionFlags using the exact same SQL predicates as overview, list, and review-queue.
   */
  async getResourceById(
    resourceId: string,
    actorUserId: string,
    access: PermissionAccessResolution,
  ): Promise<Record<string, unknown>> {
    if (!access.granted) {
      throw new AdminDashboardError('FORBIDDEN', GENERIC_FORBIDDEN_MESSAGE, 403);
    }

    const [resRow] = await this.dbInstance
      .select({
        resource: resources,
        country: {
          id: countries.id,
          name: countries.name,
          isoCode: countries.isoCode,
          urlPrefix: countries.urlPrefix,
          status: countries.status,
        },
        resourceType: {
          id: resourceTypes.id,
          code: resourceTypes.code,
          name: resourceTypes.name,
          slug: resourceTypes.slug,
          pillar: resourceTypes.pillar,
          status: resourceTypes.status,
        },
        ...sqlAttentionSelectFields(resources),
      })
      .from(resources)
      .innerJoin(countries, eq(resources.countryId, countries.id))
      .innerJoin(resourceTypes, eq(resources.resourceTypeId, resourceTypes.id))
      .where(eq(resources.id, resourceId))
      .limit(1);

    if (!resRow) {
      throw new AdminDashboardError(
        'RESOURCE_NOT_FOUND',
        `Resource with id ${resourceId} not found`,
        404,
      );
    }

    if (!access.hasGlobalGrant && !access.countryIds.includes(resRow.resource.countryId)) {
      throw new AdminDashboardError('FORBIDDEN', GENERIC_FORBIDDEN_MESSAGE, 403, {
        targetCountryId: resRow.resource.countryId,
        entityType: 'RESOURCE',
        entityId: resourceId,
      });
    }

    const r = resRow.resource;

    const [
      versionRows,
      pubEventRows,
      schoolRow,
      curriculumRow,
      levelRow,
      gradeRow,
      subjectRow,
      topicRow,
      contributorRow,
      fileReadAccess,
      qualityReadAccess,
      feedbackReadAccess,
    ] = await Promise.all([
      this.dbInstance
        .select()
        .from(resourceVersions)
        .where(eq(resourceVersions.resourceId, resourceId))
        .orderBy(desc(resourceVersions.versionNumber)),
      this.dbInstance
        .select()
        .from(publicationEvents)
        .where(eq(publicationEvents.resourceId, resourceId))
        .orderBy(desc(publicationEvents.createdAt), desc(publicationEvents.id)),
      r.schoolId
        ? this.dbInstance
            .select({ id: schools.id, name: schools.name, code: schools.code, status: schools.status })
            .from(schools)
            .where(eq(schools.id, r.schoolId))
            .limit(1)
            .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      r.curriculumId
        ? this.dbInstance
            .select({ id: curricula.id, code: curricula.code, name: curricula.name, status: curricula.status })
            .from(curricula)
            .where(eq(curricula.id, r.curriculumId))
            .limit(1)
            .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      r.educationLevelId
        ? this.dbInstance
            .select({ id: educationLevels.id, code: educationLevels.code, name: educationLevels.name })
            .from(educationLevels)
            .where(eq(educationLevels.id, r.educationLevelId))
            .limit(1)
            .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      r.gradeId
        ? this.dbInstance
            .select({ id: grades.id, code: grades.code, name: grades.name })
            .from(grades)
            .where(eq(grades.id, r.gradeId))
            .limit(1)
            .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      r.subjectId
        ? this.dbInstance
            .select({ id: subjects.id, code: subjects.code, name: subjects.name })
            .from(subjects)
            .where(eq(subjects.id, r.subjectId))
            .limit(1)
            .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      r.topicId
        ? this.dbInstance
            .select({ id: topics.id, code: topics.code, name: topics.name })
            .from(topics)
            .where(eq(topics.id, r.topicId))
            .limit(1)
            .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      r.contributorId
        ? this.dbInstance
            .select({
              id: contributors.id,
              displayName: contributors.displayName,
              profileSlug: contributors.profileSlug,
              verificationStatus: contributors.verificationStatus,
              status: contributors.status,
            })
            .from(contributors)
            .where(eq(contributors.id, r.contributorId))
            .limit(1)
            .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      this.resolveSubAccess(actorUserId, 'file.admin.read'),
      this.resolveSubAccess(actorUserId, 'quality.read'),
      this.resolveSubAccess(actorUserId, 'feedback.read'),
    ]);

    const redactedSections: string[] = [];

    // Sub-permission-gated files section (never exposes storageBucket, objectKey, or storageMetadata)
    let filesSection: ControlledAdminFileRecord[] | null = null;
    const canReadResourceFiles =
      fileReadAccess.granted &&
      (fileReadAccess.hasGlobalGrant || fileReadAccess.countryIds.includes(r.countryId));

    if (canReadResourceFiles) {
      const versionIds = versionRows.map((v) => v.id);
      if (versionIds.length === 0) {
        filesSection = [];
      } else {
        const versionMap = new Map(versionRows.map((v) => [v.id, v]));
        const rawFiles = await this.dbInstance
          .select({
            id: resourceFiles.id,
            resourceVersionId: resourceFiles.resourceVersionId,
            storageProvider: resourceFiles.storageProvider,
            originalFilename: resourceFiles.originalFilename,
            fileExtension: resourceFiles.fileExtension,
            fileType: resourceFiles.fileType,
            mimeType: resourceFiles.mimeType,
            fileSizeBytes: resourceFiles.fileSizeBytes,
            checksumSha256: resourceFiles.checksumSha256,
            status: resourceFiles.status,
            isPrimary: resourceFiles.isPrimary,
            sequenceOrder: resourceFiles.sequenceOrder,
            createdAt: resourceFiles.createdAt,
            updatedAt: resourceFiles.updatedAt,
          })
          .from(resourceFiles)
          .where(inArray(resourceFiles.resourceVersionId, versionIds))
          .orderBy(asc(resourceFiles.sequenceOrder), asc(resourceFiles.createdAt));

        filesSection = rawFiles.map((f) => {
          const v = versionMap.get(f.resourceVersionId)!;
          return {
            id: f.id,
            resourceVersionId: f.resourceVersionId,
            resourceId: r.id,
            country: {
              id: resRow.country.id,
              name: resRow.country.name,
              isoCode: resRow.country.isoCode,
            },
            versionNumber: v.versionNumber,
            versionLabel: v.versionLabel,
            versionStatus: v.status,
            immutableUnderPublishedVersion: v.status === 'PUBLISHED',
            storageProvider: f.storageProvider,
            originalFilename: f.originalFilename,
            fileExtension: f.fileExtension,
            fileType: f.fileType,
            mimeType: f.mimeType,
            fileSizeBytes: Number(f.fileSizeBytes),
            checksumSha256: f.checksumSha256,
            status: f.status,
            isPrimary: f.isPrimary,
            sequenceOrder: f.sequenceOrder,
            createdAt: f.createdAt.toISOString(),
            updatedAt: f.updatedAt.toISOString(),
          };
        });
      }
    } else {
      redactedSections.push('files');
    }

    // Sub-permission-gated qualityGovernance section
    let qualityGovernanceSection: Record<string, unknown> | null = null;
    if (qualityReadAccess.granted) {
      const [verifications, checks] = await Promise.all([
        this.dbInstance
          .select({
            id: resourceVerifications.id,
            resourceVersionId: resourceVerifications.resourceVersionId,
            verificationStatus: resourceVerifications.verificationStatus,
            reason: resourceVerifications.reason,
            verifiedBy: resourceVerifications.verifiedBy,
            verifiedAt: resourceVerifications.verifiedAt,
            revokedBy: resourceVerifications.revokedBy,
            revokedAt: resourceVerifications.revokedAt,
          })
          .from(resourceVerifications)
          .where(eq(resourceVerifications.resourceId, resourceId))
          .orderBy(desc(resourceVerifications.verifiedAt)),
        this.dbInstance
          .select({
            id: resourceQualityChecks.id,
            resourceVersionId: resourceQualityChecks.resourceVersionId,
            checkTypeId: resourceQualityChecks.checkTypeId,
            checkTypeCode: qualityCheckTypes.code,
            checkTypeName: qualityCheckTypes.name,
            status: resourceQualityChecks.status,
            notes: resourceQualityChecks.notes,
            checkedBy: resourceQualityChecks.checkedBy,
            checkedAt: resourceQualityChecks.checkedAt,
          })
          .from(resourceQualityChecks)
          .innerJoin(
            qualityCheckTypes,
            eq(resourceQualityChecks.checkTypeId, qualityCheckTypes.id),
          )
          .where(eq(resourceQualityChecks.resourceId, resourceId))
          .orderBy(desc(resourceQualityChecks.checkedAt))
          .limit(50),
      ]);

      qualityGovernanceSection = {
        verifications: verifications.map((v) => ({
          ...v,
          verifiedAt: v.verifiedAt.toISOString(),
          revokedAt: v.revokedAt ? v.revokedAt.toISOString() : null,
        })),
        recentChecks: checks.map((c) => ({
          ...c,
          checkedAt: c.checkedAt.toISOString(),
        })),
      };
    } else {
      redactedSections.push('qualityGovernance');
    }

    // Sub-permission-gated feedbackSummary section
    let feedbackSummarySection: Record<string, unknown> | null = null;
    if (feedbackReadAccess.granted) {
      const [fbStats] = await this.dbInstance
        .select({
          total: sql<number>`count(*)::int`,
          helpfulCount: sql<number>`count(*) FILTER (WHERE ${resourceFeedback.feedbackType} = 'HELPFUL')::int`,
          openDefectCount: sql<number>`count(*) FILTER (WHERE ${resourceFeedback.status} IN ('PENDING', 'UNDER_REVIEW', 'REOPENED') AND ${resourceFeedback.feedbackType} <> 'HELPFUL')::int`,
          pendingCount: sql<number>`count(*) FILTER (WHERE ${resourceFeedback.status} = 'PENDING')::int`,
          underReviewCount: sql<number>`count(*) FILTER (WHERE ${resourceFeedback.status} = 'UNDER_REVIEW')::int`,
          reopenedCount: sql<number>`count(*) FILTER (WHERE ${resourceFeedback.status} = 'REOPENED')::int`,
          acceptedCount: sql<number>`count(*) FILTER (WHERE ${resourceFeedback.status} = 'ACCEPTED')::int`,
          rejectedCount: sql<number>`count(*) FILTER (WHERE ${resourceFeedback.status} = 'REJECTED')::int`,
        })
        .from(resourceFeedback)
        .where(eq(resourceFeedback.resourceId, resourceId));

      feedbackSummarySection = {
        total: Number(fbStats?.total ?? 0),
        helpfulCount: Number(fbStats?.helpfulCount ?? 0),
        openDefectCount: Number(fbStats?.openDefectCount ?? 0),
        byStatus: {
          PENDING: Number(fbStats?.pendingCount ?? 0),
          UNDER_REVIEW: Number(fbStats?.underReviewCount ?? 0),
          REOPENED: Number(fbStats?.reopenedCount ?? 0),
          ACCEPTED: Number(fbStats?.acceptedCount ?? 0),
          REJECTED: Number(fbStats?.rejectedCount ?? 0),
        },
      };
    } else {
      redactedSections.push('feedbackSummary');
    }

    return {
      id: r.id,
      title: r.title,
      slug: r.slug,
      description: r.description,
      status: r.status,
      qualityLabel: r.qualityLabel,
      sourceName: r.sourceName,
      sourceReference: r.sourceReference,
      academicYear: r.academicYear,
      term: r.term,
      country: resRow.country,
      resourceType: resRow.resourceType,
      school: schoolRow,
      taxonomy: {
        curriculum: curriculumRow,
        curriculumVersionId: r.curriculumVersionId,
        educationLevel: levelRow,
        grade: gradeRow,
        pathwayId: r.pathwayId,
        subject: subjectRow,
        topic: topicRow,
      },
      contributor: contributorRow,
      attentionFlags: mapAttentionFlagsFromRow(resRow),
      versions: versionRows.map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        versionLabel: v.versionLabel,
        title: v.title,
        description: v.description,
        changeSummary: v.changeSummary,
        status: v.status,
        qualityLabel: v.qualityLabel,
        immutable: v.status === 'PUBLISHED',
        publishedAt: v.publishedAt ? v.publishedAt.toISOString() : null,
        createdAt: v.createdAt.toISOString(),
        updatedAt: v.updatedAt.toISOString(),
      })),
      publicationEvents: pubEventRows.map((e) => ({
        id: e.id,
        resourceVersionId: e.resourceVersionId,
        eventType: e.eventType,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        actorUserId: e.actorUserId,
        reason: e.reason,
        createdAt: e.createdAt.toISOString(),
      })),
      files: filesSection,
      qualityGovernance: qualityGovernanceSection,
      feedbackSummary: feedbackSummarySection,
      redactedSections,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  /**
   * Builds the exact Drizzle query AST for GET /api/v1/admin/publications/review-queue.
   * Uses compile-time constant SQL predicates for queueState so PostgreSQL predtest.c matches
   * the partial indexes ON content.resources (...) WHERE status IN ('IN_REVIEW', 'APPROVED').
   */
  buildReviewQueueListQuery(
    params: AdminReviewQueueParams,
    access: PermissionAccessResolution,
  ) {
    const effectiveScope = resolveEffectiveCountryScope(access, params.countryId);
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    const offset = (page - 1) * pageSize;

    const queueState = params.queueState ?? 'ALL';
    const conditions: SQL[] = [];

    const countryCond = buildCountryCondition(resources.countryId, effectiveScope);
    if (countryCond) {
      conditions.push(countryCond);
    }

    if (queueState === 'IN_REVIEW') {
      conditions.push(sql`${resources.status} = 'IN_REVIEW'`);
    } else if (queueState === 'APPROVED') {
      conditions.push(sql`${resources.status} = 'APPROVED'`);
    } else {
      conditions.push(sql`${resources.status} IN ('IN_REVIEW', 'APPROVED')`);
    }

    if (params.resourceTypeId) {
      conditions.push(eq(resources.resourceTypeId, params.resourceTypeId));
    }
    if (params.gradeId) {
      conditions.push(eq(resources.gradeId, params.gradeId));
    }
    if (params.subjectId) {
      conditions.push(eq(resources.subjectId, params.subjectId));
    }

    const whereClause = and(...conditions)!;
    const sortBy = params.sortBy ?? 'updatedAt';
    const sortOrder = params.sortOrder ?? 'asc';

    const orderByClauses =
      sortBy === 'createdAt'
        ? sortOrder === 'asc'
          ? [asc(resources.createdAt), asc(resources.id)]
          : [desc(resources.createdAt), desc(resources.id)]
        : sortOrder === 'asc'
          ? [asc(resources.updatedAt), asc(resources.id)]
          : [desc(resources.updatedAt), desc(resources.id)];

    const listQuery = this.dbInstance
      .select({
        id: resources.id,
        countryId: resources.countryId,
        resourceTypeId: resources.resourceTypeId,
        gradeId: resources.gradeId,
        subjectId: resources.subjectId,
        contributorId: resources.contributorId,
        title: resources.title,
        slug: resources.slug,
        status: resources.status,
        qualityLabel: resources.qualityLabel,
        createdAt: resources.createdAt,
        updatedAt: resources.updatedAt,
        ...sqlAttentionSelectFields(resources),
      })
      .from(resources)
      .where(whereClause)
      .orderBy(...orderByClauses)
      .limit(pageSize)
      .offset(offset);

    return { listQuery, whereClause, page, pageSize };
  }

  /**
   * 4. GET /api/v1/admin/publications/review-queue
   */
  async getReviewQueue(
    params: AdminReviewQueueParams,
    access: PermissionAccessResolution,
  ): Promise<AdminPaginatedResponse<Record<string, unknown>>> {
    const { listQuery, whereClause, page, pageSize } =
      this.buildReviewQueueListQuery(params, access);

    const [[totalRow], rows] = await Promise.all([
      this.dbInstance
        .select({ total: count() })
        .from(resources)
        .where(whereClause),
      listQuery,
    ]);

    const total = Number(totalRow?.total ?? 0);
    const totalPages = Math.ceil(total / pageSize);

    if (rows.length === 0) {
      return {
        data: [],
        meta: { page, pageSize, total, totalPages, hasMore: false },
      };
    }

    const pageIds = rows.map((r) => r.id);
    const countryIds = Array.from(new Set(rows.map((r) => r.countryId)));
    const typeIds = Array.from(new Set(rows.map((r) => r.resourceTypeId)));

    const [countryRows, typeRows, candidateVersions] = await Promise.all([
      this.dbInstance
        .select({
          id: countries.id,
          name: countries.name,
          isoCode: countries.isoCode,
        })
        .from(countries)
        .where(inArray(countries.id, countryIds)),
      this.dbInstance
        .select({
          id: resourceTypes.id,
          code: resourceTypes.code,
          name: resourceTypes.name,
          slug: resourceTypes.slug,
          pillar: resourceTypes.pillar,
        })
        .from(resourceTypes)
        .where(inArray(resourceTypes.id, typeIds)),
      this.dbInstance
        .select({
          id: resourceVersions.id,
          resourceId: resourceVersions.resourceId,
          versionNumber: resourceVersions.versionNumber,
          versionLabel: resourceVersions.versionLabel,
          title: resourceVersions.title,
          status: resourceVersions.status,
          updatedAt: resourceVersions.updatedAt,
        })
        .from(resourceVersions)
        .where(
          and(
            inArray(resourceVersions.resourceId, pageIds),
            eq(resourceVersions.status, 'IN_REVIEW'),
          ),
        )
        .orderBy(desc(resourceVersions.versionNumber)),
    ]);

    const countryMap = new Map(countryRows.map((c) => [c.id, c]));
    const typeMap = new Map(typeRows.map((t) => [t.id, t]));
    const candidateMap = new Map<string, (typeof candidateVersions)[number]>();
    for (const cv of candidateVersions) {
      if (!candidateMap.has(cv.resourceId)) {
        candidateMap.set(cv.resourceId, cv);
      }
    }

    const data = rows.map((row) => {
      const candidate = candidateMap.get(row.id) ?? null;
      return {
        id: row.id,
        title: row.title,
        slug: row.slug,
        status: row.status,
        qualityLabel: row.qualityLabel,
        country: countryMap.get(row.countryId) ?? {
          id: row.countryId,
          name: '',
          isoCode: '',
        },
        resourceType: typeMap.get(row.resourceTypeId) ?? {
          id: row.resourceTypeId,
          code: '',
          name: '',
          slug: '',
          pillar: '',
        },
        gradeId: row.gradeId,
        subjectId: row.subjectId,
        contributorId: row.contributorId,
        candidateVersion: candidate
          ? {
              id: candidate.id,
              versionNumber: candidate.versionNumber,
              versionLabel: candidate.versionLabel,
              title: candidate.title,
              status: candidate.status,
              updatedAt: candidate.updatedAt.toISOString(),
            }
          : null,
        attentionFlags: mapAttentionFlagsFromRow(row),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    });

    return {
      data,
      meta: {
        page,
        pageSize,
        total,
        totalPages,
        hasMore: page * pageSize < total,
      },
    };
  }

  /**
   * 5. GET /api/v1/admin/publications/events
   */
  async listPublicationEvents(
    params: AdminListPublicationEventsParams,
    access: PermissionAccessResolution,
  ): Promise<AdminPaginatedResponse<Record<string, unknown>>> {
    const effectiveScope = resolveEffectiveCountryScope(access, params.countryId);
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [];
    const countryCond = buildCountryCondition(resources.countryId, effectiveScope);
    if (countryCond) conditions.push(countryCond);

    if (params.resourceId) {
      conditions.push(eq(publicationEvents.resourceId, params.resourceId));
    }
    if (params.eventType) {
      conditions.push(eq(publicationEvents.eventType, params.eventType));
    }
    if (params.actorUserId) {
      conditions.push(eq(publicationEvents.actorUserId, params.actorUserId));
    }
    if (params.fromDate) {
      conditions.push(gte(publicationEvents.createdAt, params.fromDate));
    }
    if (params.toDate) {
      conditions.push(lte(publicationEvents.createdAt, params.toDate));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const sortOrder = params.sortOrder ?? 'desc';
    const orderByClauses =
      sortOrder === 'asc'
        ? [asc(publicationEvents.createdAt), asc(publicationEvents.id)]
        : [desc(publicationEvents.createdAt), desc(publicationEvents.id)];

    const [[totalRow], rows] = await Promise.all([
      this.dbInstance
        .select({ total: count() })
        .from(publicationEvents)
        .innerJoin(resources, eq(publicationEvents.resourceId, resources.id))
        .where(whereClause),
      this.dbInstance
        .select({
          id: publicationEvents.id,
          resourceId: publicationEvents.resourceId,
          resourceTitle: resources.title,
          resourceSlug: resources.slug,
          resourceStatus: resources.status,
          countryId: resources.countryId,
          resourceVersionId: publicationEvents.resourceVersionId,
          eventType: publicationEvents.eventType,
          fromStatus: publicationEvents.fromStatus,
          toStatus: publicationEvents.toStatus,
          actorUserId: publicationEvents.actorUserId,
          actorDisplayName: users.displayName,
          reason: publicationEvents.reason,
          createdAt: publicationEvents.createdAt,
        })
        .from(publicationEvents)
        .innerJoin(resources, eq(publicationEvents.resourceId, resources.id))
        .leftJoin(users, eq(publicationEvents.actorUserId, users.id))
        .where(whereClause)
        .orderBy(...orderByClauses)
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(totalRow?.total ?? 0);
    const totalPages = Math.ceil(total / pageSize);

    return {
      data: rows.map((row) => ({
        id: row.id,
        resource: {
          id: row.resourceId,
          title: row.resourceTitle,
          slug: row.resourceSlug,
          status: row.resourceStatus,
          countryId: row.countryId,
        },
        resourceVersionId: row.resourceVersionId,
        eventType: row.eventType,
        fromStatus: row.fromStatus,
        toStatus: row.toStatus,
        actor: row.actorUserId
          ? {
              userId: row.actorUserId,
              displayName: row.actorDisplayName ?? null,
            }
          : null,
        reason: row.reason,
        createdAt: row.createdAt.toISOString(),
      })),
      meta: {
        page,
        pageSize,
        total,
        totalPages,
        hasMore: page * pageSize < total,
      },
    };
  }

  /**
   * 6. GET /api/v1/admin/files
   * Strictly omits storageBucket, objectKey, storageMetadata, and signed URLs.
   */
  async listFiles(
    params: AdminListFilesParams,
    access: PermissionAccessResolution,
  ): Promise<AdminPaginatedResponse<ControlledAdminFileRecord>> {
    const effectiveScope = resolveEffectiveCountryScope(access, params.countryId);
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [];
    const countryCond = buildCountryCondition(resources.countryId, effectiveScope);
    if (countryCond) conditions.push(countryCond);

    if (params.resourceId) {
      conditions.push(eq(resources.id, params.resourceId));
    }
    if (params.resourceVersionId) {
      conditions.push(eq(resourceFiles.resourceVersionId, params.resourceVersionId));
    }
    if (params.status) {
      conditions.push(eq(resourceFiles.status, params.status));
    }
    if (params.storageProvider) {
      conditions.push(eq(resourceFiles.storageProvider, params.storageProvider));
    }
    if (params.fileType) {
      conditions.push(eq(resourceFiles.fileType, params.fileType));
    }
    if (params.isPrimary !== undefined) {
      conditions.push(eq(resourceFiles.isPrimary, params.isPrimary));
    }
    if (params.versionStatus) {
      conditions.push(eq(resourceVersions.status, params.versionStatus));
    }
    if (params.checksumSha256) {
      conditions.push(
        eq(resourceFiles.checksumSha256, params.checksumSha256.toLowerCase()),
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const sortBy = params.sortBy ?? 'createdAt';
    const sortOrder = params.sortOrder ?? 'desc';

    let orderByClauses: SQL[];
    if (sortBy === 'fileSizeBytes') {
      orderByClauses =
        sortOrder === 'asc'
          ? [asc(resourceFiles.fileSizeBytes), asc(resourceFiles.id)]
          : [desc(resourceFiles.fileSizeBytes), desc(resourceFiles.id)];
    } else if (sortBy === 'updatedAt') {
      orderByClauses =
        sortOrder === 'asc'
          ? [asc(resourceFiles.updatedAt), asc(resourceFiles.id)]
          : [desc(resourceFiles.updatedAt), desc(resourceFiles.id)];
    } else {
      orderByClauses =
        sortOrder === 'asc'
          ? [asc(resourceFiles.createdAt), asc(resourceFiles.id)]
          : [desc(resourceFiles.createdAt), desc(resourceFiles.id)];
    }

    const [[totalRow], rows] = await Promise.all([
      this.dbInstance
        .select({ total: count() })
        .from(resourceFiles)
        .innerJoin(
          resourceVersions,
          eq(resourceFiles.resourceVersionId, resourceVersions.id),
        )
        .innerJoin(resources, eq(resourceVersions.resourceId, resources.id))
        .where(whereClause),
      this.dbInstance
        .select({
          id: resourceFiles.id,
          resourceVersionId: resourceFiles.resourceVersionId,
          resourceId: resources.id,
          countryId: countries.id,
          countryName: countries.name,
          countryIsoCode: countries.isoCode,
          versionNumber: resourceVersions.versionNumber,
          versionLabel: resourceVersions.versionLabel,
          versionStatus: resourceVersions.status,
          storageProvider: resourceFiles.storageProvider,
          originalFilename: resourceFiles.originalFilename,
          fileExtension: resourceFiles.fileExtension,
          fileType: resourceFiles.fileType,
          mimeType: resourceFiles.mimeType,
          fileSizeBytes: resourceFiles.fileSizeBytes,
          checksumSha256: resourceFiles.checksumSha256,
          status: resourceFiles.status,
          isPrimary: resourceFiles.isPrimary,
          sequenceOrder: resourceFiles.sequenceOrder,
          createdAt: resourceFiles.createdAt,
          updatedAt: resourceFiles.updatedAt,
        })
        .from(resourceFiles)
        .innerJoin(
          resourceVersions,
          eq(resourceFiles.resourceVersionId, resourceVersions.id),
        )
        .innerJoin(resources, eq(resourceVersions.resourceId, resources.id))
        .innerJoin(countries, eq(resources.countryId, countries.id))
        .where(whereClause)
        .orderBy(...orderByClauses)
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(totalRow?.total ?? 0);
    const totalPages = Math.ceil(total / pageSize);

    return {
      data: rows.map((row) => ({
        id: row.id,
        resourceVersionId: row.resourceVersionId,
        resourceId: row.resourceId,
        country: {
          id: row.countryId,
          name: row.countryName,
          isoCode: row.countryIsoCode,
        },
        versionNumber: row.versionNumber,
        versionLabel: row.versionLabel,
        versionStatus: row.versionStatus,
        immutableUnderPublishedVersion: row.versionStatus === 'PUBLISHED',
        storageProvider: row.storageProvider,
        originalFilename: row.originalFilename,
        fileExtension: row.fileExtension,
        fileType: row.fileType,
        mimeType: row.mimeType,
        fileSizeBytes: Number(row.fileSizeBytes),
        checksumSha256: row.checksumSha256,
        status: row.status,
        isPrimary: row.isPrimary,
        sequenceOrder: row.sequenceOrder,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      meta: {
        page,
        pageSize,
        total,
        totalPages,
        hasMore: page * pageSize < total,
      },
    };
  }

  /**
   * 7. GET /api/v1/admin/files/:id
   * Strictly omits storageBucket, objectKey, storageMetadata, and signed URLs.
   */
  async getFileById(
    fileId: string,
    access: PermissionAccessResolution,
  ): Promise<Record<string, unknown>> {
    if (!access.granted) {
      throw new AdminDashboardError('FORBIDDEN', GENERIC_FORBIDDEN_MESSAGE, 403);
    }

    const [row] = await this.dbInstance
      .select({
        id: resourceFiles.id,
        resourceVersionId: resourceFiles.resourceVersionId,
        storageProvider: resourceFiles.storageProvider,
        originalFilename: resourceFiles.originalFilename,
        fileExtension: resourceFiles.fileExtension,
        fileType: resourceFiles.fileType,
        mimeType: resourceFiles.mimeType,
        fileSizeBytes: resourceFiles.fileSizeBytes,
        checksumSha256: resourceFiles.checksumSha256,
        status: resourceFiles.status,
        isPrimary: resourceFiles.isPrimary,
        sequenceOrder: resourceFiles.sequenceOrder,
        createdAt: resourceFiles.createdAt,
        updatedAt: resourceFiles.updatedAt,
        versionNumber: resourceVersions.versionNumber,
        versionLabel: resourceVersions.versionLabel,
        versionTitle: resourceVersions.title,
        versionStatus: resourceVersions.status,
        versionPublishedAt: resourceVersions.publishedAt,
        resourceId: resources.id,
        resourceTitle: resources.title,
        resourceSlug: resources.slug,
        resourceStatus: resources.status,
        resourceQualityLabel: resources.qualityLabel,
        countryId: countries.id,
        countryName: countries.name,
        countryIsoCode: countries.isoCode,
      })
      .from(resourceFiles)
      .innerJoin(
        resourceVersions,
        eq(resourceFiles.resourceVersionId, resourceVersions.id),
      )
      .innerJoin(resources, eq(resourceVersions.resourceId, resources.id))
      .innerJoin(countries, eq(resources.countryId, countries.id))
      .where(eq(resourceFiles.id, fileId))
      .limit(1);

    if (!row) {
      throw new AdminDashboardError(
        'FILE_NOT_FOUND',
        `File with id ${fileId} not found`,
        404,
      );
    }

    if (!access.hasGlobalGrant && !access.countryIds.includes(row.countryId)) {
      throw new AdminDashboardError('FORBIDDEN', GENERIC_FORBIDDEN_MESSAGE, 403, {
        targetCountryId: row.countryId,
        entityType: 'RESOURCE_FILE',
        entityId: fileId,
      });
    }

    return {
      id: row.id,
      storageProvider: row.storageProvider,
      originalFilename: row.originalFilename,
      fileExtension: row.fileExtension,
      fileType: row.fileType,
      mimeType: row.mimeType,
      fileSizeBytes: Number(row.fileSizeBytes),
      checksumSha256: row.checksumSha256,
      status: row.status,
      isPrimary: row.isPrimary,
      sequenceOrder: row.sequenceOrder,
      immutableUnderPublishedVersion: row.versionStatus === 'PUBLISHED',
      version: {
        id: row.resourceVersionId,
        versionNumber: row.versionNumber,
        versionLabel: row.versionLabel,
        title: row.versionTitle,
        status: row.versionStatus,
        publishedAt: row.versionPublishedAt
          ? row.versionPublishedAt.toISOString()
          : null,
      },
      resource: {
        id: row.resourceId,
        title: row.resourceTitle,
        slug: row.resourceSlug,
        status: row.resourceStatus,
        qualityLabel: row.resourceQualityLabel,
      },
      country: {
        id: row.countryId,
        name: row.countryName,
        isoCode: row.countryIsoCode,
      },
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * 8. POST /api/v1/admin/files/:id/verify-integrity
   * Enforces 20 req/min/actor rate limit, COUNTRY scope prior to storage HEAD call,
   * read-only FileStorageService.verifyFileIntegrity delegation, and synchronous AuditService logging.
   */
  async verifyFileIntegrity(
    fileId: string,
    actorContext: AdminActorContext,
    access: PermissionAccessResolution,
    options?: { signal?: AbortSignal },
  ): Promise<Record<string, unknown>> {
    if (!access.granted) {
      throw new AdminDashboardError('FORBIDDEN', GENERIC_FORBIDDEN_MESSAGE, 403);
    }

    this.enforceVerifyRateLimit(actorContext.actorUserId);

    if (options?.signal?.aborted) {
      const reason = options.signal.reason;
      const msg = reason instanceof Error ? reason.message : String(reason || 'ABORTED');
      const abortErr = new Error(
        msg === 'CLIENT_DISCONNECTED'
          ? 'Client disconnected during file integrity verification.'
          : 'File integrity verification timed out.',
      ) as Error & { statusCode?: number; code?: string };
      abortErr.statusCode = msg === 'CLIENT_DISCONNECTED' ? 499 : 503;
      abortErr.code = msg === 'CLIENT_DISCONNECTED' ? 'CLIENT_CLOSED_REQUEST' : 'SERVER_BUSY';
      throw abortErr;
    }

    const [row] = await this.dbInstance
      .select({
        fileId: resourceFiles.id,
        storageProvider: resourceFiles.storageProvider,
        fileStatus: resourceFiles.status,
        resourceVersionId: resourceVersions.id,
        versionStatus: resourceVersions.status,
        resourceId: resources.id,
        countryId: resources.countryId,
      })
      .from(resourceFiles)
      .innerJoin(
        resourceVersions,
        eq(resourceFiles.resourceVersionId, resourceVersions.id),
      )
      .innerJoin(resources, eq(resourceVersions.resourceId, resources.id))
      .where(eq(resourceFiles.id, fileId))
      .limit(1);

    if (!row) {
      throw new AdminDashboardError(
        'FILE_NOT_FOUND',
        `File with id ${fileId} not found`,
        404,
      );
    }

    if (!access.hasGlobalGrant && !access.countryIds.includes(row.countryId)) {
      throw new AdminDashboardError('FORBIDDEN', GENERIC_FORBIDDEN_MESSAGE, 403, {
        targetCountryId: row.countryId,
        entityType: 'RESOURCE_FILE',
        entityId: fileId,
      });
    }

    const safeRequestId = actorContext.requestId
      ? actorContext.requestId.slice(0, 64)
      : null;

    let verification;
    try {
      verification = await this.fileStorageService.verifyFileIntegrity(fileId, options);
    } catch (err) {
      if (options?.signal?.aborted || (err as { name?: string })?.name === 'AbortError') {
        const reason = options?.signal?.reason;
        const msg = reason instanceof Error ? reason.message : String(reason || 'ABORTED');
        const abortErr = new Error(
          msg === 'CLIENT_DISCONNECTED'
            ? 'Client disconnected during storage HEAD verification.'
            : 'Storage HEAD verification timed out.',
        ) as Error & { statusCode?: number; code?: string };
        abortErr.statusCode = msg === 'CLIENT_DISCONNECTED' ? 499 : 503;
        abortErr.code = msg === 'CLIENT_DISCONNECTED' ? 'CLIENT_CLOSED_REQUEST' : 'SERVER_BUSY';
        throw abortErr;
      }

      try {
        await this.auditService.logEvent({
          action: 'ADMIN_FILE_INTEGRITY_VERIFIED',
          entityType: 'RESOURCE_FILE',
          entityId: fileId,
          actorType: 'AUTHENTICATED',
          actorUserId: actorContext.actorUserId,
          actorSnapshot: actorContext.actorSnapshot,
          outcome: 'FAILED',
          requestId: safeRequestId,
          countryId: row.countryId,
          context: {
            resourceId: row.resourceId,
            resourceVersionId: row.resourceVersionId,
            storageProvider: row.storageProvider,
            failureCode: err instanceof FileStorageError ? err.code : 'STORAGE_HEAD_FAILED',
          },
        });
      } catch {
        // Never allow secondary audit failure to mask primary 502 error
      }

      if (err instanceof FileStorageError && err.statusCode === 404) {
        throw new AdminDashboardError('FILE_NOT_FOUND', err.message, 404);
      }

      throw new AdminDashboardError(
        'STORAGE_VERIFICATION_ERROR',
        'Storage provider integrity verification could not be completed.',
        502,
      );
    }

    const verifiedAt = new Date().toISOString();

    await this.auditService.logEvent({
      action: 'ADMIN_FILE_INTEGRITY_VERIFIED',
      entityType: 'RESOURCE_FILE',
      entityId: fileId,
      actorType: 'AUTHENTICATED',
      actorUserId: actorContext.actorUserId,
      actorSnapshot: actorContext.actorSnapshot,
      outcome: 'SUCCESS',
      requestId: safeRequestId,
      countryId: row.countryId,
      afterState: {
        integrityStatus: verification.status,
        existsInStorage: verification.existsInStorage,
        sizeMatches: verification.sizeMatches,
        checksumMatches: verification.checksumMatches,
      },
      context: {
        resourceId: row.resourceId,
        resourceVersionId: row.resourceVersionId,
        storageProvider: row.storageProvider,
      },
    });

    return {
      fileId: verification.fileId,
      resourceId: row.resourceId,
      resourceVersionId: row.resourceVersionId,
      countryId: row.countryId,
      storageProvider: row.storageProvider,
      recordedStatus: row.fileStatus,
      immutableUnderPublishedVersion: row.versionStatus === 'PUBLISHED',
      integrity: {
        status: verification.status,
        existsInStorage: verification.existsInStorage,
        sizeMatches: verification.sizeMatches,
        checksumMatches: verification.checksumMatches,
        verifiedAt,
      },
    };
  }
}

export const defaultAdminDashboardService = new DefaultAdminDashboardService();
export { ADMIN_ATTENTION_FLAGS, type AdminAttentionFlag };
