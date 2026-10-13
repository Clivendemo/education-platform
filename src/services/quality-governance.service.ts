import { eq, and, desc, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { db as defaultDb } from '../db/index.js';
import * as schemas from '../db/schemas.js';
import {
  qualityCheckTypes,
  resourceQualityChecks,
  resourceVerifications,
  type QualityCheckStatus,
  type VerificationStatus,
} from '../db/schema/governance.js';
import { resources, resourceVersions } from '../db/schema/resource.js';
import { users } from '../db/schema/identity.js';

// ============================================================================
// Error Hierarchy
// ============================================================================

export class QualityGovernanceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'QualityGovernanceError';
  }
}

// ============================================================================
// DTOs & Interfaces
// ============================================================================

export interface QualityCheckTypeDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  countryId: string | null;
  requiredForVerification: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

export interface ResourceQualityCheckDto {
  id: string;
  resourceId: string;
  resourceVersionId: string;
  checkTypeId: string;
  checkTypeCode: string;
  checkTypeName: string;
  status: QualityCheckStatus;
  required: boolean;
  notes: string | null;
  checkedBy: string;
  checkedAt: string;
  createdAt: string;
}

export interface ResourceVerificationDto {
  id: string;
  resourceId: string;
  resourceVersionId: string;
  verificationStatus: VerificationStatus;
  reason: string | null;
  verifiedBy: string;
  verifiedAt: string;
  revokedBy: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceQualityDetailDto {
  resourceId: string;
  versionId: string | null;
  isVerified: boolean;
  qualityLabel: string;
  activeVerification: ResourceVerificationDto | null;
  checks: ResourceQualityCheckDto[];
  evaluationHistory: ResourceQualityCheckDto[];
  verificationHistory: ResourceVerificationDto[];
}

export interface RecordQualityCheckParams {
  resourceId: string;
  versionId: string;
  checkTypeCode: string;
  status: QualityCheckStatus;
  notes?: string | null;
  actorUserId: string;
}

export interface VerifyResourceVersionParams {
  resourceId: string;
  versionId: string;
  notes?: string | null;
  actorUserId: string;
}

export interface RevokeResourceVerificationParams {
  resourceId: string;
  versionId?: string;
  reason: string;
  actorUserId: string;
}

export interface QualityGovernanceService {
  listCheckTypes(options?: {
    countryId?: string | null;
    includeInactive?: boolean;
  }): Promise<QualityCheckTypeDto[]>;

  createCheckType(input: {
    code: string;
    name: string;
    description?: string;
    countryId?: string | null;
    requiredForVerification?: boolean;
  }): Promise<QualityCheckTypeDto>;

  recordQualityCheck(
    params: RecordQualityCheckParams,
  ): Promise<ResourceQualityCheckDto>;

  getResourceQuality(
    resourceId: string,
    options?: { versionId?: string },
  ): Promise<ResourceQualityDetailDto>;

  verifyResourceVersion(
    params: VerifyResourceVersionParams,
  ): Promise<ResourceVerificationDto>;

  revokeResourceVerification(
    params: RevokeResourceVerificationParams,
  ): Promise<ResourceVerificationDto>;

  isResourceVersionVerified(versionId: string): Promise<boolean>;

  getActiveVerificationForVersion(
    versionId: string,
  ): Promise<ResourceVerificationDto | null>;
}

// ============================================================================
// Service Implementation
// ============================================================================

export class DefaultQualityGovernanceService implements QualityGovernanceService {
  constructor(
    private readonly dbInstance: NodePgDatabase<typeof schemas> = defaultDb,
  ) {}

