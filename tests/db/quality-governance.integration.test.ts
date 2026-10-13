import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { withDbRetry } from '../helpers/db-retry.js';
import {
  countries,
  resourceTypes,
  resources,
  resourceVersions,
  qualityCheckTypes,
  resourceQualityChecks,
  resourceVerifications,
  users,
} from '../../src/db/schemas.js';

describe('Quality Governance Database Integration Tests', () => {
  let countryId: string;
  let resourceTypeId: string;
  let testUserId: string;
  let testResourceId: string;
  let testVersion1Id: string;
  let testVersion2Id: string;
  let otherResourceId: string;
  let otherVersionId: string;
  let checkTypeId: string;

  beforeAll(async () => {
    // 1. Resolve active country
    const [c] = await withDbRetry(async () =>
      db.select().from(countries).where(eq(countries.status, 'ACTIVE')).limit(1),
    );
    countryId = c.id;

    // 2. Resolve resource type
    const [rt] = await withDbRetry(async () =>
      db.select().from(resourceTypes).limit(1),
    );
    resourceTypeId = rt.id;

    // 3. Create test user
    const [u] = await withDbRetry(async () =>
      db
        .insert(users)
        .values({
          email: `qg_db_tester_${Date.now()}@example.com`,
          displayName: 'QG DB Tester',
        })
        .returning(),
    );
    testUserId = u.id;

    // 4. Create test resource
    const [r] = await withDbRetry(async () =>
      db
        .insert(resources)
        .values({
          countryId,
          resourceTypeId,
          title: `QG DB Resource ${Date.now()}`,
          slug: `qg-db-resource-${Date.now()}`,
          status: 'PUBLISHED',
          qualityLabel: 'STANDARD',
        })
        .returning(),
    );
    testResourceId = r.id;

    // 5. Create version 1 and 2
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
    testVersion1Id = v1.id;

    const [v2] = await withDbRetry(async () =>
      db
        .insert(resourceVersions)
        .values({
          resourceId: testResourceId,
          versionNumber: 2,
          versionLabel: 'v2.0',
          title: 'Version 2',
          status: 'DRAFT',
        })
        .returning(),
    );
    testVersion2Id = v2.id;

    // 6. Create other resource for mismatch checks
    const [rOther] = await withDbRetry(async () =>
      db
        .insert(resources)
        .values({
          countryId,
          resourceTypeId,
          title: `Other Resource ${Date.now()}`,
          slug: `other-res-${Date.now()}`,
          status: 'PUBLISHED',
        })
        .returning(),
    );
    otherResourceId = rOther.id;

    const [vOther] = await withDbRetry(async () =>
      db
        .insert(resourceVersions)
        .values({
          resourceId: otherResourceId,
          versionNumber: 1,
          versionLabel: 'v1.0',
          title: 'Other Version 1',
          status: 'PUBLISHED',
          publishedAt: new Date(),
        })
        .returning(),
    );
    otherVersionId = vOther.id;

    // 7. Resolve an active check type
    const [ct] = await withDbRetry(async () =>
      db
        .select()
        .from(qualityCheckTypes)
        .where(eq(qualityCheckTypes.code, 'CURRICULUM_ALIGNMENT'))
        .limit(1),
    );
    checkTypeId = ct.id;
  }, 120000);

  it('rejects quality check with mismatched resource and version via trigger defense (Correction D)', async () => {
    // Attempt inserting check pointing to testResourceId, but otherVersionId (belongs to otherResourceId)
    await expect(
      withDbRetry(async () =>
        db.insert(resourceQualityChecks).values({
          resourceId: testResourceId,
          resourceVersionId: otherVersionId, // mismatch!
          checkTypeId,
          status: 'PASSED',
          checkedBy: testUserId,
        }),
      ),
    ).rejects.toThrow();
  });

  it('rejects resource verification with mismatched resource and version via trigger defense (Correction D)', async () => {
    // Attempt inserting verification pointing to testResourceId, but otherVersionId
    await expect(
      withDbRetry(async () =>
        db.insert(resourceVerifications).values({
          resourceId: testResourceId,
          resourceVersionId: otherVersionId, // mismatch!
          verificationStatus: 'VERIFIED',
          verifiedBy: testUserId,
        }),
      ),
    ).rejects.toThrow();
  });

  it('enforces immutable evaluation history: blocks UPDATE and DELETE on quality checks (Correction B)', async () => {
    // Insert valid check
    const [inserted] = await withDbRetry(async () =>
      db
        .insert(resourceQualityChecks)
        .values({
          resourceId: testResourceId,
          resourceVersionId: testVersion1Id,
          checkTypeId,
          status: 'PASSED',
          checkedBy: testUserId,
        })
        .returning(),
    );

    // Attempt direct UPDATE -> trigger must reject
    await expect(
      withDbRetry(async () =>
        db
          .update(resourceQualityChecks)
          .set({ status: 'FAILED' })
          .where(eq(resourceQualityChecks.id, inserted.id)),
      ),
    ).rejects.toThrow();

    // Attempt direct DELETE -> trigger must reject
    await expect(
      withDbRetry(async () =>
        db
          .delete(resourceQualityChecks)
          .where(eq(resourceQualityChecks.id, inserted.id)),
      ),
    ).rejects.toThrow();
  });

  it('enforces partial unique index: prevents duplicate active verifications for same resource version (Correction C)', async () => {
    // First active verification succeeds
    await withDbRetry(async () =>
      db.insert(resourceVerifications).values({
        resourceId: testResourceId,
        resourceVersionId: testVersion1Id,
        verificationStatus: 'VERIFIED',
        verifiedBy: testUserId,
      }),
    );

    // Second active verification for the same version violates partial unique index
    await expect(
      withDbRetry(async () =>
        db.insert(resourceVerifications).values({
          resourceId: testResourceId,
          resourceVersionId: testVersion1Id,
          verificationStatus: 'VERIFIED',
          verifiedBy: testUserId,
        }),
      ),
    ).rejects.toThrow();
  });

  it('enforces revocation check constraint: mandates reason, actor, and timestamp when REVOKED', async () => {
    // Inserting REVOKED without reason or revoked_by violates chk_res_verifications_revocation
    await expect(
      withDbRetry(async () =>
        db.insert(resourceVerifications).values({
          resourceId: testResourceId,
          resourceVersionId: testVersion2Id,
          verificationStatus: 'REVOKED',
          verifiedBy: testUserId,
          // Missing revokedBy, revokedAt, and reason!
        }),
      ),
    ).rejects.toThrow();
  });

  it('enforces ON DELETE RESTRICT preventing cascading deletion of quality history (Correction D)', async () => {
    // Attempt deleting resource referenced by quality checks / verifications
    await expect(
      withDbRetry(async () =>
        db.delete(resources).where(eq(resources.id, testResourceId)),
      ),
    ).rejects.toThrow();
  });
});
