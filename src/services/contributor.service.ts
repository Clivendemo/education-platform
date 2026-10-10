import { eq, and, or, sql, desc, asc, isNull, inArray } from 'drizzle-orm';
import { db as defaultDb, type AppDatabase } from '../db/index.js';
import {
  contributors,
  contributorApplications,
  contributorSubmissions,
  users,
  resources,
  type Contributor,
  type ContributorApplication,
  type ContributorSubmission,
  type ContributorStatus,
  type ContributorVerificationStatus,
  type ContributorApplicationStatus,
  type ContributorSubmissionStatus,
} from '../db/schemas.js';
import { defaultRbacService, type RbacService } from './rbac.service.js';

export type {
  ContributorStatus,
  ContributorVerificationStatus,
  ContributorApplicationStatus,
  ContributorSubmissionStatus,
};

// ============================================================================
// Domain Errors
// ============================================================================

export class ContributorError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'CONTRIBUTOR_ERROR',
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'ContributorError';
  }
}

export class ContributorNotFoundError extends ContributorError {
  constructor(message = 'Contributor profile not found.') {
    super(message, 'CONTRIBUTOR_NOT_FOUND', 404);
  }
}

export class NotAContributorError extends ContributorError {
  constructor(message = 'You do not have a contributor profile.') {
    super(message, 'NOT_A_CONTRIBUTOR', 404);
  }
}

export class ContributorSuspendedError extends ContributorError {
  constructor(message = 'Contributor account is suspended.') {
    super(message, 'CONTRIBUTOR_SUSPENDED', 403);
  }
}

export class AlreadyContributorError extends ContributorError {
  constructor(message = 'User is already an active contributor.') {
    super(message, 'ALREADY_CONTRIBUTOR', 409);
  }
}

export class DuplicateApplicationError extends ContributorError {
  constructor(message = 'An active contributor application is already pending review.') {
    super(message, 'DUPLICATE_APPLICATION', 409);
  }
}

export class ApplicationNotFoundError extends ContributorError {
  constructor(message = 'Contributor application not found.') {
    super(message, 'APPLICATION_NOT_FOUND', 404);
  }
}

export class ApplicationAlreadyReviewedError extends ContributorError {
  constructor(message = 'Contributor application has already been reviewed.') {
    super(message, 'APPLICATION_ALREADY_REVIEWED', 400);
  }
}

export class SubmissionNotFoundError extends ContributorError {
  constructor(message = 'Contributor submission not found.') {
    super(message, 'SUBMISSION_NOT_FOUND', 404);
  }
}

export class SubmissionNotEditableError extends ContributorError {
  constructor(message = 'Only draft submissions can be modified or submitted.') {
    super(message, 'SUBMISSION_LOCKED', 400);
  }
}

export class ContributorValidationError extends ContributorError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
  }
}

// ============================================================================
// DTOs & Interfaces
// ============================================================================

export interface ContributorPublicDto {
  id: string;
  displayName: string;
  bio: string | null;
  profileSlug: string;
  verificationStatus: ContributorVerificationStatus;
  publishedResourcesCount: number;
  createdAt: string;
}