  /**
   * Technical Correction E — Deterministic Country & Global Criteria Resolution
   * If countryId is supplied:
   * 1. Fetches country-specific criteria for countryId
   * 2. Fetches global criteria (countryId IS NULL)
   * 3. Merges them deterministically: country-specific criteria override global criteria sharing the same code.
   */
  async listCheckTypes(options?: {
    countryId?: string | null;
    includeInactive?: boolean;
  }): Promise<QualityCheckTypeDto[]> {
    const { countryId, includeInactive } = options || {};

    const conditions = [];

    if (!includeInactive) {
      conditions.push(eq(qualityCheckTypes.status, 'ACTIVE'));
    }

    const allTypes = await this.dbInstance
      .select()
      .from(qualityCheckTypes)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(qualityCheckTypes.code);

    if (!countryId) {
      // Global criteria only
      return allTypes
        .filter((t) => t.countryId === null)
        .map((t) => this.mapCheckType(t));
    }

    // Country-specific evaluation: country override inheritance
    const countrySpecificMap = new Map<string, typeof allTypes[0]>();
    const globalMap = new Map<string, typeof allTypes[0]>();

    for (const t of allTypes) {
      if (t.countryId === countryId) {
        countrySpecificMap.set(t.code, t);
      } else if (t.countryId === null) {
        globalMap.set(t.code, t);
      }
    }

    // Merge: start with globals, apply country-specific overrides, then add any new country-specific criteria
    const mergedMap = new Map<string, typeof allTypes[0]>();
    for (const [code, globalItem] of globalMap) {
      if (countrySpecificMap.has(code)) {
        mergedMap.set(code, countrySpecificMap.get(code)!);
      } else {
        mergedMap.set(code, globalItem);
      }
    }
    for (const [code, countryItem] of countrySpecificMap) {
      if (!mergedMap.has(code)) {
        mergedMap.set(code, countryItem);
      }
    }

    return Array.from(mergedMap.values()).map((t) => this.mapCheckType(t));
  }

  async createCheckType(input: {
    code: string;
    name: string;
    description?: string;
    countryId?: string | null;
    requiredForVerification?: boolean;
  }): Promise<QualityCheckTypeDto> {
    const code = input.code.trim().toUpperCase();
    if (!code || !/^[A-Z0-9_]+$/.test(code)) {
      throw new QualityGovernanceError(
        'INVALID_CODE_FORMAT',
        'Check type code must be alphanumeric with underscores (e.g. CURRICULUM_ALIGNMENT).',
        400,
      );
    }

    // Check duplicate
    const [existing] = await this.dbInstance
      .select()
      .from(qualityCheckTypes)
      .where(
        input.countryId
          ? and(
              eq(qualityCheckTypes.code, code),
              eq(qualityCheckTypes.countryId, input.countryId),
            )
          : and(
              eq(qualityCheckTypes.code, code),
              isNull(qualityCheckTypes.countryId),
            ),
      )
      .limit(1);

    if (existing) {
      throw new QualityGovernanceError(
        'CHECK_TYPE_DUPLICATE_CODE',
        `A check type with code '${code}' already exists for this scope.`,
        409,
      );
    }

    const [created] = await this.dbInstance
      .insert(qualityCheckTypes)
      .values({
        code,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        countryId: input.countryId || null,
        requiredForVerification: input.requiredForVerification ?? true,
        status: 'ACTIVE',
      })
      .returning();

    return this.mapCheckType(created);
  }

