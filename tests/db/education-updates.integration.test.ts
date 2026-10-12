import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db, closeDatabase } from '../../src/db/index.js';
import {
  countries,
  curricula,
  resources,
  resourceTypes,
  educationUpdates,
  educationUpdateCurricula,
  educationUpdateResources,
} from '../../src/db/schemas.js';
import { seedEducationUpdateCategories } from '../../src/db/seeds/education-updates-categories.js';
import { withDbRetry } from '../helpers/db-retry.js';

describe('Prompt 23: Database Schema & Constraints Integration', () => {
  let kenyaId: string;
  let curriculumId: string;
  let resourceId: string;

  const cleanupUpdateIds: string[] = [];
  const cleanupCurriculumIds: string[] = [];
  const cleanupResourceIds: string[] = [];

  beforeAll(async () => {
    await withDbRetry(() => seedEducationUpdateCategories(db));

    const [ke] = await withDbRetry(() =>
      db.select().from(countries).where(eq(countries.isoCode, 'KE')).limit(1),
    );
    kenyaId = ke.id;

    // Create a test curriculum
    const [c] = await withDbRetry(() =>
      db
        .insert(curricula)
        .values({
          countryId: kenyaId,
          name: `DB Test Curriculum ${Date.now()}`,
          slug: `db-test-curr-${Date.now()}`,
          status: 'ACTIVE',
        })
        .returning(),
    );
    curriculumId = c.id;
    cleanupCurriculumIds.push(curriculumId);

    // Get an active resourceType
    const [rt] = await withDbRetry(() =>
      db.select().from(resourceTypes).where(eq(resourceTypes.status, 'ACTIVE')).limit(1),
    );

    // Create a test resource
    const [res] = await withDbRetry(() =>
      db
        .insert(resources)
        .values({
          countryId: kenyaId,
          resourceTypeId: rt.id,
          title: `DB Test Resource ${Date.now()}`,
          slug: `db-test-res-${Date.now()}`,
          status: 'PUBLISHED',
          qualityLabel: 'STANDARD',
        })
        .returning(),
    );
    resourceId = res.id;
    cleanupResourceIds.push(resourceId);
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
    await closeDatabase();
  });

  it('enforces chk_education_updates_title: empty or whitespace title fails', async () => {
    await expect(
      withDbRetry(() =>
        db.insert(educationUpdates).values({
          title: '   ', // whitespace only
          slug: `chk-title-fail-${Date.now()}`,
          body: 'Valid body text',
          publicationStatus: 'DRAFT',
        }),
      ),
    ).rejects.toThrow();
  });

  it('enforces chk_education_updates_status: invalid publication status fails', async () => {
    await expect(
      withDbRetry(() =>
        db.insert(educationUpdates).values({
          title: 'Valid Title',
          slug: `chk-status-fail-${Date.now()}`,
          body: 'Valid body text',
          publicationStatus: 'INVALID_STATUS' as any,
        }),
      ),
    ).rejects.toThrow();
  });

  it('enforces uq_education_updates_slug: duplicate slug fails', async () => {
    const slug = `uq-slug-${Date.now()}`;
    const [first] = await withDbRetry(() =>
      db
        .insert(educationUpdates)
        .values({
          title: 'Valid Title 1',
          slug,
          body: 'Valid body text 1',
          publicationStatus: 'DRAFT',
        })
        .returning(),
    );
    cleanupUpdateIds.push(first.id);

    await expect(
      withDbRetry(() =>
        db.insert(educationUpdates).values({
          title: 'Valid Title 2',
          slug, // Duplicate!
          body: 'Valid body text 2',
          publicationStatus: 'DRAFT',
        }),
      ),
    ).rejects.toThrow();
  });

  it('cascades deletion of education_updates to curricula and resources junction tables', async () => {
    const slug = `cascade-test-${Date.now()}`;
    const [update] = await withDbRetry(() =>
      db
        .insert(educationUpdates)
        .values({
          title: 'Cascade Test Update',
          slug,
          body: 'Testing foreign key cascade.',
          publicationStatus: 'DRAFT',
        })
        .returning(),
    );

    // Attach curriculum & resource
    await withDbRetry(() =>
      db.insert(educationUpdateCurricula).values({
        updateId: update.id,
        curriculumId,
      }),
    );
    await withDbRetry(() =>
      db.insert(educationUpdateResources).values({
        updateId: update.id,
        resourceId,
        displayOrder: 1,
      }),
    );

    // Verify junction entries exist
    const currEntries = await withDbRetry(() =>
      db
        .select()
        .from(educationUpdateCurricula)
        .where(eq(educationUpdateCurricula.updateId, update.id)),
    );
    expect(currEntries.length).toBe(1);

    const resEntries = await withDbRetry(() =>
      db
        .select()
        .from(educationUpdateResources)
        .where(eq(educationUpdateResources.updateId, update.id)),
    );
    expect(resEntries.length).toBe(1);

    // Delete the update
    await withDbRetry(() =>
      db.delete(educationUpdates).where(eq(educationUpdates.id, update.id)),
    );

    // Verify junction entries were cascaded and deleted automatically
    const remainingCurr = await withDbRetry(() =>
      db
        .select()
        .from(educationUpdateCurricula)
        .where(eq(educationUpdateCurricula.updateId, update.id)),
    );
    expect(remainingCurr.length).toBe(0);

    const remainingRes = await withDbRetry(() =>
      db
        .select()
        .from(educationUpdateResources)
        .where(eq(educationUpdateResources.updateId, update.id)),
    );
    expect(remainingRes.length).toBe(0);
  });
});
