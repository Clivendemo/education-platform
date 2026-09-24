import { eq, and, desc } from 'drizzle-orm';
import { type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { db as defaultDb } from '../db/index.js';
import * as schemas from '../db/schemas.js';
import {
  resources,
  resourceVersions,
  publicationEvents,
  countries,
  resourceTypes,
  schools,
  curricula,
  type ResourceStatus,
  type PublicationEventType,
} from '../db/schemas.js';

export interface PublicationEventResult {
  id: string;
  resourceId: string;
  resourceVersionId: string | null;
  eventType: PublicationEventType;
  fromStatus: string;
  toStatus: string;
  actorUserId: string | null;
  reason: string | null;
  createdAt: string;
}

export interface PublishResult {
  resource: {
    id: string;
    status: ResourceStatus;
    updatedAt: string;
  };
  version: {
    id: string;
    status: string;
    versionNumber: number;
    publishedAt: string;
    updatedAt: string;
  };
  event: PublicationEventResult;
}

export class PublicationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'PublicationError';
  }
}

export interface PublicationService {
  submitResourceForReview(
    resourceId: string,
    options?: { versionId?: string; actorUserId?: string },
  ): Promise<{ resourceId: string; status: ResourceStatus; versionId: string; event: PublicationEventResult }>;

  approveResource(
    resourceId: string,
    options?: { actorUserId?: string },
  ): Promise<{ resourceId: string; status: ResourceStatus; event: PublicationEventResult }>;

  rejectResource(
    resourceId: string,
    reason: string,
    options?: { actorUserId?: string },
  ): Promise<{ resourceId: string; status: ResourceStatus; versionId?: string; event: PublicationEventResult }>;

  publishResourceVersion(
    resourceId: string,
    versionId: string,
    options?: { actorUserId?: string },
  ): Promise<PublishResult>;

  archiveResource(
    resourceId: string,
    reason?: string,
    options?: { actorUserId?: string },
  ): Promise<{ resourceId: string; status: ResourceStatus; event: PublicationEventResult }>;

  returnResourceToDraft(
    resourceId: string,
    reason?: string,
    options?: { actorUserId?: string },
  ): Promise<{ resourceId: string; status: ResourceStatus; versionId?: string; event: PublicationEventResult }>;

  getPublicationHistory(resourceId: string): Promise<PublicationEventResult[]>;
}

export class DbPublicationService implements PublicationService {
  constructor(private readonly dbInstance: NodePgDatabase<typeof schemas> = defaultDb) {}

