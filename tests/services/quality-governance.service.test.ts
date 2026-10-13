import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { withDbRetry } from '../helpers/db-retry.js';
import {
  countries,
  resourceTypes,
  resources,
  resourceVersions,
  users,
} from '../../src/db/schemas.js';
import {
  defaultQualityGovernanceService,
  QualityGovernanceError,
} from '../../src/services/quality-governance.service.js';
import {
  defaultResourceService,
  DirectVerifiedAssignmentError,
} from '../../src/services/resource.service.js';

describe('Quality Governance Service Integration Tests', () => {
  let countryId: string;
  let otherCountryId: string;
  let resourceTypeId: string;
  let reviewerUserId: string;
  let managerUserId: string;
  let testResourceId: string;
  let version1Id: string;
  let version2Id: string;

  beforeAll(async () => {
    // 1. Resolve countries
    const countryRows = await withDbRetry(async () =>
      db.select().from(countries).where(eq(countries.status, 'ACTIVE')).limit(2),
    );
    countryId = countryRows[0].id;
    otherCountryId = countryRows[1] ? countryRows[1].id : countryRows[0].id;

    // 2. Resolve resource type
    const [rt] = await withDbRetry(async () =>
      db.select().from(resourceTypes).limit(1),
    );
    resourceTypeId = rt.id;

    // 3. Create reviewer and manager users
    const [rev] = await withDbRetry(async () =>
      db
        .insert(users)
        .values({
          email: `qg_svc_reviewer_${Date.now()}@example.com`,
          displayName: 'QG Service Reviewer',
        })
        .returning(),
    );
    reviewerUserId = rev.id;

    const [mgr] = await withDbRetry(async () =>
      db
        .insert(users)
        .values({
          email: `qg_svc_mgr_${Date.now()}@example.com`,
          displayName: 'QG Service Manager',
        })
        .returning(),
    );
    managerUserId = mgr.id;

    // 4. Create resource and versions
    const [r] = await withDbRetry(async () =>
      db
        .insert(resources)
        .values({
          countryId,
          resourceTypeId,
          title: `QG Svc Resource ${Date.now()}`,
          slug: `qg-svc-res-${Date.now()}`,
          status: 'PUBLISHED',
          qualityLabel: 'STANDARD',
        })
        .returning(),
    );
    testResourceId = r.id;

    const [v1] = await withDbRetry(async () =>
      db
        .insert(resourceVersions)
        .values({
          resourceId: testResourceId,
          versionNumber: 1,
          versionLabel: 'v1.0',
          title: 'Version 1',
          status: 'PUBLISHED',
          publishedAt: new Date(),
        })
        .returning(),
    );
    version1Id = v1.id;

    const [v2] = await withDbRetry(async () =>
      db
        .insert(resourceVersions)
        .values({
          resourceId: testResourceId,
          versionNumber: 2,
          versionLabel: 'v2.0',
          title: 'Version 2',
          status: 'IN_REVIEW',
        })
        .returning(),
    );
    version2Id = v2.id;
  }, 120000);

  it('1. lists canonical check types and supports country-specific criteria override (Correction E)', async () => {
    const globalTypes = await defaultQualityGovernanceService.listCheckTypes();
    expect(globalTypes.length).toBeGreaterThanOrEqual(7);

    const curriculumCriterion = globalTypes.find(
      (c) => c.code === 'CURRICULUM_ALIGNMENT',
    );
    expect(curriculumCriterion).toBeDefined();
    expect(curriculumCriterion?.requiredForVerification).toBe(true);

    // Create a country-specific override criterion for otherCountryId
    const countrySpecificOverride =
      await defaultQualityGovernanceService.createCheckType({
        code: `CUSTOM_RUBRIC_${Date.now()}`,
        name: 'Custom Country Rubric',
        description: 'Country specific alignment',
        countryId: otherCountryId,
        requiredForVerification: false,
      });

    const countryTypes = await defaultQualityGovernanceService.listCheckTypes({
      countryId: otherCountryId,
    });
    const foundOverride = countryTypes.find(
      (c) => c.id === countrySpecificOverride.id,
    );
    expect(foundOverride).toBeDefined();
  });

  it('2. preserves evaluation history when recording multiple checks on same criterion (Correction B)', async () => {
    // 1st evaluation: FLAGGED with note
    const check1 = await defaultQualityGovernanceService.recordQualityCheck({
      resourceId: testResourceId,
      versionId: version1Id,
      checkTypeCode: 'FACTUAL_ACCURACY',
      status: 'FLAGGED',
      notes: 'Initial check: question 4 formula requires revision',
      actorUserId: reviewerUserId,
    });
    expect(check1.status).toBe('FLAGGED');

    // 2nd evaluation: PASSED with note
    const check2 = await defaultQualityGovernanceService.recordQualityCheck({
      resourceId: testResourceId,
      versionId: version1Id,
      checkTypeCode: 'FACTUAL_ACCURACY',
      status: 'PASSED',
      notes: 'Author clarified question 4 formula; accurate',
      actorUserId: reviewerUserId,
    });
    expect(check2.status).toBe('PASSED');

    // Both evaluations must be preserved in history, but latest is PASSED
    const quality = await defaultQualityGovernanceService.getResourceQuality(
      testResourceId,
      { versionId: version1Id },
    );

    const factualHistory = quality.evaluationHistory.filter(
      (e) => e.checkTypeCode === 'FACTUAL_ACCURACY',
    );
    expect(factualHistory.length).toBe(2);

    const currentFactual = quality.checks.find(
      (c) => c.checkTypeCode === 'FACTUAL_ACCURACY',
    );
    expect(currentFactual?.status).toBe('PASSED');
    expect(currentFactual?.notes).toBe(
      'Author clarified question 4 formula; accurate',
    );
  });

  it('3. blocks verification when mandatory criteria are missing or not passed (Approved Rubric)', async () => {
    // version2 has 0 checks recorded. Attempting verification must fail with 422
    await expect(
      defaultQualityGovernanceService.verifyResourceVersion({
        resourceId: testResourceId,
        versionId: version2Id,
        actorUserId: managerUserId,
      }),
    ).rejects.toThrowError(QualityGovernanceError);

    try {
      await defaultQualityGovernanceService.verifyResourceVersion({
        resourceId: testResourceId,
        versionId: version2Id,
        actorUserId: managerUserId,
      });
    } catch (err: any) {
      expect(err.statusCode).toBe(422);
      expect(err.code).toBe('VERIFICATION_REQUIREMENTS_NOT_MET');
    }
  });

  it('4. verifies version when all mandatory criteria pass, without mutating published version (Correction A, B, C)', async () => {
    // Record PASSED for all 5 mandatory criteria on version1
    const mandatoryCodes = [
      'CURRICULUM_ALIGNMENT',
      'FACTUAL_ACCURACY',
      'COMPLETENESS',
      'FILE_INTEGRITY_READABILITY',
      'PROVENANCE_RIGHTS',
    ];

    for (const code of mandatoryCodes) {
      await defaultQualityGovernanceService.recordQualityCheck({
        resourceId: testResourceId,
        versionId: version1Id,
        checkTypeCode: code,
        status: 'PASSED',
        notes: `Validated ${code}`,
        actorUserId: reviewerUserId,
      });
    }

    // Optional criteria GRADE_APPROPRIATENESS and EXAM_RELEVANCE are NOT evaluated;
    // verification must succeed because all mandatory criteria passed!
    const verification =
      await defaultQualityGovernanceService.verifyResourceVersion({
        resourceId: testResourceId,
        versionId: version1Id,
        notes: 'Resource meets all pedagogical standards',
        actorUserId: managerUserId,
      });

    expect(verification.verificationStatus).toBe('VERIFIED');
    expect(verification.resourceVersionId).toBe(version1Id);
    expect(verification.verifiedBy).toBe(managerUserId);

    // Verification check for version1
    const isV1Verified =
      await defaultQualityGovernanceService.isResourceVersionVerified(
        version1Id,
      );
    expect(isV1Verified).toBe(true);

    // Version 2 MUST remain unverified (Correction C: older version does NOT certify newer version)
    const isV2Verified =
      await defaultQualityGovernanceService.isResourceVersionVerified(
        version2Id,
      );
    expect(isV2Verified).toBe(false);

    // Published version in resource_versions table was NOT mutated (trigger preserved)
    const [v1Row] = await withDbRetry(async () =>
      db
        .select()
        .from(resourceVersions)
        .where(eq(resourceVersions.id, version1Id)),
    );
    expect(v1Row.status).toBe('PUBLISHED');
  });

  it('5. revokes verification with mandatory reason and accountable actor, then permits reverification (Correction D, C)', async () => {
    // Revocation without reason is rejected
    await expect(
      defaultQualityGovernanceService.revokeResourceVerification({
        resourceId: testResourceId,
        versionId: version1Id,
        reason: '   ',
        actorUserId: managerUserId,
      }),
    ).rejects.toThrowError(QualityGovernanceError);

    // Valid revocation
    const revoked =
      await defaultQualityGovernanceService.revokeResourceVerification({
        resourceId: testResourceId,
        versionId: version1Id,
        reason: 'Curriculum syllabus updated for academic year 2026',
        actorUserId: managerUserId,
      });

    expect(revoked.verificationStatus).toBe('REVOKED');
    expect(revoked.revokedBy).toBe(managerUserId);
    expect(revoked.reason).toBe(
      'Curriculum syllabus updated for academic year 2026',
    );

    // isResourceVersionVerified is now false
    const isV1Verified =
      await defaultQualityGovernanceService.isResourceVersionVerified(
        version1Id,
      );
    expect(isV1Verified).toBe(false);

    // Reverification: can reverify after review
    const reverified =
      await defaultQualityGovernanceService.verifyResourceVersion({
        resourceId: testResourceId,
        versionId: version1Id,
        notes: 'Re-evaluated against revised 2026 curriculum standards',
        actorUserId: managerUserId,
      });

    expect(reverified.verificationStatus).toBe('VERIFIED');
    const isV1VerifiedAgain =
      await defaultQualityGovernanceService.isResourceVersionVerified(
        version1Id,
      );
    expect(isV1VerifiedAgain).toBe(true);
  });

  it('6. rejects direct VERIFIED assignment in resource creation and update APIs (Correction F)', async () => {
    // Attempting to create resource version with qualityLabel = 'VERIFIED'
    await expect(
      defaultResourceService.createResourceVersion({
        resourceId: testResourceId,
        title: 'Bypass Attempt Version',
        qualityLabel: 'VERIFIED' as any,
      }),
    ).rejects.toThrowError(DirectVerifiedAssignmentError);

    // Attempting to update existing version with qualityLabel = 'VERIFIED'
    await expect(
      defaultResourceService.updateResourceVersion(version2Id, {
        qualityLabel: 'VERIFIED' as any,
      }),
    ).rejects.toThrowError(DirectVerifiedAssignmentError);
  });
});
