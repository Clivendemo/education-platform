import { sql } from 'drizzle-orm';
import { db as defaultDb, closeDatabase } from '../index.js';
import {
  countries,
  administrativeAreaTypes,
  administrativeAreas,
} from '../schemas.js';

export const KENYA_COUNTIES = [
  { code: '001', name: 'Mombasa', slug: 'mombasa' },
  { code: '002', name: 'Kwale', slug: 'kwale' },
  { code: '003', name: 'Kilifi', slug: 'kilifi' },
  { code: '004', name: 'Tana River', slug: 'tana-river' },
  { code: '005', name: 'Lamu', slug: 'lamu' },
  { code: '006', name: 'Taita/Taveta', slug: 'taita-taveta' },
  { code: '007', name: 'Garissa', slug: 'garissa' },
  { code: '008', name: 'Wajir', slug: 'wajir' },
  { code: '009', name: 'Mandera', slug: 'mandera' },
  { code: '010', name: 'Marsabit', slug: 'marsabit' },
  { code: '011', name: 'Isiolo', slug: 'isiolo' },
  { code: '012', name: 'Meru', slug: 'meru' },
  { code: '013', name: 'Tharaka-Nithi', slug: 'tharaka-nithi' },
  { code: '014', name: 'Embu', slug: 'embu' },
  { code: '015', name: 'Kitui', slug: 'kitui' },
  { code: '016', name: 'Machakos', slug: 'machakos' },
  { code: '017', name: 'Makueni', slug: 'makueni' },
  { code: '018', name: 'Nyandarua', slug: 'nyandarua' },
  { code: '019', name: 'Nyeri', slug: 'nyeri' },
  { code: '020', name: 'Kirinyaga', slug: 'kirinyaga' },
  { code: '021', name: "Murang'a", slug: 'muranga' },
  { code: '022', name: 'Kiambu', slug: 'kiambu' },
  { code: '023', name: 'Turkana', slug: 'turkana' },
  { code: '024', name: 'West Pokot', slug: 'west-pokot' },
  { code: '025', name: 'Samburu', slug: 'samburu' },
  { code: '026', name: 'Trans Nzoia', slug: 'trans-nzoia' },
  { code: '027', name: 'Uasin Gishu', slug: 'uasin-gishu' },
  { code: '028', name: 'Elgeyo/Marakwet', slug: 'elgeyo-marakwet' },
  { code: '029', name: 'Nandi', slug: 'nandi' },
  { code: '030', name: 'Baringo', slug: 'baringo' },
  { code: '031', name: 'Laikipia', slug: 'laikipia' },
  { code: '032', name: 'Nakuru', slug: 'nakuru' },
  { code: '033', name: 'Narok', slug: 'narok' },
  { code: '034', name: 'Kajiado', slug: 'kajiado' },
  { code: '035', name: 'Kericho', slug: 'kericho' },
  { code: '036', name: 'Bomet', slug: 'bomet' },
  { code: '037', name: 'Kakamega', slug: 'kakamega' },
  { code: '038', name: 'Vihiga', slug: 'vihiga' },
  { code: '039', name: 'Bungoma', slug: 'bungoma' },
  { code: '040', name: 'Busia', slug: 'busia' },
  { code: '041', name: 'Siaya', slug: 'siaya' },
  { code: '042', name: 'Kisumu', slug: 'kisumu' },
  { code: '043', name: 'Homa Bay', slug: 'homa-bay' },
  { code: '044', name: 'Migori', slug: 'migori' },
  { code: '045', name: 'Kisii', slug: 'kisii' },
  { code: '046', name: 'Nyamira', slug: 'nyamira' },
  { code: '047', name: 'Nairobi', slug: 'nairobi' },
] as const;