  /**
   * Submit Resource & Candidate Version for Review (Atomic Transaction)
   * Resource: DRAFT -> IN_REVIEW
   * Target Candidate Version: DRAFT -> IN_REVIEW
   */
  async submitResourceForReview(
    resourceId: string,
    options?: { versionId?: string; actorUserId?: string },
  ): Promise<{ resourceId: string; status: ResourceStatus; versionId: string; event: PublicationEventResult }> {
    return await this.dbInstance.transaction(async (tx) => {
      // 1. Fetch resource
      const [res] = await tx
        .select()
        .from(resources)
        .where(eq(resources.id, resourceId))
        .limit(1);

      if (!res) {
        throw new PublicationError('RESOURCE_NOT_FOUND', `Resource with id ${resourceId} not found`, 404);
      }

      if (res.status !== 'DRAFT') {
        throw new PublicationError(
          'INVALID_STATUS_TRANSITION',
          `Cannot submit resource for review: current status is ${res.status}, must be DRAFT.`,
          400,
        );
      }

      // 2. Determine target version (either explicit or latest draft)
      let targetVersion;
      if (options?.versionId) {
        const [v] = await tx
          .select()
          .from(resourceVersions)
          .where(eq(resourceVersions.id, options.versionId))
          .limit(1);

        if (!v) {
          throw new PublicationError('RESOURCE_VERSION_NOT_FOUND', `Version with id ${options.versionId} not found`, 404);
        }
        if (v.resourceId !== resourceId) {
          throw new PublicationError(
            'RESOURCE_VERSION_MISMATCH',
            `Version ${options.versionId} does not belong to resource ${resourceId}`,
            400,
          );
        }
        targetVersion = v;
      } else {
        const versions = await tx
          .select()
          .from(resourceVersions)
          .where(eq(resourceVersions.resourceId, resourceId))
          .orderBy(desc(resourceVersions.versionNumber));

        const draftVersion = versions.find((v) => v.status === 'DRAFT');
        if (!draftVersion) {
          throw new PublicationError(
            'PUBLICATION_PRECONDITION_FAILED',
            'Cannot submit resource for review: no candidate version in DRAFT status found.',
            422,
          );
        }
        targetVersion = draftVersion;
      }

      if (targetVersion.status !== 'DRAFT') {
        throw new PublicationError(
          'INVALID_STATUS_TRANSITION',
          `Candidate version must be in DRAFT status to submit for review (current status: ${targetVersion.status}).`,
          400,
        );
      }

      // 3. Atomically update resource and version to IN_REVIEW
      await tx
        .update(resources)
        .set({ status: 'IN_REVIEW', updatedAt: new Date() })
        .where(eq(resources.id, resourceId));

      await tx
        .update(resourceVersions)
        .set({ status: 'IN_REVIEW', updatedAt: new Date() })
        .where(eq(resourceVersions.id, targetVersion.id));

      // 4. Record publication event
      const [event] = await tx
        .insert(publicationEvents)
        .values({
          resourceId,
          resourceVersionId: targetVersion.id,
          eventType: 'SUBMITTED',
          fromStatus: 'DRAFT',
          toStatus: 'IN_REVIEW',
          actorUserId: options?.actorUserId ?? null,
          reason: null,
        })
        .returning();

      return {
        resourceId,
        status: 'IN_REVIEW',
        versionId: targetVersion.id,
        event: {
          id: event.id,
          resourceId: event.resourceId,
          resourceVersionId: event.resourceVersionId,
          eventType: event.eventType as PublicationEventType,
          fromStatus: event.fromStatus,
          toStatus: event.toStatus,
          actorUserId: event.actorUserId,
          reason: event.reason,
          createdAt: event.createdAt.toISOString(),
        },
      };
    });
  }

  /**
   * Approve Resource
   * Requires:
   * 1. Resource status is IN_REVIEW -> APPROVED
   * 2. Candidate resource version MUST currently be IN_REVIEW
   */
  async approveResource(
    resourceId: string,
    options?: { actorUserId?: string },
  ): Promise<{ resourceId: string; status: ResourceStatus; event: PublicationEventResult }> {
    return await this.dbInstance.transaction(async (tx) => {
      const [res] = await tx
        .select()
        .from(resources)
        .where(eq(resources.id, resourceId))
        .limit(1);

      if (!res) {
        throw new PublicationError('RESOURCE_NOT_FOUND', `Resource with id ${resourceId} not found`, 404);
      }

      if (res.status !== 'IN_REVIEW') {
        throw new PublicationError(
          'INVALID_STATUS_TRANSITION',
          `Cannot approve resource: current status is ${res.status}, must be IN_REVIEW.`,
          400,
        );
      }

      // Check candidate version status: at least one candidate version MUST be IN_REVIEW
      const inReviewVersions = await tx
        .select()
        .from(resourceVersions)
        .where(
          and(
            eq(resourceVersions.resourceId, resourceId),
            eq(resourceVersions.status, 'IN_REVIEW'),
          ),
        );

      if (inReviewVersions.length === 0) {
        throw new PublicationError(
          'PUBLICATION_PRECONDITION_FAILED',
          'Cannot approve resource: candidate resource version must be IN_REVIEW.',
          422,
        );
      }

      const candidateVersion = inReviewVersions[0];

      await tx
        .update(resources)
        .set({ status: 'APPROVED', updatedAt: new Date() })
        .where(eq(resources.id, resourceId));

      const [event] = await tx
        .insert(publicationEvents)
        .values({
          resourceId,
          resourceVersionId: candidateVersion.id,
          eventType: 'APPROVED',
          fromStatus: 'IN_REVIEW',
          toStatus: 'APPROVED',
          actorUserId: options?.actorUserId ?? null,
          reason: null,
        })
        .returning();

      return {
        resourceId,
        status: 'APPROVED',
        event: {
          id: event.id,
          resourceId: event.resourceId,
          resourceVersionId: event.resourceVersionId,
          eventType: event.eventType as PublicationEventType,
          fromStatus: event.fromStatus,
          toStatus: event.toStatus,
          actorUserId: event.actorUserId,
          reason: event.reason,
          createdAt: event.createdAt.toISOString(),
        },
      };
    });
  }

