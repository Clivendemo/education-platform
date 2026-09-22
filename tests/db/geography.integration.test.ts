import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db, closeDatabase } from '../../src/db/index.js';
import {
  countries,
  administrativeAreaTypes,
  administrativeAreas,
} from '../../src/db/schemas.js';
import {
  seedKenyaGeography,
  KENYA_COUNTIES,
} from '../../src/db/seeds/kenya-geography.js';
import { defaultGeographyService } from '../../src/services/geography.service.js';

const isDbAvailable = Boolean(process.env.DATABASE_TEST_URL || process.env.DATABASE_URL);

describe.skipIf(!isDbAvailable)('Geography Database Integration Tests', () => {
  beforeAll(async () => {
    // Ensure migrations and seed are applied to the test database
    await seedKenyaGeography();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  describe('Seeded Kenya Geography Verification', () => {
    it('contains the active Kenya country record with canonical ISO code and URL prefix', async () => {
      const kenya = await db
        .select()
        .from(countries)
        .where(eq(countries.isoCode, 'KE'))
        .limit(1);

      expect(kenya).toHaveLength(1);
      expect(kenya[0].name).toBe('Kenya');
      expect(kenya[0].isoCode).toBe('KE');
      expect(kenya[0].urlPrefix).toBe('ke');
      expect(kenya[0].currencyCode).toBe('KES');
      expect(kenya[0].status).toBe('ACTIVE');
    });

    it('contains the three-tier administrative area types (County -> Sub-County -> Ward)', async () => {
      const kenya = (
        await db.select().from(countries).where(eq(countries.isoCode, 'KE')).limit(1)
      )[0];
      expect(kenya).toBeDefined();

      const types = await db
        .select()
        .from(administrativeAreaTypes)
        .where(eq(administrativeAreaTypes.countryId, kenya.id))
        .orderBy(administrativeAreaTypes.hierarchyLevel);

      expect(types).toHaveLength(3);
      expect(types[0]).toMatchObject({
        name: 'County',
        slug: 'county',
        hierarchyLevel: 1,
        parentTypeId: null,
      });
      expect(types[1]).toMatchObject({
        name: 'Sub-County',
        slug: 'sub-county',
        hierarchyLevel: 2,
        parentTypeId: types[0].id,
      });
      expect(types[2]).toMatchObject({
        name: 'Ward',
        slug: 'ward',
        hierarchyLevel: 3,
        parentTypeId: types[1].id,
      });
    });

    it('contains exactly 47 counties of Kenya with parent_id IS NULL', async () => {
      const kenya = (
        await db.select().from(countries).where(eq(countries.isoCode, 'KE')).limit(1)
      )[0];

      const countyType = (
        await db
          .select()
          .from(administrativeAreaTypes)
          .where(
            sql`${administrativeAreaTypes.countryId} = ${kenya.id} AND ${administrativeAreaTypes.slug} = 'county'`,
          )
          .limit(1)
      )[0];

      const areas = await db
        .select()
        .from(administrativeAreas)
        .where(
          sql`${administrativeAreas.countryId} = ${kenya.id} AND ${administrativeAreas.typeId} = ${countyType.id}`,
        );

      expect(areas).toHaveLength(47);
      expect(areas.every((a) => a.parentId === null)).toBe(true);

      const codes = areas.map((a) => a.code).sort();
      expect(codes[0]).toBe('001'); // Mombasa
      expect(codes[codes.length - 1]).toBe('047'); // Nairobi
    });
  });

  describe('Database Integrity & Constraints', () => {
    it('enforces uppercase ISO code constraint (chk_countries_iso_code_upper)', async () => {
      await expect(
        db.insert(countries).values({
          name: 'Uganda',
          isoCode: 'ug', // Lowercase must violate check constraint
          urlPrefix: 'ug',
          defaultLanguageCode: 'en',
          currencyCode: 'UGX',
          status: 'ACTIVE',
        }),
      ).rejects.toThrow();
    });

    it('enforces lowercase URL prefix constraint (chk_countries_url_prefix_lower)', async () => {
      await expect(
        db.insert(countries).values({
          name: 'Uganda',
          isoCode: 'UG',
          urlPrefix: 'UG', // Uppercase must violate check constraint
          defaultLanguageCode: 'en',
          currencyCode: 'UGX',
          status: 'ACTIVE',
        }),
      ).rejects.toThrow();
    });

    it('enforces unique ISO code constraint (uq_countries_iso_code)', async () => {
      await expect(
        db.insert(countries).values({
          name: 'Kenya Duplicate',
          isoCode: 'KE', // Already exists
          urlPrefix: 'ke2',
          defaultLanguageCode: 'en',
          currencyCode: 'KES',
          status: 'ACTIVE',
        }),
      ).rejects.toThrow();
    });

    it('enforces unique URL prefix constraint (uq_countries_url_prefix)', async () => {
      await expect(
        db.insert(countries).values({
          name: 'Kenya Duplicate',
          isoCode: 'KD',
          urlPrefix: 'ke', // Already exists
          defaultLanguageCode: 'en',
          currencyCode: 'KES',
          status: 'ACTIVE',
        }),
      ).rejects.toThrow();
    });

    it('prevents self-parenting on administrative areas', async () => {
      const kenya = (
        await db.select().from(countries).where(eq(countries.isoCode, 'KE')).limit(1)
      )[0];
      const countyType = (
        await db
          .select()
          .from(administrativeAreaTypes)
          .where(
            sql`${administrativeAreaTypes.countryId} = ${kenya.id} AND ${administrativeAreaTypes.slug} = 'county'`,
          )
          .limit(1)
      )[0];

      const testId = 'f0000000-0000-0000-0000-000000000001';
      await expect(
        db.insert(administrativeAreas).values({
          id: testId,
          countryId: kenya.id,
          typeId: countyType.id,
          parentId: testId, // Self-parenting!
          name: 'Self Parent Area',
          slug: 'self-parent-area',
          status: 'ACTIVE',
        }),
      ).rejects.toThrow();
    });

    it('ensures seed operation is strictly idempotent without duplicating records', async () => {
      // Re-running seedKenyaGeography must succeed cleanly
      const result = await seedKenyaGeography();
      expect(result.countiesCount).toBe(KENYA_COUNTIES.length);

      const countRow = await db
        .select({ value: sql`count(*)` })
        .from(administrativeAreas);

      expect(Number(countRow[0].value)).toBe(47);
    }, 15000);
  });

  describe('Geography Service Live Integration', () => {
    it('service lists active countries', async () => {
      const list = await defaultGeographyService.listActiveCountries();
      expect(list.length).toBeGreaterThanOrEqual(1);
      const ke = list.find((c) => c.isoCode === 'KE');
      expect(ke).toBeDefined();
      expect(ke?.name).toBe('Kenya');
    });

    it('service retrieves country by case-insensitive ISO code or URL prefix', async () => {
      const byUpper = await defaultGeographyService.getActiveCountryByIdentifier('KE');
      const byLower = await defaultGeographyService.getActiveCountryByIdentifier('ke');
      expect(byUpper).toBeDefined();
      expect(byLower).toBeDefined();
      expect(byUpper?.id).toBe(byLower?.id);
    });

    it('service lists areas with pagination metadata', async () => {
      const result = await defaultGeographyService.listAreas({
        page: 1,
        pageSize: 10,
      });

      expect(result.data).toHaveLength(10);
      expect(result.meta.page).toBe(1);
      expect(result.meta.pageSize).toBe(10);
      expect(result.meta.total).toBe(47);
      expect(result.meta.hasMore).toBe(true);
      expect(result.data[0].type?.name).toBe('County');
    });
  });
});
