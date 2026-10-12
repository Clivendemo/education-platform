import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db, closeDatabase } from '../../src/db/index.js';
import {
  countries,
  curricula,
  resources,
  resourceTypes,
  educationUpdates,
  educationUpdateCategories,
} from '../../src/db/schemas.js';
import { EducationUpdateService } from '../../src/services/education-update.service.js';
import { seedEducationUpdateCategories } from '../../src/db/seeds/education-updates-categories.js';
import { withDbRetry } from '../helpers/db-retry.js';

describe('Prompt 23: Education Updates Service & Invariants', () => {
  const service = new EducationUpdateService(db);

  let kenyaId: string;
  let ugandaId: string;
  let kenyaCurriculumId: string;
  let ugandaCurriculumId: string;
  let kenyaResourceId: string;
  let draftResourceId: string;
  let testCategoryId: string;

  const cleanupUpdateIds: string[] = [];
  const cleanupCurriculumIds: string[] = [];
  const cleanupResourceIds: string[] = [];
  const createdCountryIds: string[] = [];

  beforeAll(async () => {
    await withDbRetry(() => seedEducationUpdateCategories(db));

    // Get or create test category
    const [cat] = await withDbRetry(() =>
      db
        .select()
        .from(educationUpdateCategories)
        .where(eq(educationUpdateCategories.status, 'ACTIVE'))
        .limit(1),
    );
    testCategoryId = cat.id;

    // Resolve or create Kenya and Uganda countries
    const [ke] = await withDbRetry(() =>
      db.select().from(countries).where(eq(countries.isoCode, 'KE')).limit(1),
    );
    if (ke) {
      kenyaId = ke.id;
    } else {
      const [newKe] = await withDbRetry(() =>
        db
          .insert(countries)
          .values({
            name: 'Kenya Test',
            isoCode: 'KE',
            urlPrefix: 'ke',
            status: 'ACTIVE',
          })
          .returning(),
      );
      kenyaId = newKe.id;
      createdCountryIds.push(kenyaId);
    }

    const [ug] = await withDbRetry(() =>
      db.select().from(countries).where(eq(countries.isoCode, 'UG')).limit(1),
    );
    if (ug) {
      ugandaId = ug.id;
    } else {
      const [newUg] = await withDbRetry(() =>
        db
          .insert(countries)
          .values({
            name: 'Uganda Test',
            isoCode: 'UG',
            urlPrefix: 'ug',
            status: 'ACTIVE',
          })
          .returning(),
      );
      ugandaId = newUg.id;
      createdCountryIds.push(ugandaId);
    }

    // Create a Kenya curriculum and an Uganda curriculum
    const [keCurr] = await withDbRetry(() =>
      db
        .insert(curricula)
        .values({
          countryId: kenyaId,
          name: `KE CBC Test ${Date.now()}`,
          slug: `ke-cbc-test-${Date.now()}`,
          status: 'ACTIVE',
        })
        .returning(),
    );
    kenyaCurriculumId = keCurr.id;
    cleanupCurriculumIds.push(kenyaCurriculumId);

    const [ugCurr] = await withDbRetry(() =>
      db
        .insert(curricula)
        .values({
          countryId: ugandaId,
          name: `UG UNEB Test ${Date.now()}`,
          slug: `ug-uneb-test-${Date.now()}`,
          status: 'ACTIVE',
        })
        .returning(),
    );
    ugandaCurriculumId = ugCurr.id;
    cleanupCurriculumIds.push(ugandaCurriculumId);

    // Get an active resourceType
    let [rt] = await withDbRetry(() =>
      db.select().from(resourceTypes).where(eq(resourceTypes.status, 'ACTIVE')).limit(1),
    );
    if (!rt) {
      const [newRt] = await withDbRetry(() =>
        db
          .insert(resourceTypes)
          .values({
            name: 'Notes & Revision',
            slug: `notes-revision-${Date.now()}`,
            code: 'NOT',
            pillar: 'NOTES_REVISION',
            sequenceOrder: 1,
            status: 'ACTIVE',
          })
          .returning(),
      );
      rt = newRt;
    }

    // Create a published resource in Kenya
    const [pubRes] = await withDbRetry(() =>
      db
        .insert(resources)
        .values({
          countryId: kenyaId,
          resourceTypeId: rt.id,
          title: `Published Resource ${Date.now()}`,
          slug: `pub-res-${Date.now()}`,
          status: 'PUBLISHED',
          qualityLabel: 'VERIFIED',
        })
        .returning(),
    );
    kenyaResourceId = pubRes.id;
    cleanupResourceIds.push(kenyaResourceId);

    // Create a DRAFT resource in Kenya (should be filtered out in public endpoints)
    const [draftRes] = await withDbRetry(() =>
      db
        .insert(resources)
        .values({
          countryId: kenyaId,
          resourceTypeId: rt.id,
          title: `Draft Resource ${Date.now()}`,
          slug: `draft-res-${Date.now()}`,
          status: 'DRAFT',
          qualityLabel: 'STANDARD',
        })
        .returning(),
    );
    draftResourceId = draftRes.id;
    cleanupResourceIds.push(draftResourceId);
  });

  afterAll(async () => {
    if (cleanupUpdateIds.length > 0) {
      await withDbRetry(() =>
        db
          .delete(educationUpdates)
          .where(inArray(educationUpdates.id, cleanupUpdateIds)),
      );
    }
    if (cleanupResourceIds.length > 0) {
      await withDbRetry(() =>
        db.delete(resources).where(inArray(resources.id, cleanupResourceIds)),
      );
    }
    if (cleanupCurriculumIds.length > 0) {
      await withDbRetry(() =>
        db.delete(curricula).where(inArray(curricula.id, cleanupCurriculumIds)),
      );
    }
    if (createdCountryIds.length > 0) {
      await withDbRetry(() =>
        db.delete(countries).where(inArray(countries.id, createdCountryIds)),
      );
    }
    await closeDatabase();
  });

  it('creates updates strictly as DRAFT and verifies canonical properties', async () => {
    const slug = `update-draft-${Date.now()}`;
    const created = await withDbRetry(() =>
      service.createUpdate({
        title: 'Ministry Announces CBC Senior School Guidelines',
        slug,
        summary: 'Official circular regarding grade 10 transition structures.',
        body: 'Detailed guidelines and subject pathways for senior school implementation across all counties.',
        countryId: kenyaId,
        categoryId: testCategoryId,
      }),
    );
    cleanupUpdateIds.push(created.id);

    expect(created.id).toBeDefined();
    expect(created.publicationStatus).toBe('DRAFT');
    expect(created.publishedAt).toBeNull();
    expect(created.slug).toBe(slug);
    expect(created.country?.id).toBe(kenyaId);
    expect(created.category?.id).toBe(testCategoryId);
    expect(created.canonicalUrl).toContain(`/ke/updates/${slug}`);
  });

  it('rejects duplicate slugs with a 409 DUPLICATE_SLUG error', async () => {
    const duplicateSlug = `collision-slug-${Date.now()}`;
    const first = await withDbRetry(() =>
      service.createUpdate({
        title: 'First Circular',
        slug: duplicateSlug,
        body: 'Circular content 1',
      }),
    );
    cleanupUpdateIds.push(first.id);

    await expect(
      service.createUpdate({
        title: 'Second Circular',
        slug: duplicateSlug,
        body: 'Circular content 2',
      }),
    ).rejects.toThrowError(/duplicate slug/i);
  });

  it('supports regional (nullable country_id) updates and builds regional canonical URLs', async () => {
    const slug = `regional-advisory-${Date.now()}`;
    const regional = await withDbRetry(() =>
      service.createUpdate({
        title: 'East Africa Education Harmonization Framework',
        slug,
        summary: 'Regional advisory across EAC partner states.',
        body: 'Standards for cross-border curriculum recognition and teacher credentials.',
        countryId: null, // Regional update
        categoryId: testCategoryId,
      }),
    );
    cleanupUpdateIds.push(regional.id);

    expect(regional.country).toBeNull();
    expect(regional.canonicalUrl).not.toContain('/ke/');
    expect(regional.canonicalUrl).toContain(`/updates/${slug}`);
  });

  it('enforces country consistency: rejects curriculum from mismatched country', async () => {
    const slug = `mismatch-curr-${Date.now()}`;
    await expect(
      service.createUpdate({
        title: 'Kenya Assessment Update with Uganda Curriculum',
        slug,
        body: 'Body text',
        countryId: kenyaId,
        curriculumIds: [ugandaCurriculumId], // Uganda curriculum attached to Kenya update!
      }),
    ).rejects.toThrowError(/country mismatch/i);
  });

  it('enforces publication lifecycle: DRAFT -> PUBLISHED sets published_at and preserves on edit', async () => {
    const slug = `pub-lifecycle-${Date.now()}`;
    const draft = await withDbRetry(() =>
      service.createUpdate({
        title: 'National Examinations Timetable Released',
        slug,
        body: 'Complete timetable and candidate instructions.',
        countryId: kenyaId,
      }),
    );
    cleanupUpdateIds.push(draft.id);

    expect(draft.publicationStatus).toBe('DRAFT');
    expect(draft.publishedAt).toBeNull();

    // Publish
    const published = await withDbRetry(() => service.publishUpdate(draft.id));
    expect(published.publicationStatus).toBe('PUBLISHED');
    expect(published.publishedAt).not.toBeNull();
    const originalPublishedAt = published.publishedAt;

    // Edit published update — must PRESERVE publishedAt
    const edited = await withDbRetry(() =>
      service.updateUpdate(draft.id, {
        title: 'National Examinations Timetable Released (Revised)',
      }),
    );
    expect(edited.publicationStatus).toBe('PUBLISHED');
    expect(edited.publishedAt).toBe(originalPublishedAt);
    expect(edited.title).toBe('National Examinations Timetable Released (Revised)');
  });

  it('enforces publication lifecycle: ARCHIVED immediately hides from public endpoints and prevents edits', async () => {
    const slug = `archive-lifecycle-${Date.now()}`;
    const draft = await withDbRetry(() =>
      service.createUpdate({
        title: 'Temporary Advisory',
        slug,
        body: 'To be archived shortly.',
        countryId: kenyaId,
      }),
    );
    cleanupUpdateIds.push(draft.id);

    // Publish first
    await withDbRetry(() => service.publishUpdate(draft.id));

    // Publicly accessible while published
    const pubCheck = await withDbRetry(() => service.getPublicUpdateBySlug(slug));
    expect(pubCheck).not.toBeNull();

    // Archive
    const archived = await withDbRetry(() => service.archiveUpdate(draft.id));
    expect(archived.publicationStatus).toBe('ARCHIVED');

    // Immediately hidden from public get by slug
    const hiddenCheck = await withDbRetry(() => service.getPublicUpdateBySlug(slug));
    expect(hiddenCheck).toBeNull();

    // Cannot edit an archived update
    await expect(
      service.updateUpdate(draft.id, { title: 'Attempted Change' }),
    ).rejects.toThrowError(/cannot edit an archived/i);

    // Cannot publish an archived update
    await expect(
      service.publishUpdate(draft.id),
    ).rejects.toThrowError(/cannot publish an archived/i);
  });

  it('prevents leakage: public response filters out draft attached resources', async () => {
    const slug = `leak-prevention-${Date.now()}`;
    const draft = await withDbRetry(() =>
      service.createUpdate({
        title: 'Update with Attached Resources',
        slug,
        body: 'Contains both published and draft materials.',
        countryId: kenyaId,
        resources: [
          { resourceId: kenyaResourceId, displayOrder: 1 },
          { resourceId: draftResourceId, displayOrder: 2 }, // DRAFT resource!
        ],
      }),
    );
    cleanupUpdateIds.push(draft.id);

    // Publish the update
    await withDbRetry(() => service.publishUpdate(draft.id));

    // Admin view can see all resources
    const adminDetail = await withDbRetry(() => service.getAdminUpdateById(draft.id));
    expect(adminDetail?.resources.length).toBe(2);

    // Public view MUST ONLY include the published resource
    const publicDetail = await withDbRetry(() => service.getPublicUpdateBySlug(slug));
    expect(publicDetail).not.toBeNull();
    expect(publicDetail?.resources.length).toBe(1);
    expect(publicDetail?.resources[0].id).toBe(kenyaResourceId);
    expect(publicDetail?.resources.some((r) => r.id === draftResourceId)).toBe(false);
  });

  it('provides deterministic OpenGraph, Twitter, and canonical SEO metadata', async () => {
    const slug = `seo-verification-${Date.now()}`;
    const update = await withDbRetry(() =>
      service.createUpdate({
        title: 'Ministry Circular on Term 2 Midterm Dates',
        slug,
        summary: 'Official changes to the 2026 academic calendar.',
        body: 'Full calendar schedule for all primary and secondary schools in Kenya.',
        countryId: kenyaId,
        seoTitle: 'Kenya Term 2 Midterm Dates 2026 - Ministry Circular',
        seoDescription: 'Verified term dates and official academic calendar circular for Kenya.',
      }),
    );
    cleanupUpdateIds.push(update.id);

    await withDbRetry(() => service.publishUpdate(update.id));

    const pub = await withDbRetry(() => service.getPublicUpdateBySlug(slug));
    expect(pub).not.toBeNull();
    expect(pub?.seo.title).toBe('Kenya Term 2 Midterm Dates 2026 - Ministry Circular');
    expect(pub?.seo.description).toBe('Verified term dates and official academic calendar circular for Kenya.');
    expect(pub?.seo.openGraph.type).toBe('article');
    expect(pub?.seo.openGraph.url).toBe(pub?.canonicalUrl);
    expect(pub?.seo.robots.index).toBe(true);
    expect(pub?.seo.robots.follow).toBe(true);
  });
});