  /**
   * Reject Resource
   * Allowed from: IN_REVIEW or APPROVED
   * Transitions:
   * Resource -> REJECTED
   * Candidate Version (IN_REVIEW) -> REJECTED
   * Requires: mandatory non-empty reason
   */
  async rejectResource(
    resourceId: string,
    reason: string,
    options?: { actorUserId?: string },
  ): Promise<{ resourceId: string; status: ResourceStatus; versionId?: string; event: PublicationEventResult }> {
    if (!reason || reason.trim().length === 0) {
      throw new PublicationError('REJECTION_REASON_REQUIRED', 'A non-empty rejection reason is required.', 400);
    }

    return await this.dbInstance.transaction(async (tx) => {
      const [res] = await tx
        .select()
        .from(resources)
        .where(eq(resources.id, resourceId))
        .limit(1);

      if (!res) {
        throw new PublicationError('RESOURCE_NOT_FOUND', `Resource with id ${resourceId} not found`, 404);
      }

      if (res.status !== 'IN_REVIEW' && res.status !== 'APPROVED') {
        throw new PublicationError(
          'INVALID_STATUS_TRANSITION',
          `Cannot reject resource: current status is ${res.status}, must be IN_REVIEW or APPROVED.`,
          400,
        );
      }

      const fromStatus = res.status;

      // Find candidate version in IN_REVIEW
      const inReviewVersions = await tx
        .select()
        .from(resourceVersions)
        .where(
          and(
            eq(resourceVersions.resourceId, resourceId),
            eq(resourceVersions.status, 'IN_REVIEW'),
          ),
        );

      let targetVersionId: string | null = null;
      if (inReviewVersions.length > 0) {
        const v = inReviewVersions[0];
        targetVersionId = v.id;
        await tx
          .update(resourceVersions)
          .set({ status: 'REJECTED', updatedAt: new Date() })
          .where(eq(resourceVersions.id, v.id));
      }

      await tx
        .update(resources)
        .set({ status: 'REJECTED', updatedAt: new Date() })
        .where(eq(resources.id, resourceId));

      const [event] = await tx
        .insert(publicationEvents)
        .values({
          resourceId,
          resourceVersionId: targetVersionId,
          eventType: 'REJECTED',
          fromStatus,
          toStatus: 'REJECTED',
          actorUserId: options?.actorUserId ?? null,
          reason: reason.trim(),
        })
        .returning();

      return {
        resourceId,
        status: 'REJECTED',
        versionId: targetVersionId ?? undefined,
        event: {
          id: event.id,
          resourceId: event.resourceId,
          resourceVersionId: event.resourceVersionId,
          eventType: event.eventType as PublicationEventType,
          fromStatus: event.fromStatus,
          toStatus: event.toStatus,
          actorUserId: event.actorUserId,
          reason: event.reason,
          createdAt: event.createdAt.toISOString(),
        },
      };
    });
  }