export async function seedKenyaGeography(dbInstance = defaultDb) {
  // 1. Seed Kenya Country Record
  const [kenya] = await dbInstance
    .insert(countries)
    .values({
      name: 'Kenya',
      isoCode: 'KE',
      urlPrefix: 'ke',
      defaultLanguageCode: 'en',
      currencyCode: 'KES',
      educationTerminologyConfig: {
        primaryLevelTerm: 'Primary School',
        secondaryLevelTerm: 'Secondary School',
        curriculumName: 'Competency-Based Curriculum (CBC)',
      },
      paymentConfig: {
        primaryPaymentMethod: 'M-PESA',
      },
      policyConfig: {},
      status: 'ACTIVE',
    })
    .onConflictDoUpdate({
      target: countries.isoCode,
      set: {
        name: 'Kenya',
        urlPrefix: 'ke',
        defaultLanguageCode: 'en',
        currencyCode: 'KES',
        status: 'ACTIVE',
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!kenya) {
    throw new Error('Failed to seed Kenya country record');
  }

  // 2. Seed Administrative Area Types (Hierarchical Sequence)
  // Level 1: County
  const [countyType] = await dbInstance
    .insert(administrativeAreaTypes)
    .values({
      countryId: kenya.id,
      name: 'County',
      slug: 'county',
      hierarchyLevel: 1,
      parentTypeId: null,
      status: 'ACTIVE',
    })
    .onConflictDoUpdate({
      target: [
        administrativeAreaTypes.countryId,
        administrativeAreaTypes.slug,
      ],
      set: {
        name: 'County',
        hierarchyLevel: 1,
        parentTypeId: null,
        status: 'ACTIVE',
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!countyType) {
    throw new Error('Failed to seed County administrative area type');
  }

  // Level 2: Sub-County (child of County)
  const [subCountyType] = await dbInstance
    .insert(administrativeAreaTypes)
    .values({
      countryId: kenya.id,
      name: 'Sub-County',
      slug: 'sub-county',
      hierarchyLevel: 2,
      parentTypeId: countyType.id,
      status: 'ACTIVE',
    })
    .onConflictDoUpdate({
      target: [
        administrativeAreaTypes.countryId,
        administrativeAreaTypes.slug,
      ],
      set: {
        name: 'Sub-County',
        hierarchyLevel: 2,
        parentTypeId: countyType.id,
        status: 'ACTIVE',
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!subCountyType) {
    throw new Error('Failed to seed Sub-County administrative area type');
  }

  // Level 3: Ward (child of Sub-County)
  await dbInstance
    .insert(administrativeAreaTypes)
    .values({
      countryId: kenya.id,
      name: 'Ward',
      slug: 'ward',
      hierarchyLevel: 3,
      parentTypeId: subCountyType.id,
      status: 'ACTIVE',
    })
    .onConflictDoUpdate({
      target: [
        administrativeAreaTypes.countryId,
        administrativeAreaTypes.slug,
      ],
      set: {
        name: 'Ward',
        hierarchyLevel: 3,
        parentTypeId: subCountyType.id,
        status: 'ACTIVE',
        updatedAt: new Date(),
      },
    });

  // 3. Seed 47 Counties of Kenya (Batch Upsert)
  await dbInstance
    .insert(administrativeAreas)
    .values(
      KENYA_COUNTIES.map((county) => ({
        countryId: kenya.id,
        typeId: countyType.id,
        parentTypeId: null,
        parentId: null,
        name: county.name,
        code: county.code,
        slug: county.slug,
        status: 'ACTIVE',
      })),
    )
    .onConflictDoUpdate({
      target: [
        administrativeAreas.countryId,
        administrativeAreas.typeId,
        administrativeAreas.slug,
      ],
      set: {
        name: sql`excluded.name`,
        code: sql`excluded.code`,
        status: 'ACTIVE',
        updatedAt: new Date(),
      },
    });

  return {
    country: kenya,
    types: {
      county: countyType,
      subCounty: subCountyType,
    },
    countiesCount: KENYA_COUNTIES.length,
  };
}

// Allow direct execution via CLI
if (process.argv[1]?.includes('kenya-geography')) {
  seedKenyaGeography()
    .then((result) => {
      // eslint-disable-next-line no-console
      console.log(
        `[SEED SUCCESS] Seeded ${result.country.name} with ${result.countiesCount} counties and administrative hierarchy`,
      );
      return closeDatabase();
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[SEED ERROR]', err);
      process.exit(1);
    });
}