  /**
   * Technical Correction B — Append-Only Quality Evaluations
   * Records a reviewer evaluation without overwriting previous audit history.
   */
  async recordQualityCheck(
    params: RecordQualityCheckParams,
  ): Promise<ResourceQualityCheckDto> {
    const { resourceId, versionId, checkTypeCode, status, notes, actorUserId } =
      params;

    // 1. Verify resource exists
    const [resource] = await this.dbInstance
      .select()
      .from(resources)
      .where(eq(resources.id, resourceId))
      .limit(1);

    if (!resource) {
      throw new QualityGovernanceError(
        'RESOURCE_NOT_FOUND',
        `Resource with id '${resourceId}' was not found.`,
        404,
      );
    }

    // 2. Verify version exists and belongs to resource (Technical Correction D)
    const [version] = await this.dbInstance
      .select()
      .from(resourceVersions)
      .where(eq(resourceVersions.id, versionId))
      .limit(1);

    if (!version) {
      throw new QualityGovernanceError(
        'RESOURCE_VERSION_NOT_FOUND',
        `Resource version with id '${versionId}' was not found.`,
        404,
      );
    }

    if (version.resourceId !== resourceId) {
      throw new QualityGovernanceError(
        'RESOURCE_VERSION_MISMATCH',
        `Resource version '${versionId}' does not belong to resource '${resourceId}'.`,
        400,
      );
    }

    // 3. Resolve check type matching code (using country inheritance)
    const applicableTypes = await this.listCheckTypes({
      countryId: resource.countryId,
      includeInactive: false,
    });
    const checkType = applicableTypes.find(
      (t) => t.code === checkTypeCode.toUpperCase(),
    );

    if (!checkType) {
      throw new QualityGovernanceError(
        'CHECK_TYPE_NOT_FOUND',
        `Quality check type with code '${checkTypeCode}' is not recognized or not active for this resource context.`,
        404,
      );
    }

    // 4. Verify actor user exists
    const [actor] = await this.dbInstance
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, actorUserId))
      .limit(1);

    if (!actor) {
      throw new QualityGovernanceError(
        'ACTOR_NOT_FOUND',
        `Reviewer user with id '${actorUserId}' not found.`,
        404,
      );
    }

    // 5. Append evaluation to ledger (immutable record)
    const [inserted] = await this.dbInstance
      .insert(resourceQualityChecks)
      .values({
        resourceId,
        resourceVersionId: versionId,
        checkTypeId: checkType.id,
        status,
        notes: notes?.trim() || null,
        checkedBy: actorUserId,
        checkedAt: new Date(),
      })
      .returning();

