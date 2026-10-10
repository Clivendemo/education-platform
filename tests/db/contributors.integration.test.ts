import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db, closeDatabase } from '../../src/db/index.js';
import {
  users,
  countries,
  resourceTypes,
  resources,
  contributors,
  contributorApplications,
  contributorSubmissions,
} from '../../src/db/schemas.js';
import { DefaultAuthService } from '../../src/services/auth.service.js';
import { DefaultContributorService } from '../../src/services/contributor.service.js';
import { DefaultRbacService } from '../../src/services/rbac.service.js';
import { seedRolesAndPermissions } from '../../src/db/seeds/roles-permissions.js';
import { withDbRetry } from '../helpers/db-retry.js';

const isDbAvailable = Boolean(process.env.DATABASE_TEST_URL || process.env.DATABASE_URL);

describe.skipIf(!isDbAvailable)('Contributor System Database & Schema Integration Tests', () => {
  const authService = new DefaultAuthService(db);
  const rbacService = new DefaultRbacService(db);
  const contributorService = new DefaultContributorService(db, rbacService);

  const createdUserIds: string[] = [];
  const cleanupResourceIds: string[] = [];
  const createdCountryIds: string[] = [];

  let testCountryId: string;
  let testTypeId: string;

  beforeAll(async () => {
    await withDbRetry(() => seedRolesAndPermissions(db));

    const [existingCountry] = await withDbRetry(() =>
      db.select().from(countries).where(eq(countries.status, 'ACTIVE')).limit(1),
    );
    if (existingCountry) {
      testCountryId = existingCountry.id;
    } else {
      const [newCountry] = await withDbRetry(() =>
        db
          .insert(countries)
          .values({
            name: 'Contributor DB Country',
            isoCode: 'CDB',
            urlPrefix: 'cdb',
            currencyCode: 'KES',
            status: 'ACTIVE',
          })
          .returning(),
      );
      testCountryId = newCountry.id;
      createdCountryIds.push(newCountry.id);
    }

    const [existingType] = await withDbRetry(() =>
      db.select().from(resourceTypes).where(eq(resourceTypes.status, 'ACTIVE')).limit(1),
    );
    if (existingType) {
      testTypeId = existingType.id;
    } else {
      const [newType] = await withDbRetry(() =>
        db
          .insert(resourceTypes)
          .values({
            code: `CDB_${Date.now()}`,
            name: 'Contributor DB Type',
            slug: `cdb-type-${Date.now()}`,
            pillar: 'PAST_PAPERS',
            sequenceOrder: 1,
            status: 'ACTIVE',
          })
          .returning(),
      );
      testTypeId = newType.id;
    }
  }, 60000);

  afterAll(async () => {
    try {
      if (cleanupResourceIds.length > 0) {
        await withDbRetry(() =>
          db.delete(resources).where(inArray(resources.id, cleanupResourceIds)),
        ).catch(() => {});
      }
      if (createdUserIds.length > 0) {
        const contribs = await withDbRetry(() =>
          db.select({ id: contributors.id }).from(contributors).where(inArray(contributors.userId, createdUserIds)),
        ).catch(() => []);
        const cIds = contribs.map((c) => c.id);
        if (cIds.length > 0) {
          await withDbRetry(() =>
            db.delete(contributorSubmissions).where(inArray(contributorSubmissions.contributorId, cIds)),
          ).catch(() => {});
        }
        await withDbRetry(() =>
          db.delete(contributorApplications).where(inArray(contributorApplications.userId, createdUserIds)),
        ).catch(() => {});
        await withDbRetry(() =>
          db.delete(contributors).where(inArray(contributors.userId, createdUserIds)),
        ).catch(() => {});
        await withDbRetry(() =>
          db.delete(users).where(inArray(users.id, createdUserIds)),
        ).catch(() => {});
      }
      if (createdCountryIds.length > 0) {
        await withDbRetry(() =>
          db.delete(countries).where(inArray(countries.id, createdCountryIds)),
        ).catch(() => {});
      }
    } finally {
      await closeDatabase();
    }
  }, 60000);

  describe('1. Active Application Uniqueness (Partial Unique Index)', () => {
    it('enforces that a user can only have one active (SUBMITTED/UNDER_REVIEW) application', async () => {
      const reg = await withDbRetry(() =>
        authService.register({
          email: `app-uniq-${Date.now()}@example.com`,
          password: 'Password123!',
          displayName: 'Applicant Uniq',
        }),
      );
      createdUserIds.push(reg.user.id);

      // Insert first application
      await withDbRetry(() =>
        db.insert(contributorApplications).values({
          userId: reg.user.id,
          applicationText: 'First active application',
          status: 'SUBMITTED',
        }),
      );

      // Second application while first is active should fail with 23505 unique violation
      await expect(
        withDbRetry(() =>
          db.insert(contributorApplications).values({
            userId: reg.user.id,
            applicationText: 'Concurrent second active application',
            status: 'UNDER_REVIEW',
          }),
        ),
      ).rejects.toThrow();
    });

    it('allows a subsequent application after the previous one was REJECTED', async () => {
      const reg = await withDbRetry(() =>
        authService.register({
          email: `app-retry-${Date.now()}@example.com`,
          password: 'Password123!',
          displayName: 'Applicant Retry',
        }),
      );
      createdUserIds.push(reg.user.id);

      const adminReg = await withDbRetry(() =>
        authService.register({
          email: `admin-rev-${Date.now()}@example.com`,
          password: 'Password123!',
          displayName: 'Reviewer',
        }),
      );
      createdUserIds.push(adminReg.user.id);

      // Insert first application as REJECTED
      await withDbRetry(() =>
        db.insert(contributorApplications).values({
          userId: reg.user.id,
          applicationText: 'Initial application',
          status: 'REJECTED',
          reviewNotes: 'Insufficient teaching history provided.',
          reviewedAt: new Date(),
          reviewedBy: adminReg.user.id,
        }),
      );

      // Second application should succeed because rejected apps are excluded from the partial index
      const [secondApp] = await withDbRetry(() =>
        db
          .insert(contributorApplications)
          .values({
            userId: reg.user.id,
            applicationText: 'Updated application with certification details.',
            status: 'SUBMITTED',
          })
          .returning(),
      );

      expect(secondApp.status).toBe('SUBMITTED');
    });
  });

  describe('2. Slug Generation & Collision Resolution', () => {
    it('generates unique incremental slugs for colliding display names', async () => {
      const ts = Date.now();
      const displayName = `Collision Author ${ts}`;

      const reg1 = await withDbRetry(() =>
        authService.register({
          email: `slug1-${ts}@example.com`,
          password: 'Password123!',
          displayName,
        }),
      );
      createdUserIds.push(reg1.user.id);

      const reg2 = await withDbRetry(() =>
        authService.register({
          email: `slug2-${ts}@example.com`,
          password: 'Password123!',
          displayName,
        }),
      );
      createdUserIds.push(reg2.user.id);

      // Create application 1 and approve
      const app1 = await contributorService.submitApplication(reg1.user.id, 'App 1');
      const rev1 = await contributorService.reviewApplication(reg1.user.id, app1.id, 'APPROVE');

      // Create application 2 and approve
      const app2 = await contributorService.submitApplication(reg2.user.id, 'App 2');
      const rev2 = await contributorService.reviewApplication(reg1.user.id, app2.id, 'APPROVE');

      expect(rev1.contributor?.profileSlug).toBe(`collision-author-${ts}`);
      expect(rev2.contributor?.profileSlug).toBe(`collision-author-${ts}-2`);
      expect(rev1.contributor?.profileSlug).not.toBe(rev2.contributor?.profileSlug);
    });
  });

  describe('3. Database Constraints & Invariants', () => {
    it('enforces chk_contributors_status check constraint', async () => {
      const reg = await withDbRetry(() =>
        authService.register({
          email: `chk-status-${Date.now()}@example.com`,
          password: 'Password123!',
          displayName: 'Invalid Status Test',
        }),
      );
      createdUserIds.push(reg.user.id);

      await expect(
        withDbRetry(() =>
          db.insert(contributors).values({
            userId: reg.user.id,
            displayName: 'Invalid Status',
            profileSlug: `invalid-status-${Date.now()}`,
            status: 'UNKNOWN_STATUS' as any,
          }),
        ),
      ).rejects.toThrow();
    });

    it('enforces chk_contributors_suspension requiring suspended_at when SUSPENDED', async () => {
      const reg = await withDbRetry(() =>
        authService.register({
          email: `chk-susp-${Date.now()}@example.com`,
          password: 'Password123!',
          displayName: 'Suspension Check',
        }),
      );
      createdUserIds.push(reg.user.id);

      await expect(
        withDbRetry(() =>
          db.insert(contributors).values({
            userId: reg.user.id,
            displayName: 'Suspended Contributor',
            profileSlug: `susp-no-date-${Date.now()}`,
            status: 'SUSPENDED',
            suspendedAt: null, // violates constraint
          }),
        ),
      ).rejects.toThrow();
    });

    it('enforces chk_contributor_subs_pricing check constraint (KES currency requirement)', async () => {
      const reg = await withDbRetry(() =>
        authService.register({
          email: `chk-curr-${Date.now()}@example.com`,
          password: 'Password123!',
          displayName: 'Currency Check Contributor',
        }),
      );
      createdUserIds.push(reg.user.id);

      const [c] = await withDbRetry(() =>
        db
          .insert(contributors)
          .values({
            userId: reg.user.id,
            displayName: 'Valid Contributor',
            profileSlug: `curr-check-${Date.now()}`,
            status: 'ACTIVE',
          })
          .returning(),
      );

      // Attempt to insert with USD currency code
      await expect(
        withDbRetry(() =>
          db.insert(contributorSubmissions).values({
            contributorId: c.id,
            title: 'CBC Material with USD',
            proposedPriceMinor: 5000,
            proposedCurrencyCode: 'USD',
          }),
        ),
      ).rejects.toThrow();

      // Valid KES pricing succeeds
      const [sub] = await withDbRetry(() =>
        db
          .insert(contributorSubmissions)
          .values({
            contributorId: c.id,
            title: 'CBC Material with KES',
            proposedPriceMinor: 5000,
            proposedCurrencyCode: 'KES',
          })
          .returning(),
      );
      expect(sub.proposedCurrencyCode).toBe('KES');
    });

    it('restricts user deletion when contributor profile exists', async () => {
      const reg = await withDbRetry(() =>
        authService.register({
          email: `fk-user-${Date.now()}@example.com`,
          password: 'Password123!',
          displayName: 'FK Test Contributor',
        }),
      );
      createdUserIds.push(reg.user.id);

      await withDbRetry(() =>
        db.insert(contributors).values({
          userId: reg.user.id,
          displayName: 'FK Test',
          profileSlug: `fk-test-${Date.now()}`,
          status: 'ACTIVE',
        }),
      );

      // Deleting user must fail due to FK ON DELETE RESTRICT
      await expect(
        withDbRetry(() => db.delete(users).where(eq(users.id, reg.user.id))),
      ).rejects.toThrow();
    });

    it('sets contributor_id to NULL when resource is deleted', async () => {
      const reg = await withDbRetry(() =>
        authService.register({
          email: `res-attr-${Date.now()}@example.com`,
          password: 'Password123!',
          displayName: 'Attribution Contributor',
        }),
      );
      createdUserIds.push(reg.user.id);

      const [c] = await withDbRetry(() =>
        db
          .insert(contributors)
          .values({
            userId: reg.user.id,
            displayName: 'Attributed Contributor',
            profileSlug: `res-attr-${Date.now()}`,
            status: 'ACTIVE',
          })
          .returning(),
      );

      const [res] = await withDbRetry(() =>
        db
          .insert(resources)
          .values({
            countryId: testCountryId,
            resourceTypeId: testTypeId,
            title: 'Attributed Resource',
            slug: `attributed-res-${Date.now()}`,
            status: 'DRAFT',
            contributorId: c.id,
          })
          .returning(),
      );
      cleanupResourceIds.push(res.id);

      expect(res.contributorId).toBe(c.id);

      // Link submission to this resource
      const [sub] = await withDbRetry(() =>
        db
          .insert(contributorSubmissions)
          .values({
            contributorId: c.id,
            title: 'Draft Submission with Resource Link',
            resourceId: res.id,
          })
          .returning(),
      );

      // Delete the resource
      await withDbRetry(() => db.delete(resources).where(eq(resources.id, res.id)));
      cleanupResourceIds.splice(cleanupResourceIds.indexOf(res.id), 1);

      // Verify submission's resourceId became NULL via ON DELETE SET NULL
      const [updatedSub] = await withDbRetry(() =>
        db
          .select()
          .from(contributorSubmissions)
          .where(eq(contributorSubmissions.id, sub.id))
          .limit(1),
      );
      expect(updatedSub.resourceId).toBeNull();
    });
  });
});