  /**
   * Return Resource to Draft
   * Allowed from: REJECTED only
   * Terminal ARCHIVED resources CANNOT be returned to DRAFT (INVALID_STATUS_TRANSITION)
   * Synchronizes candidate version: REJECTED -> DRAFT
   */
  async returnResourceToDraft(
    resourceId: string,
    reason?: string,
    options?: { actorUserId?: string },
  ): Promise<{ resourceId: string; status: ResourceStatus; versionId?: string; event: PublicationEventResult }> {
    return await this.dbInstance.transaction(async (tx) => {
      const [res] = await tx
        .select()
        .from(resources)
        .where(eq(resources.id, resourceId))
        .limit(1);

      if (!res) {
        throw new PublicationError('RESOURCE_NOT_FOUND', `Resource with id ${resourceId} not found`, 404);
      }

      if (res.status === 'ARCHIVED') {
        throw new PublicationError(
          'INVALID_STATUS_TRANSITION',
          'Cannot return resource to draft: ARCHIVED status is terminal.',
          400,
        );
      }

      if (res.status !== 'REJECTED') {
        throw new PublicationError(
          'INVALID_STATUS_TRANSITION',
          `Cannot return resource to draft: current status is ${res.status}, must be REJECTED.`,
          400,
        );
      }

      // Synchronize candidate version: REJECTED -> DRAFT
      const rejectedVersions = await tx
        .select()
        .from(resourceVersions)
        .where(
          and(
            eq(resourceVersions.resourceId, resourceId),
            eq(resourceVersions.status, 'REJECTED'),
          ),
        );

      let targetVersionId: string | null = null;
      if (rejectedVersions.length > 0) {
        const v = rejectedVersions[0];
        targetVersionId = v.id;
        await tx
          .update(resourceVersions)
          .set({ status: 'DRAFT', updatedAt: new Date() })
          .where(eq(resourceVersions.id, v.id));
      }

      await tx
        .update(resources)
        .set({ status: 'DRAFT', updatedAt: new Date() })
        .where(eq(resources.id, resourceId));

      const [event] = await tx
        .insert(publicationEvents)
        .values({
          resourceId,
          resourceVersionId: targetVersionId,
          eventType: 'RETURNED_TO_DRAFT',
          fromStatus: 'REJECTED',
          toStatus: 'DRAFT',
          actorUserId: options?.actorUserId ?? null,
          reason: reason ? reason.trim() : null,
        })
        .returning();

      return {
        resourceId,
        status: 'DRAFT',
        versionId: targetVersionId ?? undefined,
        event: {
          id: event.id,
          resourceId: event.resourceId,
          resourceVersionId: event.resourceVersionId,
          eventType: event.eventType as PublicationEventType,
          fromStatus: event.fromStatus,
          toStatus: event.toStatus,
          actorUserId: event.actorUserId,
          reason: event.reason,
          createdAt: event.createdAt.toISOString(),
        },
      };
    });
  }

