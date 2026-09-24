import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, closeDatabase } from '../../src/db/index.js';
import {
  countries,
  administrativeAreaTypes,
  administrativeAreas,
  schools,
} from '../../src/db/schemas.js';
import { seedKenyaGeography } from '../../src/db/seeds/kenya-geography.js';
import { defaultSchoolService } from '../../src/services/school.service.js';

const isDbAvailable = Boolean(process.env.DATABASE_TEST_URL || process.env.DATABASE_URL);

describe.skipIf(!isDbAvailable)('Schools Database Integration Tests', () => {
  let kenyaCountryId: string;
  let nairobiAreaId: string;
  let tanzaniaAreaId: string;

  const testSchoolIds: string[] = [];

  beforeAll(async () => {
    // Ensure Kenya geography exists
    await seedKenyaGeography();

    const kenya = (
      await db.select().from(countries).where(eq(countries.isoCode, 'KE')).limit(1)
    )[0];
    kenyaCountryId = kenya.id;

    // Retrieve Nairobi county area
    const nairobi = (
      await db
        .select()
        .from(administrativeAreas)
        .where(
          sql`${administrativeAreas.countryId} = ${kenyaCountryId} AND ${administrativeAreas.slug} = 'nairobi'`,
        )
        .limit(1)
    )[0];
    nairobiAreaId = nairobi.id;

    // Setup or retrieve Tanzania and Arusha test area for cross-country testing
    const existingTz = await db
      .select()
      .from(countries)
      .where(eq(countries.isoCode, 'TZ'))
      .limit(1);

    let tzId: string;
    if (existingTz.length > 0) {
      tzId = existingTz[0].id;
    } else {
      const [newTz] = await db
        .insert(countries)
        .values({
          name: 'Tanzania',
          isoCode: 'TZ',
          urlPrefix: 'tz',
          defaultLanguageCode: 'sw',
          currencyCode: 'TZS',
          status: 'ACTIVE',
        })
        .returning();
      tzId = newTz.id;
    }

    const existingType = await db
      .select()
      .from(administrativeAreaTypes)
      .where(
        sql`${administrativeAreaTypes.countryId} = ${tzId} AND ${administrativeAreaTypes.slug} = 'region'`,
      )
      .limit(1);

    let tzTypeId: string;
    if (existingType.length > 0) {
      tzTypeId = existingType[0].id;
    } else {
      const [newType] = await db
        .insert(administrativeAreaTypes)
        .values({
          countryId: tzId,
          name: 'Region',
          slug: 'region',
          hierarchyLevel: 1,
          status: 'ACTIVE',
        })
        .returning();
      tzTypeId = newType.id;
    }

    const existingArea = await db
      .select()
      .from(administrativeAreas)
      .where(
        sql`${administrativeAreas.countryId} = ${tzId} AND ${administrativeAreas.slug} = 'arusha'`,
      )
      .limit(1);

    if (existingArea.length > 0) {
      tanzaniaAreaId = existingArea[0].id;
    } else {
      const [newArea] = await db
        .insert(administrativeAreas)
        .values({
          countryId: tzId,
          typeId: tzTypeId,
          name: 'Arusha',
          slug: 'arusha',
          status: 'ACTIVE',
        })
        .returning();
      tanzaniaAreaId = newArea.id;
    }
  });

  afterAll(async () => {
    try {
      // Clean up created test schools
      if (testSchoolIds.length > 0) {
        await db.delete(schools).where(inArray(schools.id, testSchoolIds));
      }

      // Clean up test area if needed
      if (tanzaniaAreaId) {
        await db
          .delete(administrativeAreas)
          .where(eq(administrativeAreas.id, tanzaniaAreaId))
          .catch(() => {});
      }
    } finally {
      await closeDatabase();
    }
  }, 30000);

  describe('Valid School Creation and Retrieval', () => {
    it('creates a valid school with county association and retrieves it', async () => {
      const [school] = await db
        .insert(schools)
        .values({
          name: 'Nairobi School of Excellence',
          code: 'NSE-001',
          schoolType: 'SECONDARY',
          status: 'ACTIVE',
          countryId: kenyaCountryId,
          administrativeAreaId: nairobiAreaId,
        })
        .returning();

      testSchoolIds.push(school.id);

      expect(school.id).toBeDefined();
      expect(school.name).toBe('Nairobi School of Excellence');
      expect(school.code).toBe('NSE-001');
      expect(school.schoolType).toBe('SECONDARY');
      expect(school.status).toBe('ACTIVE');
      expect(school.countryId).toBe(kenyaCountryId);
      expect(school.administrativeAreaId).toBe(nairobiAreaId);
      expect(school.createdAt).toBeInstanceOf(Date);
      expect(school.updatedAt).toBeInstanceOf(Date);

      // Verify retrieval via service
      const retrieved = await defaultSchoolService.getSchoolById(school.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(school.id);
      expect(retrieved?.country.isoCode).toBe('KE');
      expect(retrieved?.administrativeArea?.slug).toBe('nairobi');
    });

    it('creates a valid school without administrative area (optional area relationship)', async () => {
      const [school] = await db
        .insert(schools)
        .values({
          name: 'National Remote Learning Center',
          schoolType: 'INTEGRATED',
          status: 'ACTIVE',
          countryId: kenyaCountryId,
          administrativeAreaId: null,
        })
        .returning();

      testSchoolIds.push(school.id);

      expect(school.id).toBeDefined();
      expect(school.administrativeAreaId).toBeNull();

      const retrieved = await defaultSchoolService.getSchoolById(school.id);
      expect(retrieved?.administrativeArea).toBeNull();
    });
  });

  describe('School Geography Integrity & Constraints', () => {
    it('prevents cross-country administrative area assignment (Kenya school with Tanzania area)', async () => {
      // Must be rejected by composite foreign key fk_schools_area_country and trigger
      await expect(
        db.insert(schools).values({
          name: 'Invalid Cross Country School',
          schoolType: 'SECONDARY',
          status: 'ACTIVE',
          countryId: kenyaCountryId, // Kenya!
          administrativeAreaId: tanzaniaAreaId, // Arusha in Tanzania!
        }),
      ).rejects.toThrow();
    });

    it('rejects an invalid administrative area reference (non-existent UUID)', async () => {
      const nonExistentAreaId = '99999999-9999-9999-9999-999999999999';
      await expect(
        db.insert(schools).values({
          name: 'Orphan Area School',
          schoolType: 'PRIMARY',
          status: 'ACTIVE',
          countryId: kenyaCountryId,
          administrativeAreaId: nonExistentAreaId,
        }),
      ).rejects.toThrow();
    });
  });

  describe('School Code Uniqueness Constraints', () => {
    it('enforces uniqueness of school code within the same country', async () => {
      const [firstSchool] = await db
        .insert(schools)
        .values({
          name: 'First Unique Code Academy',
          code: 'UQ-CODE-001',
          schoolType: 'PRIMARY',
          status: 'ACTIVE',
          countryId: kenyaCountryId,
        })
        .returning();
      testSchoolIds.push(firstSchool.id);

      // Attempt to insert duplicate code in Kenya
      await expect(
        db.insert(schools).values({
          name: 'Duplicate Code Academy',
          code: 'UQ-CODE-001',
          schoolType: 'JUNIOR_SCHOOL',
          status: 'ACTIVE',
          countryId: kenyaCountryId,
        }),
      ).rejects.toThrow();
    });

    it('permits multiple schools with NULL code', async () => {
      const [school1] = await db
        .insert(schools)
        .values({
          name: 'Null Code School Alpha',
          code: null,
          schoolType: 'PRIMARY',
          status: 'ACTIVE',
          countryId: kenyaCountryId,
        })
        .returning();
      testSchoolIds.push(school1.id);

      const [school2] = await db
        .insert(schools)
        .values({
          name: 'Null Code School Beta',
          code: null,
          schoolType: 'SECONDARY',
          status: 'ACTIVE',
          countryId: kenyaCountryId,
        })
        .returning();
      testSchoolIds.push(school2.id);

      expect(school1.id).toBeDefined();
      expect(school2.id).toBeDefined();
      expect(school1.id).not.toBe(school2.id);
    });
  });

  describe('Controlled School Type & Status Constraints', () => {
    it('rejects invalid school type values via database check constraint', async () => {
      await expect(
        db.insert(schools).values({
          name: 'Invalid Type Institute',
          schoolType: 'UNIVERSITY',
          status: 'ACTIVE',
          countryId: kenyaCountryId,
        }),
      ).rejects.toThrow();
    });

    it('rejects invalid school status values via database check constraint', async () => {
      await expect(
        db.insert(schools).values({
          name: 'Invalid Status Academy',
          schoolType: 'PRIMARY',
          status: 'PENDING_APPROVAL',
          countryId: kenyaCountryId,
        }),
      ).rejects.toThrow();
    });

    it('rejects empty or whitespace-only school name via check constraint', async () => {
      await expect(
        db.insert(schools).values({
          name: '   ',
          schoolType: 'PRIMARY',
          status: 'ACTIVE',
          countryId: kenyaCountryId,
        }),
      ).rejects.toThrow();
    });
  });

  describe('Inactive Schools Behaviour', () => {
    it('does not expose inactive schools through public service queries', async () => {
      const [inactiveSchool] = await db
        .insert(schools)
        .values({
          name: 'Closed Historic School',
          code: 'CHS-999',
          schoolType: 'SECONDARY',
          status: 'INACTIVE',
          countryId: kenyaCountryId,
          administrativeAreaId: nairobiAreaId,
        })
        .returning();
      testSchoolIds.push(inactiveSchool.id);

      // Verify direct retrieval returns null for public API
      const directResult = await defaultSchoolService.getSchoolById(inactiveSchool.id);
      expect(directResult).toBeNull();

      // Verify list query does not include the inactive school
      const listResult = await defaultSchoolService.listSchools({
        countryId: kenyaCountryId,
      });
      const found = listResult.data.find((s) => s.id === inactiveSchool.id);
      expect(found).toBeUndefined();
    });
  });
});