    return {
      id: inserted.id,
      resourceId: inserted.resourceId,
      resourceVersionId: inserted.resourceVersionId,
      checkTypeId: inserted.checkTypeId,
      checkTypeCode: checkType.code,
      checkTypeName: checkType.name,
      status: inserted.status as QualityCheckStatus,
      required: checkType.requiredForVerification,
      notes: inserted.notes,
      checkedBy: inserted.checkedBy,
      checkedAt: inserted.checkedAt.toISOString(),
      createdAt: inserted.createdAt.toISOString(),
    };
  }

  /**
   * Technical Correction C — Version-Specific Verification Workflow
   * Verifies the exact version being assessed after all mandatory criteria pass.
   */
  async verifyResourceVersion(
    params: VerifyResourceVersionParams,
  ): Promise<ResourceVerificationDto> {
    const { resourceId, versionId, notes, actorUserId } = params;

    // 1. Verify resource and version
    const [resource] = await this.dbInstance
      .select()
      .from(resources)
      .where(eq(resources.id, resourceId))
      .limit(1);

    if (!resource) {
      throw new QualityGovernanceError(
        'RESOURCE_NOT_FOUND',
        `Resource with id '${resourceId}' was not found.`,
        404,
      );
    }

    const [version] = await this.dbInstance
      .select()
      .from(resourceVersions)
      .where(eq(resourceVersions.id, versionId))
      .limit(1);

    if (!version) {
      throw new QualityGovernanceError(
        'RESOURCE_VERSION_NOT_FOUND',
        `Resource version with id '${versionId}' was not found.`,
        404,
      );
    }

    if (version.resourceId !== resourceId) {
      throw new QualityGovernanceError(
        'RESOURCE_VERSION_MISMATCH',
        `Resource version '${versionId}' does not belong to resource '${resourceId}'.`,
        400,
      );
    }

    // 2. Lifecycle state compatibility (Correction C):
    // Only versions in IN_REVIEW, APPROVED, or PUBLISHED can be verified
    const allowableStatuses = ['IN_REVIEW', 'APPROVED', 'PUBLISHED'];
    if (!allowableStatuses.includes(version.status)) {
      throw new QualityGovernanceError(
        'INVALID_LIFECYCLE_STATE',
        `Cannot verify version with status '${version.status}'. Version must be in IN_REVIEW, APPROVED, or PUBLISHED status.`,
        400,
      );
    }

    // 3. Prevent duplicate active verification on the same version
    const [existingActive] = await this.dbInstance
      .select()
      .from(resourceVerifications)
      .where(
        and(
          eq(resourceVerifications.resourceVersionId, versionId),
          eq(resourceVerifications.verificationStatus, 'VERIFIED'),
        ),
      )
      .limit(1);

    if (existingActive) {
      throw new QualityGovernanceError(
        'ALREADY_VERIFIED',
        `Resource version '${versionId}' is already actively verified.`,
        409,
      );
    }

    // 4. Resolve applicable rubric for this resource's country
    const applicableCriteria = await this.listCheckTypes({
      countryId: resource.countryId,
      includeInactive: false,
    });

    const mandatoryCriteria = applicableCriteria.filter(
      (c) => c.requiredForVerification,
    );

    // 5. Check all evaluations for this version
    const allChecks = await this.dbInstance
      .select()
      .from(resourceQualityChecks)
      .where(eq(resourceQualityChecks.resourceVersionId, versionId))
      .orderBy(desc(resourceQualityChecks.checkedAt), desc(resourceQualityChecks.createdAt));

    // Determine latest evaluation per criterion
    const latestEvaluationsByTypeId = new Map<string, typeof allChecks[0]>();
    for (const check of allChecks) {
      if (!latestEvaluationsByTypeId.has(check.checkTypeId)) {
        latestEvaluationsByTypeId.set(check.checkTypeId, check);
      }
    }

    // Verify all mandatory criteria have PASSED as their latest result
    const failingOrMissingCriteria: {
      code: string;
      name: string;
      reason: string;
    }[] = [];

    for (const criterion of mandatoryCriteria) {
      const evaluation = latestEvaluationsByTypeId.get(criterion.id);
      if (!evaluation) {
        failingOrMissingCriteria.push({
          code: criterion.code,
          name: criterion.name,
          reason: 'No evaluation recorded',
        });
      } else if (evaluation.status !== 'PASSED') {
        failingOrMissingCriteria.push({
          code: criterion.code,
          name: criterion.name,
          reason: `Current status is ${evaluation.status}`,
        });
      }
    }

    if (failingOrMissingCriteria.length > 0) {
      throw new QualityGovernanceError(
        'VERIFICATION_REQUIREMENTS_NOT_MET',
        `Resource version cannot be verified. The following mandatory criteria have not passed: ${failingOrMissingCriteria.map((c) => `${c.name} (${c.reason})`).join(', ')}.`,
        422,
        { missingOrFailing: failingOrMissingCriteria },
      );
    }

    // 6. Record active verification
    const [verification] = await this.dbInstance
      .insert(resourceVerifications)
      .values({
        resourceId,
        resourceVersionId: versionId,
        verificationStatus: 'VERIFIED',
        reason: notes?.trim() || 'Verified all required quality criteria.',
        verifiedBy: actorUserId,
        verifiedAt: new Date(),
      })
      .returning();

    return this.mapVerification(verification);
  }

  /**
   * Technical Correction D — Accountable Revocation Workflow
   * Revokes active verification with mandatory non-empty reason and actor tracking.
   */
  async revokeResourceVerification(
    params: RevokeResourceVerificationParams,
  ): Promise<ResourceVerificationDto> {
    const { resourceId, versionId, reason, actorUserId } = params;

    if (!reason || reason.trim().length === 0) {
      throw new QualityGovernanceError(
        'REASON_REQUIRED',
        'A non-empty revocation reason is required to withdraw quality verification.',
        400,
      );
    }

    if (!actorUserId) {
      throw new QualityGovernanceError(
        'ACTOR_REQUIRED',
        'An accountable actor user id is required for revocation.',
        400,
      );
    }

    // Find active verification
    const conditions = [
      eq(resourceVerifications.resourceId, resourceId),
      eq(resourceVerifications.verificationStatus, 'VERIFIED'),
    ];
    if (versionId) {
      conditions.push(eq(resourceVerifications.resourceVersionId, versionId));
    }

    const [activeVerification] = await this.dbInstance
      .select()
      .from(resourceVerifications)
      .where(and(...conditions))
      .orderBy(desc(resourceVerifications.verifiedAt))
      .limit(1);

    if (!activeVerification) {
      throw new QualityGovernanceError(
        'VERIFICATION_NOT_FOUND',
        `No active verification found for resource '${resourceId}'${versionId ? ` and version '${versionId}'` : ''}.`,
        404,
      );
    }

    // Atomically transition verification record to REVOKED
    const [revoked] = await this.dbInstance
      .update(resourceVerifications)
      .set({
        verificationStatus: 'REVOKED',
        reason: reason.trim(),
        revokedBy: actorUserId,
        revokedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(resourceVerifications.id, activeVerification.id))
      .returning();

    return this.mapVerification(revoked);
  }

  async getResourceQuality(
    resourceId: string,
    options?: { versionId?: string },
  ): Promise<ResourceQualityDetailDto> {
    const [resource] = await this.dbInstance
      .select()
      .from(resources)
      .where(eq(resources.id, resourceId))
      .limit(1);

    if (!resource) {
      throw new QualityGovernanceError(
        'RESOURCE_NOT_FOUND',
        `Resource with id '${resourceId}' was not found.`,
        404,
      );
    }

    // Determine target version: explicit or latest published / candidate version
    let targetVersionId = options?.versionId || null;
    if (!targetVersionId) {
      const [latestVer] = await this.dbInstance
        .select({ id: resourceVersions.id, status: resourceVersions.status })
        .from(resourceVersions)
        .where(eq(resourceVersions.resourceId, resourceId))
        .orderBy(desc(resourceVersions.versionNumber))
        .limit(1);
      targetVersionId = latestVer ? latestVer.id : null;
    }

    // Active verification
    const [activeVer] = await this.dbInstance
      .select()
      .from(resourceVerifications)
      .where(
        targetVersionId
          ? and(
              eq(resourceVerifications.resourceVersionId, targetVersionId),
              eq(resourceVerifications.verificationStatus, 'VERIFIED'),
            )
          : and(
              eq(resourceVerifications.resourceId, resourceId),
              eq(resourceVerifications.verificationStatus, 'VERIFIED'),
            ),
      )
      .limit(1);

    // All verifications history
    const allVerifications = await this.dbInstance
      .select()
      .from(resourceVerifications)
      .where(eq(resourceVerifications.resourceId, resourceId))
      .orderBy(desc(resourceVerifications.createdAt));

    // Quality evaluations
    const allChecks = targetVersionId
      ? await this.dbInstance
          .select()
          .from(resourceQualityChecks)
          .where(eq(resourceQualityChecks.resourceVersionId, targetVersionId))
          .orderBy(desc(resourceQualityChecks.checkedAt), desc(resourceQualityChecks.createdAt))
      : [];

    // All check types for name/code resolution
    const checkTypesList = await this.listCheckTypes({
      countryId: resource.countryId,
      includeInactive: true,
    });
    const checkTypeMap = new Map<string, QualityCheckTypeDto>(
      checkTypesList.map((t) => [t.id, t]),
    );

    // Latest check per criterion
    const latestChecksMap = new Map<string, typeof allChecks[0]>();
    for (const chk of allChecks) {
      if (!latestChecksMap.has(chk.checkTypeId)) {
        latestChecksMap.set(chk.checkTypeId, chk);
      }
    }

    const currentChecks = Array.from(latestChecksMap.values()).map((chk) => {
      const typeInfo = checkTypeMap.get(chk.checkTypeId);
      return {
        id: chk.id,
        resourceId: chk.resourceId,
        resourceVersionId: chk.resourceVersionId,
        checkTypeId: chk.checkTypeId,
        checkTypeCode: typeInfo?.code || 'UNKNOWN',
        checkTypeName: typeInfo?.name || 'Unknown Check',
        status: chk.status as QualityCheckStatus,
        required: typeInfo?.requiredForVerification ?? true,
        notes: chk.notes,
        checkedBy: chk.checkedBy,
        checkedAt: chk.checkedAt.toISOString(),
        createdAt: chk.createdAt.toISOString(),
      };
    });

    const fullHistory = allChecks.map((chk) => {
      const typeInfo = checkTypeMap.get(chk.checkTypeId);
      return {
        id: chk.id,
        resourceId: chk.resourceId,
        resourceVersionId: chk.resourceVersionId,
        checkTypeId: chk.checkTypeId,
        checkTypeCode: typeInfo?.code || 'UNKNOWN',
        checkTypeName: typeInfo?.name || 'Unknown Check',
        status: chk.status as QualityCheckStatus,
        required: typeInfo?.requiredForVerification ?? true,
        notes: chk.notes,
        checkedBy: chk.checkedBy,
        checkedAt: chk.checkedAt.toISOString(),
        createdAt: chk.createdAt.toISOString(),
      };
    });

    return {
      resourceId,
      versionId: targetVersionId,
      isVerified: !!activeVer,
      qualityLabel: resource.qualityLabel,
      activeVerification: activeVer ? this.mapVerification(activeVer) : null,
      checks: currentChecks,
      evaluationHistory: fullHistory,
      verificationHistory: allVerifications.map((v) => this.mapVerification(v)),
    };
  }

  async isResourceVersionVerified(versionId: string): Promise<boolean> {
    const [row] = await this.dbInstance
      .select({ id: resourceVerifications.id })
      .from(resourceVerifications)
      .where(
        and(
          eq(resourceVerifications.resourceVersionId, versionId),
          eq(resourceVerifications.verificationStatus, 'VERIFIED'),
        ),
      )
      .limit(1);

    return !!row;
  }

  async getActiveVerificationForVersion(
    versionId: string,
  ): Promise<ResourceVerificationDto | null> {
    const [row] = await this.dbInstance
      .select()
      .from(resourceVerifications)
      .where(
        and(
          eq(resourceVerifications.resourceVersionId, versionId),
          eq(resourceVerifications.verificationStatus, 'VERIFIED'),
        ),
      )
      .limit(1);

    return row ? this.mapVerification(row) : null;
  }

  private mapCheckType(t: typeof qualityCheckTypes.$inferSelect): QualityCheckTypeDto {
    return {
      id: t.id,
      code: t.code,
      name: t.name,
      description: t.description,
      countryId: t.countryId,
      requiredForVerification: t.requiredForVerification,
      status: t.status as 'ACTIVE' | 'INACTIVE',
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  private mapVerification(
    v: typeof resourceVerifications.$inferSelect,
  ): ResourceVerificationDto {
    return {
      id: v.id,
      resourceId: v.resourceId,
      resourceVersionId: v.resourceVersionId,
      verificationStatus: v.verificationStatus as VerificationStatus,
      reason: v.reason,
      verifiedBy: v.verifiedBy,
      verifiedAt: v.verifiedAt.toISOString(),
      revokedBy: v.revokedBy,
      revokedAt: v.revokedAt ? v.revokedAt.toISOString() : null,
      createdAt: v.createdAt.toISOString(),
      updatedAt: v.updatedAt.toISOString(),
    };
  }
}

export const defaultQualityGovernanceService =
  new DefaultQualityGovernanceService();