export interface ContributorPrivateDto {
  id: string;
  userId: string;
  displayName: string;
  bio: string | null;
  profileSlug: string;
  status: ContributorStatus;
  verificationStatus: ContributorVerificationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ContributorApplicationDto {
  id: string;
  userId: string;
  applicationText: string;
  status: ContributorApplicationStatus;
  reviewNotes: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

export interface ContributorSubmissionDto {
  id: string;
  contributorId: string;
  title: string;
  description: string | null;
  proposedPriceMinor: number | null;
  proposedCurrencyCode: string | null;
  status: ContributorSubmissionStatus;
  resourceId: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedList<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface CreateSubmissionParams {
  title: string;
  description?: string | null;
  proposedPriceMinor?: number | null;
  proposedCurrencyCode?: string | null;
  resourceId?: string | null;
}

export interface UpdateSubmissionParams {
  title?: string;
  description?: string | null;
  proposedPriceMinor?: number | null;
  proposedCurrencyCode?: string | null;
}

export interface ContributorService {
  // Public
  getPublicProfileBySlug(slug: string): Promise<ContributorPublicDto | null>;
  listPublicContributors(params?: { page?: number; limit?: number }): Promise<PaginatedList<ContributorPublicDto>>;
  listContributorPublishedResources(slug: string, params?: { page?: number; limit?: number }): Promise<PaginatedList<any>>;

  // Applications
  submitApplication(userId: string, applicationText: string): Promise<ContributorApplicationDto>;
  listApplications(params?: { status?: ContributorApplicationStatus; page?: number; limit?: number }): Promise<PaginatedList<ContributorApplicationDto>>;
  reviewApplication(adminUserId: string, applicationId: string, action: 'APPROVE' | 'REJECT', notes?: string): Promise<{
    application: ContributorApplicationDto;
    contributor?: ContributorPrivateDto;
  }>;

  // Workspace
  getMyProfile(userId: string): Promise<ContributorPrivateDto>;
  updateMyProfile(userId: string, data: { displayName?: string; bio?: string | null }): Promise<ContributorPrivateDto>;
  createSubmission(userId: string, params: CreateSubmissionParams): Promise<ContributorSubmissionDto>;
  updateSubmission(userId: string, submissionId: string, params: UpdateSubmissionParams): Promise<ContributorSubmissionDto>;
  submitSubmission(userId: string, submissionId: string): Promise<ContributorSubmissionDto>;
  listMySubmissions(userId: string, params?: { page?: number; limit?: number }): Promise<PaginatedList<ContributorSubmissionDto>>;
  getSubmissionById(userId: string, submissionId: string): Promise<ContributorSubmissionDto>;

  // Administration
  listAdminContributors(params?: { status?: ContributorStatus; verificationStatus?: ContributorVerificationStatus; page?: number; limit?: number }): Promise<PaginatedList<ContributorPrivateDto>>;
  updateContributorStatus(adminUserId: string, contributorId: string, status: ContributorStatus, reason?: string): Promise<ContributorPrivateDto>;
  reviewSubmission(adminUserId: string, submissionId: string, action: 'APPROVE' | 'REJECT', notes?: string): Promise<ContributorSubmissionDto>;
}

// ============================================================================
// Implementation
// ============================================================================

export class DefaultContributorService implements ContributorService {
  constructor(
    private readonly db: AppDatabase = defaultDb,
    private readonly rbac: RbacService = defaultRbacService,
  ) {}

  /**
   * Generates a sanitized, collision-safe profile slug matching ^[a-z0-9]+(?:-[a-z0-9]+)*$
   */
  private generateBaseSlug(displayName: string): string {
    const raw = displayName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return raw.length > 0 ? raw.slice(0, 80) : 'contributor';
  }

  private async generateUniqueSlug(tx: AppDatabase, displayName: string, excludeContributorId?: string): Promise<string> {
    const baseSlug = this.generateBaseSlug(displayName);
    let candidate = baseSlug;
    let counter = 1;

    while (true) {
      const [existing] = await tx
        .select({ id: contributors.id })
        .from(contributors)
        .where(eq(contributors.profileSlug, candidate))
        .limit(1);

      if (!existing || (excludeContributorId && existing.id === excludeContributorId)) {
        return candidate;
      }

      counter++;
      candidate = `${baseSlug}-${counter}`;
    }
  }

  // --------------------------------------------------------------------------
  // Public Discovery
  // --------------------------------------------------------------------------

  async getPublicProfileBySlug(slug: string): Promise<ContributorPublicDto | null> {
    const normalizedSlug = slug.toLowerCase().trim();
    const [c] = await this.db
      .select()
      .from(contributors)
      .where(and(eq(contributors.profileSlug, normalizedSlug), eq(contributors.status, 'ACTIVE')))
      .limit(1);

    if (!c) {
      return null;
    }

    // Count published resources
    const [resCount] = await this.db
      .select({ count: sql<string>`count(*)` })
      .from(resources)
      .where(and(eq(resources.contributorId, c.id), eq(resources.status, 'PUBLISHED')));

    return {
      id: c.id,
      displayName: c.displayName,
      bio: c.bio,
      profileSlug: c.profileSlug,
      verificationStatus: c.verificationStatus as ContributorVerificationStatus,
      publishedResourcesCount: Number(resCount?.count || 0),
      createdAt: c.createdAt.toISOString(),
    };
  }

  async listPublicContributors(params: { page?: number; limit?: number } = {}): Promise<PaginatedList<ContributorPublicDto>> {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const offset = (page - 1) * limit;

    const [totalRow] = await this.db
      .select({ count: sql<string>`count(*)` })
      .from(contributors)
      .where(eq(contributors.status, 'ACTIVE'));

    const total = Number(totalRow?.count || 0);

    const rows = await this.db
      .select()
      .from(contributors)
      .where(eq(contributors.status, 'ACTIVE'))
      .orderBy(asc(contributors.displayName), asc(contributors.createdAt))
      .limit(limit)
      .offset(offset);

    // Fetch published counts for these contributors in batch
    const contributorIds = rows.map((r) => r.id);
    const countsMap = new Map<string, number>();

    if (contributorIds.length > 0) {
      const counts = await this.db
        .select({
          contributorId: resources.contributorId,
          count: sql<string>`count(*)`,
        })
        .from(resources)
        .where(and(inArray(resources.contributorId, contributorIds), eq(resources.status, 'PUBLISHED')))
        .groupBy(resources.contributorId);

      for (const row of counts) {
        if (row.contributorId) {
          countsMap.set(row.contributorId, Number(row.count));
        }
      }
    }

    const data: ContributorPublicDto[] = rows.map((c) => ({
      id: c.id,
      displayName: c.displayName,
      bio: c.bio,
      profileSlug: c.profileSlug,
      verificationStatus: c.verificationStatus as ContributorVerificationStatus,
      publishedResourcesCount: countsMap.get(c.id) || 0,
      createdAt: c.createdAt.toISOString(),
    }));

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async listContributorPublishedResources(slug: string, params: { page?: number; limit?: number } = {}): Promise<PaginatedList<any>> {
    const normalizedSlug = slug.toLowerCase().trim();
    const [c] = await this.db
      .select()
      .from(contributors)
      .where(and(eq(contributors.profileSlug, normalizedSlug), eq(contributors.status, 'ACTIVE')))
      .limit(1);

    if (!c) {
      throw new ContributorNotFoundError(`Active contributor not found for slug: "${slug}"`);
    }

    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const offset = (page - 1) * limit;

    const [totalRow] = await this.db
      .select({ count: sql<string>`count(*)` })
      .from(resources)
      .where(and(eq(resources.contributorId, c.id), eq(resources.status, 'PUBLISHED')));

    const total = Number(totalRow?.count || 0);

    const rows = await this.db
      .select({
        id: resources.id,
        title: resources.title,
        slug: resources.slug,
        description: resources.description,
        status: resources.status,
        qualityLabel: resources.qualityLabel,
        createdAt: resources.createdAt,
        updatedAt: resources.updatedAt,
      })
      .from(resources)
      .where(and(eq(resources.contributorId, c.id), eq(resources.status, 'PUBLISHED')))
      .orderBy(desc(resources.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      data: rows.map((r) => ({
        ...r,
        contributor: {
          id: c.id,
          displayName: c.displayName,
          profileSlug: c.profileSlug,
        },
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // --------------------------------------------------------------------------
  // Applications Workflow
  // --------------------------------------------------------------------------

  async submitApplication(userId: string, applicationText: string): Promise<ContributorApplicationDto> {
    const trimmedText = applicationText.trim();
    if (!trimmedText) {
      throw new ContributorValidationError('Application text must not be empty.');
    }

    // Check user exists and is active
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);

    if (!user || user.status !== 'ACTIVE') {
      throw new ContributorValidationError('User account must be active to apply.');
    }

    // Check if already an active contributor
    const [existingContributor] = await this.db
      .select()
      .from(contributors)
      .where(eq(contributors.userId, userId))
      .limit(1);

    if (existingContributor && existingContributor.status === 'ACTIVE') {
      throw new AlreadyContributorError();
    }

    // Check if already has an in-flight application
    const [pendingApp] = await this.db
      .select()
      .from(contributorApplications)
      .where(
        and(
          eq(contributorApplications.userId, userId),
          or(
            eq(contributorApplications.status, 'SUBMITTED'),
            eq(contributorApplications.status, 'UNDER_REVIEW'),
          ),
        ),
      )
      .limit(1);

    if (pendingApp) {
      throw new DuplicateApplicationError();
    }

    try {
      const [newApp] = await this.db
        .insert(contributorApplications)
        .values({
          userId,
          applicationText: trimmedText,
          status: 'SUBMITTED',
        })
        .returning();

      return this.mapApplication(newApp);
    } catch (err: any) {
      if (err.code === '23505') {
        throw new DuplicateApplicationError();
      }
      throw err;
    }
  }

  async listApplications(params: { status?: ContributorApplicationStatus; page?: number; limit?: number } = {}): Promise<PaginatedList<ContributorApplicationDto>> {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const offset = (page - 1) * limit;

    const conditions = params.status
      ? eq(contributorApplications.status, params.status)
      : undefined;

    const [totalRow] = await this.db
      .select({ count: sql<string>`count(*)` })
      .from(contributorApplications)
      .where(conditions);

    const total = Number(totalRow?.count || 0);

    const rows = await this.db
      .select()
      .from(contributorApplications)
      .where(conditions)
      .orderBy(desc(contributorApplications.submittedAt))
      .limit(limit)
      .offset(offset);

    return {
      data: rows.map((r) => this.mapApplication(r)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async reviewApplication(
    adminUserId: string,
    applicationId: string,
    action: 'APPROVE' | 'REJECT',
    notes?: string,
  ): Promise<{ application: ContributorApplicationDto; contributor?: ContributorPrivateDto }> {
    const trimmedNotes = notes?.trim();

    if (action === 'REJECT' && (!trimmedNotes || trimmedNotes.length === 0)) {
      throw new ContributorValidationError('Review notes are required when rejecting an application.');
    }

    return await this.db.transaction(async (tx) => {
      // 1. Fetch application with lock
      const [appRecord] = await tx
        .select()
        .from(contributorApplications)
        .where(eq(contributorApplications.id, applicationId))
        .limit(1);

      if (!appRecord) {
        throw new ApplicationNotFoundError();
      }

      if (appRecord.status === 'APPROVED' || appRecord.status === 'REJECTED') {
        throw new ApplicationAlreadyReviewedError();
      }

      const now = new Date();

      if (action === 'REJECT') {
        const [updatedApp] = await tx
          .update(contributorApplications)
          .set({
            status: 'REJECTED',
            reviewNotes: trimmedNotes,
            reviewedAt: now,
            reviewedBy: adminUserId,
          })
          .where(eq(contributorApplications.id, applicationId))
          .returning();

        return { application: this.mapApplication(updatedApp) };
      }

      // Action is APPROVE:
      // 2. Fetch user to derive display name
      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.id, appRecord.userId))
        .limit(1);

      if (!user) {
        throw new ContributorValidationError('Applicant user record not found.');
      }

      const displayName = user.displayName || 'Educational Contributor';
      const profileSlug = await this.generateUniqueSlug(tx as any, displayName);

      // 3. Atomically upsert contributor profile
      let contributorRecord: Contributor;
      const [existingContributor] = await tx
        .select()
        .from(contributors)
        .where(eq(contributors.userId, appRecord.userId))
        .limit(1);

      if (existingContributor) {
        const [updatedC] = await tx
          .update(contributors)
          .set({
            status: 'ACTIVE',
            updatedAt: now,
          })
          .where(eq(contributors.id, existingContributor.id))
          .returning();
        contributorRecord = updatedC;
      } else {
        const [newC] = await tx
          .insert(contributors)
          .values({
            userId: appRecord.userId,
            displayName,
            profileSlug,
            status: 'ACTIVE',
            verificationStatus: 'UNVERIFIED',
          })
          .returning();
        contributorRecord = newC;
      }

      // 4. Assign contributor role idempotently
      await this.rbac.assignRole({
        userId: appRecord.userId,
        roleSlug: 'contributor',
        createdBy: adminUserId,
      });

      // 5. Update application
      const [updatedApp] = await tx
        .update(contributorApplications)
        .set({
          status: 'APPROVED',
          reviewNotes: trimmedNotes || null,
          reviewedAt: now,
          reviewedBy: adminUserId,
        })
        .where(eq(contributorApplications.id, applicationId))
        .returning();

      return {
        application: this.mapApplication(updatedApp),
        contributor: this.mapContributor(contributorRecord),
      };
    });
  }

  // --------------------------------------------------------------------------
  // Contributor Workspace
  // --------------------------------------------------------------------------

  async getMyProfile(userId: string): Promise<ContributorPrivateDto> {
    const [c] = await this.db
      .select()
      .from(contributors)
      .where(eq(contributors.userId, userId))
      .limit(1);

    if (!c) {
      throw new NotAContributorError();
    }

    return this.mapContributor(c);
  }

  async updateMyProfile(
    userId: string,
    data: { displayName?: string; bio?: string | null },
  ): Promise<ContributorPrivateDto> {
    const [c] = await this.db
      .select()
      .from(contributors)
      .where(eq(contributors.userId, userId))
      .limit(1);

    if (!c) {
      throw new NotAContributorError();
    }

    // Lifecycle check: suspended contributors cannot edit profiles
    if (c.status === 'SUSPENDED') {
      throw new ContributorSuspendedError('Suspended contributors cannot update their profile.');
    }

    if (c.status !== 'ACTIVE') {
      throw new ContributorError('Only active contributors can update their profile.', 'CONTRIBUTOR_NOT_ACTIVE', 403);
    }

    const updates: Partial<typeof contributors.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (data.displayName !== undefined) {
      const trimmed = data.displayName.trim();
      if (!trimmed || trimmed.length > 100) {
        throw new ContributorValidationError('Display name must be between 1 and 100 characters.');
      }
      updates.displayName = trimmed;
    }

    if (data.bio !== undefined) {
      updates.bio = data.bio?.trim() || null;
    }

    const [updated] = await this.db
      .update(contributors)
      .set(updates)
      .where(eq(contributors.id, c.id))
      .returning();

    return this.mapContributor(updated);
  }

  async createSubmission(
    userId: string,
    params: CreateSubmissionParams,
  ): Promise<ContributorSubmissionDto> {
    const [c] = await this.db
      .select()
      .from(contributors)
      .where(eq(contributors.userId, userId))
      .limit(1);

    if (!c) {
      throw new NotAContributorError();
    }

    // Lifecycle check
    if (c.status === 'SUSPENDED') {
      throw new ContributorSuspendedError('Suspended contributors cannot create new submissions.');
    }

    if (c.status !== 'ACTIVE') {
      throw new ContributorError('Only active contributors can create submissions.', 'CONTRIBUTOR_NOT_ACTIVE', 403);
    }

    const title = params.title?.trim();
    if (!title) {
      throw new ContributorValidationError('Submission title must not be empty.');
    }

    // Currency consistency check (Prompt 18/19/21 requirement)
    let proposedPrice = params.proposedPriceMinor;
    let proposedCurrency = params.proposedCurrencyCode;

    if (proposedPrice !== undefined && proposedPrice !== null) {
      if (proposedPrice < 0) {
        throw new ContributorValidationError('Proposed price must be non-negative.');
      }
      if (proposedCurrency && proposedCurrency !== 'KES') {
        throw new ContributorValidationError('Only KES currency is supported.');
      }
      proposedCurrency = 'KES';
    } else {
      proposedPrice = null;
      proposedCurrency = null;
    }

    const [sub] = await this.db
      .insert(contributorSubmissions)
      .values({
        contributorId: c.id,
        title,
        description: params.description?.trim() || null,
        proposedPriceMinor: proposedPrice,
        proposedCurrencyCode: proposedCurrency,
        resourceId: params.resourceId || null,
        status: 'DRAFT',
      })
      .returning();

    return this.mapSubmission(sub);
  }

  async updateSubmission(
    userId: string,
    submissionId: string,
    params: UpdateSubmissionParams,
  ): Promise<ContributorSubmissionDto> {
    const [c] = await this.db
      .select()
      .from(contributors)
      .where(eq(contributors.userId, userId))
      .limit(1);

    if (!c) {
      throw new NotAContributorError();
    }

    if (c.status === 'SUSPENDED') {
      throw new ContributorSuspendedError('Suspended contributors cannot update submissions.');
    }

    const [sub] = await this.db
      .select()
      .from(contributorSubmissions)
      .where(and(eq(contributorSubmissions.id, submissionId), eq(contributorSubmissions.contributorId, c.id)))
      .limit(1);

    if (!sub) {
      throw new SubmissionNotFoundError();
    }

    if (sub.status !== 'DRAFT') {
      throw new SubmissionNotEditableError();
    }

    const updates: Partial<typeof contributorSubmissions.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (params.title !== undefined) {
      const trimmed = params.title.trim();
      if (!trimmed) {
        throw new ContributorValidationError('Title must not be empty.');
      }
      updates.title = trimmed;
    }

    if (params.description !== undefined) {
      updates.description = params.description?.trim() || null;
    }

    if (params.proposedPriceMinor !== undefined) {
      if (params.proposedPriceMinor !== null) {
        if (params.proposedPriceMinor < 0) {
          throw new ContributorValidationError('Proposed price must be non-negative.');
        }
        updates.proposedPriceMinor = params.proposedPriceMinor;
        updates.proposedCurrencyCode = 'KES';
      } else {
        updates.proposedPriceMinor = null;
        updates.proposedCurrencyCode = null;
      }
    }

    const [updated] = await this.db
      .update(contributorSubmissions)
      .set(updates)
      .where(eq(contributorSubmissions.id, sub.id))
      .returning();

    return this.mapSubmission(updated);
  }

  async submitSubmission(userId: string, submissionId: string): Promise<ContributorSubmissionDto> {
    const [c] = await this.db
      .select()
      .from(contributors)
      .where(eq(contributors.userId, userId))
      .limit(1);

    if (!c) {
      throw new NotAContributorError();
    }

    if (c.status === 'SUSPENDED') {
      throw new ContributorSuspendedError('Suspended contributors cannot submit drafts for review.');
    }

    const [sub] = await this.db
      .select()
      .from(contributorSubmissions)
      .where(and(eq(contributorSubmissions.id, submissionId), eq(contributorSubmissions.contributorId, c.id)))
      .limit(1);

    if (!sub) {
      throw new SubmissionNotFoundError();
    }

    if (sub.status !== 'DRAFT') {
      throw new SubmissionNotEditableError('Submission has already been submitted or locked.');
    }

    const [updated] = await this.db
      .update(contributorSubmissions)
      .set({
        status: 'SUBMITTED',
        submittedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(contributorSubmissions.id, sub.id))
      .returning();

    return this.mapSubmission(updated);
  }

  async listMySubmissions(
    userId: string,
    params: { page?: number; limit?: number } = {},
  ): Promise<PaginatedList<ContributorSubmissionDto>> {
    const [c] = await this.db
      .select()
      .from(contributors)
      .where(eq(contributors.userId, userId))
      .limit(1);

    if (!c) {
      throw new NotAContributorError();
    }

    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const offset = (page - 1) * limit;

    const [totalRow] = await this.db
      .select({ count: sql<string>`count(*)` })
      .from(contributorSubmissions)
      .where(eq(contributorSubmissions.contributorId, c.id));

    const total = Number(totalRow?.count || 0);

    const rows = await this.db
      .select()
      .from(contributorSubmissions)
      .where(eq(contributorSubmissions.contributorId, c.id))
      .orderBy(desc(contributorSubmissions.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      data: rows.map((r) => this.mapSubmission(r)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getSubmissionById(userId: string, submissionId: string): Promise<ContributorSubmissionDto> {
    const [c] = await this.db
      .select()
      .from(contributors)
      .where(eq(contributors.userId, userId))
      .limit(1);

    if (!c) {
      throw new NotAContributorError();
    }

    const [sub] = await this.db
      .select()
      .from(contributorSubmissions)
      .where(and(eq(contributorSubmissions.id, submissionId), eq(contributorSubmissions.contributorId, c.id)))
      .limit(1);

    if (!sub) {
      throw new SubmissionNotFoundError();
    }

    return this.mapSubmission(sub);
  }

  // --------------------------------------------------------------------------
  // Administration & Editorial Review
  // --------------------------------------------------------------------------

  async listAdminContributors(
    params: { status?: ContributorStatus; verificationStatus?: ContributorVerificationStatus; page?: number; limit?: number } = {},
  ): Promise<PaginatedList<ContributorPrivateDto>> {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const offset = (page - 1) * limit;

    const conditions: any[] = [];
    if (params.status) {
      conditions.push(eq(contributors.status, params.status));
    }
    if (params.verificationStatus) {
      conditions.push(eq(contributors.verificationStatus, params.verificationStatus));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalRow] = await this.db
      .select({ count: sql<string>`count(*)` })
      .from(contributors)
      .where(whereClause);

    const total = Number(totalRow?.count || 0);

    const rows = await this.db
      .select()
      .from(contributors)
      .where(whereClause)
      .orderBy(desc(contributors.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      data: rows.map((r) => this.mapContributor(r)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async updateContributorStatus(
    adminUserId: string,
    contributorId: string,
    status: ContributorStatus,
    _reason?: string,
  ): Promise<ContributorPrivateDto> {
    const [c] = await this.db
      .select()
      .from(contributors)
      .where(eq(contributors.id, contributorId))
      .limit(1);

    if (!c) {
      throw new ContributorNotFoundError();
    }

    const now = new Date();
    const updates: Partial<typeof contributors.$inferInsert> = {
      status,
      updatedAt: now,
    };

    if (status === 'SUSPENDED') {
      updates.suspendedAt = now;
      updates.suspendedBy = adminUserId;
    } else {
      updates.suspendedAt = null;
      updates.suspendedBy = null;
    }

    const [updated] = await this.db
      .update(contributors)
      .set(updates)
      .where(eq(contributors.id, contributorId))
      .returning();

    return this.mapContributor(updated);
  }

  async reviewSubmission(
    adminUserId: string,
    submissionId: string,
    action: 'APPROVE' | 'REJECT',
    notes?: string,
  ): Promise<ContributorSubmissionDto> {
    const trimmedNotes = notes?.trim();
    if (action === 'REJECT' && (!trimmedNotes || trimmedNotes.length === 0)) {
      throw new ContributorValidationError('Review notes are required when rejecting a submission.');
    }

    const [sub] = await this.db
      .select()
      .from(contributorSubmissions)
      .where(eq(contributorSubmissions.id, submissionId))
      .limit(1);

    if (!sub) {
      throw new SubmissionNotFoundError();
    }

    if (sub.status === 'APPROVED' || sub.status === 'REJECTED' || sub.status === 'PUBLISHED') {
      throw new ContributorValidationError(`Cannot review submission in "${sub.status}" status.`);
    }

    const now = new Date();
    const updates: Partial<typeof contributorSubmissions.$inferInsert> = {
      status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      reviewedAt: now,
      reviewedBy: adminUserId,
      updatedAt: now,
    };

    const [updated] = await this.db
      .update(contributorSubmissions)
      .set(updates)
      .where(eq(contributorSubmissions.id, submissionId))
      .returning();

    return this.mapSubmission(updated);
  }

  // --------------------------------------------------------------------------
  // Mappers
  // --------------------------------------------------------------------------

  private mapContributor(c: Contributor): ContributorPrivateDto {
    return {
      id: c.id,
      userId: c.userId,
      displayName: c.displayName,
      bio: c.bio,
      profileSlug: c.profileSlug,
      status: c.status as ContributorStatus,
      verificationStatus: c.verificationStatus as ContributorVerificationStatus,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  }

  private mapApplication(a: ContributorApplication): ContributorApplicationDto {
    return {
      id: a.id,
      userId: a.userId,
      applicationText: a.applicationText,
      status: a.status as ContributorApplicationStatus,
      reviewNotes: a.reviewNotes,
      submittedAt: a.submittedAt.toISOString(),
      reviewedAt: a.reviewedAt?.toISOString() || null,
      reviewedBy: a.reviewedBy,
    };
  }

  private mapSubmission(s: ContributorSubmission): ContributorSubmissionDto {
    return {
      id: s.id,
      contributorId: s.contributorId,
      title: s.title,
      description: s.description,
      proposedPriceMinor: s.proposedPriceMinor,
      proposedCurrencyCode: s.proposedCurrencyCode,
      status: s.status as ContributorSubmissionStatus,
      resourceId: s.resourceId,
      submittedAt: s.submittedAt?.toISOString() || null,
      reviewedAt: s.reviewedAt?.toISOString() || null,
      reviewedBy: s.reviewedBy,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    };
  }
}

export const contributorService = new DefaultContributorService();