  /**
   * Publish Resource Version (Transactional Publication)
   * Preconditions:
   * 1. Resource is APPROVED
   * 2. Target Version MUST be IN_REVIEW (DRAFT or other status rejected)
   * 3. Resource country exists & is ACTIVE
   * 4. Resource type exists & is ACTIVE
   * 5. Title and slug non-empty & valid
   * 6. Curriculum & school references satisfy existing integrity
   * 7. Version belongs to resource (RESOURCE_VERSION_MISMATCH check)
   * 8. No published version already exists (PUBLISHED_VERSION_ALREADY_EXISTS check)
   *
   * Atomically:
   * resource.status = PUBLISHED
   * version.status = PUBLISHED
   * version.published_at = now()
   * event: PUBLISHED
   */
  async publishResourceVersion(
    resourceId: string,
    versionId: string,
    options?: { actorUserId?: string },
  ): Promise<PublishResult> {
    return await this.dbInstance.transaction(async (tx) => {
      // 1. Fetch resource
      const [res] = await tx
        .select()
        .from(resources)
        .where(eq(resources.id, resourceId))
        .limit(1);

      if (!res) {
        throw new PublicationError('RESOURCE_NOT_FOUND', `Resource with id ${resourceId} not found`, 404);
      }

      if (res.status !== 'APPROVED') {
        throw new PublicationError(
          'INVALID_STATUS_TRANSITION',
          `Cannot publish resource: current status is ${res.status}, must be APPROVED.`,
          400,
        );
      }

      // 2. Fetch version
      const [ver] = await tx
        .select()
        .from(resourceVersions)
        .where(eq(resourceVersions.id, versionId))
        .limit(1);

      if (!ver) {
        throw new PublicationError('RESOURCE_VERSION_NOT_FOUND', `Version with id ${versionId} not found`, 404);
      }

      if (ver.resourceId !== resourceId) {
        throw new PublicationError(
          'RESOURCE_VERSION_MISMATCH',
          `Version ${versionId} does not belong to resource ${resourceId}`,
          400,
        );
      }

      // Change 2 Invariant: Target version MUST be IN_REVIEW
      if (ver.status !== 'IN_REVIEW') {
        throw new PublicationError(
          'PUBLICATION_PRECONDITION_FAILED',
          `Cannot publish version: target version status is ${ver.status}, MUST be IN_REVIEW. DRAFT versions cannot be published directly.`,
          422,
        );
      }

      // 3. Precondition: Check if resource already has a published version
      const alreadyPublished = await tx
        .select()
        .from(resourceVersions)
        .where(
          and(
            eq(resourceVersions.resourceId, resourceId),
            eq(resourceVersions.status, 'PUBLISHED'),
          ),
        );

      if (alreadyPublished.length > 0) {
        throw new PublicationError(
          'PUBLISHED_VERSION_ALREADY_EXISTS',
          `Resource ${resourceId} already has a PUBLISHED version (${alreadyPublished[0].versionLabel}). Only one published version is permitted.`,
          409,
        );
      }

      // 4. Precondition: Validate country is active
      const [country] = await tx
        .select()
        .from(countries)
        .where(eq(countries.id, res.countryId))
        .limit(1);

      if (!country || country.status !== 'ACTIVE') {
        throw new PublicationError(
          'PUBLICATION_PRECONDITION_FAILED',
          'Cannot publish resource: associated country does not exist or is INACTIVE.',
          422,
        );
      }

      // 5. Precondition: Validate resource type is active
      const [resType] = await tx
        .select()
        .from(resourceTypes)
        .where(eq(resourceTypes.id, res.resourceTypeId))
        .limit(1);

      if (!resType || resType.status !== 'ACTIVE') {
        throw new PublicationError(
          'PUBLICATION_PRECONDITION_FAILED',
          'Cannot publish resource: associated resource type does not exist or is INACTIVE.',
          422,
        );
      }

      // 6. Precondition: Validate School if present
      if (res.schoolId) {
        const [sch] = await tx
          .select()
          .from(schools)
          .where(eq(schools.id, res.schoolId))
          .limit(1);

        if (!sch || sch.status !== 'ACTIVE' || sch.countryId !== res.countryId) {
          throw new PublicationError(
            'PUBLICATION_PRECONDITION_FAILED',
            'Cannot publish resource: associated school is invalid or inactive.',
            422,
          );
        }
      }

      // 7. Precondition: Validate Curriculum if present
      if (res.curriculumId) {
        const [curr] = await tx
          .select()
          .from(curricula)
          .where(eq(curricula.id, res.curriculumId))
          .limit(1);

        if (!curr || curr.status !== 'ACTIVE' || curr.countryId !== res.countryId) {
          throw new PublicationError(
            'PUBLICATION_PRECONDITION_FAILED',
            'Cannot publish resource: associated curriculum is invalid or inactive.',
            422,
          );
        }
      }

      // 8. Execute Atomic Publication
      const now = new Date();

      const [updatedResource] = await tx
        .update(resources)
        .set({
          status: 'PUBLISHED',
          updatedAt: now,
        })
        .where(eq(resources.id, resourceId))
        .returning();

      const [updatedVersion] = await tx
        .update(resourceVersions)
        .set({
          status: 'PUBLISHED',
          publishedAt: now,
          updatedAt: now,
        })
        .where(eq(resourceVersions.id, versionId))
        .returning();

      const [event] = await tx
        .insert(publicationEvents)
        .values({
          resourceId,
          resourceVersionId: versionId,
          eventType: 'PUBLISHED',
          fromStatus: 'APPROVED',
          toStatus: 'PUBLISHED',
          actorUserId: options?.actorUserId ?? null,
          reason: null,
        })
        .returning();

      return {
        resource: {
          id: updatedResource.id,
          status: updatedResource.status as ResourceStatus,
          updatedAt: updatedResource.updatedAt.toISOString(),
        },
        version: {
          id: updatedVersion.id,
          status: updatedVersion.status,
          versionNumber: updatedVersion.versionNumber,
          publishedAt: updatedVersion.publishedAt!.toISOString(),
          updatedAt: updatedVersion.updatedAt.toISOString(),
        },
        event: {
          id: event.id,
          resourceId: event.resourceId,
          resourceVersionId: event.resourceVersionId,
          eventType: event.eventType as PublicationEventType,
          fromStatus: event.fromStatus,
          toStatus: event.toStatus,
          actorUserId: event.actorUserId,
          reason: event.reason,
          createdAt: event.createdAt.toISOString(),
        },
      };
    });
  }

  /**
   * Archive Resource (Terminal State)
   * Allowed from: PUBLISHED only
   * Sets resource.status = ARCHIVED
   * Published version row is NOT mutated (maintains version immutability)
   */
  async archiveResource(
    resourceId: string,
    reason?: string,
    options?: { actorUserId?: string },
  ): Promise<{ resourceId: string; status: ResourceStatus; event: PublicationEventResult }> {
    return await this.dbInstance.transaction(async (tx) => {
      const [res] = await tx
        .select()
        .from(resources)
        .where(eq(resources.id, resourceId))
        .limit(1);

      if (!res) {
        throw new PublicationError('RESOURCE_NOT_FOUND', `Resource with id ${resourceId} not found`, 404);
      }

      if (res.status !== 'PUBLISHED') {
        throw new PublicationError(
          'INVALID_STATUS_TRANSITION',
          `Cannot archive resource: current status is ${res.status}, must be PUBLISHED.`,
          400,
        );
      }

      // Find current published version (if any) to reference in audit event
      const publishedVersions = await tx
        .select()
        .from(resourceVersions)
        .where(
          and(
            eq(resourceVersions.resourceId, resourceId),
            eq(resourceVersions.status, 'PUBLISHED'),
          ),
        );

      const targetVersionId = publishedVersions.length > 0 ? publishedVersions[0].id : null;

      const [updatedResource] = await tx
        .update(resources)
        .set({
          status: 'ARCHIVED',
          updatedAt: new Date(),
        })
        .where(eq(resources.id, resourceId))
        .returning();

      const [event] = await tx
        .insert(publicationEvents)
        .values({
          resourceId,
          resourceVersionId: targetVersionId,
          eventType: 'ARCHIVED',
          fromStatus: 'PUBLISHED',
          toStatus: 'ARCHIVED',
          actorUserId: options?.actorUserId ?? null,
          reason: reason ? reason.trim() : null,
        })
        .returning();

      return {
        resourceId: updatedResource.id,
        status: updatedResource.status as ResourceStatus,
        event: {
          id: event.id,
          resourceId: event.resourceId,
          resourceVersionId: event.resourceVersionId,
          eventType: event.eventType as PublicationEventType,
          fromStatus: event.fromStatus,
          toStatus: event.toStatus,
          actorUserId: event.actorUserId,
          reason: event.reason,
          createdAt: event.createdAt.toISOString(),
        },
      };
    });
  }

  /**
   * Get Publication History for a Resource
   */
  async getPublicationHistory(resourceId: string): Promise<PublicationEventResult[]> {
    // Check resource existence
    const [res] = await this.dbInstance
      .select()
      .from(resources)
      .where(eq(resources.id, resourceId))
      .limit(1);

    if (!res) {
      throw new PublicationError('RESOURCE_NOT_FOUND', `Resource with id ${resourceId} not found`, 404);
    }

    const rows = await this.dbInstance
      .select()
      .from(publicationEvents)
      .where(eq(publicationEvents.resourceId, resourceId))
      .orderBy(desc(publicationEvents.createdAt));

    return rows.map((e) => ({
      id: e.id,
      resourceId: e.resourceId,
      resourceVersionId: e.resourceVersionId,
      eventType: e.eventType as PublicationEventType,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      actorUserId: e.actorUserId,
      reason: e.reason,
      createdAt: e.createdAt.toISOString(),
    }));
  }
}

export const defaultPublicationService = new DbPublicationService();
