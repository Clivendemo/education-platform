import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { withDbRetry } from '../helpers/db-retry.js';
import {
  countries,
  resourceTypes,
  resources,
  resourceVersions,
  resourceFeedback,
  users,
} from '../../src/db/schemas.js';

describe('Resource Feedback Database Layer Integration Tests', () => {
  let countryId: string;
  let resourceTypeId: string;
  let testUserId: string;
  let publishedResourceId: string;
  let publishedVersionId: string;
  let draftResourceId: string;
  let draftVersionId: string;

  beforeAll(async () => {
    // 1. Resolve country & resource type
    const [c] = await withDbRetry(async () =>
      db.select().from(countries).where(eq(countries.status, 'ACTIVE')).limit(1),
    );
    countryId = c.id;

    const [rt] = await withDbRetry(async () =>
      db.select().from(resourceTypes).limit(1),
    );
    resourceTypeId = rt.id;

    // 2. Create test user
    const [u] = await withDbRetry(async () =>
      db
        .insert(users)
        .values({
          email: `db_feedback_test_${Date.now()}@example.com`,
          displayName: 'DB Feedback User',
        })
        .returning(),
    );
    testUserId = u.id;

    // 3. Create published resource & version
    const [rp] = await withDbRetry(async () =>
      db
        .insert(resources)
        .values({
          countryId,
          resourceTypeId,
          title: `DB Feedback Pub Res ${Date.now()}`,
          slug: `db-feedback-pub-${Date.now()}`,
          status: 'PUBLISHED',
          qualityLabel: 'STANDARD',
        })
        .returning(),
    );
    publishedResourceId = rp.id;

    const [vp] = await withDbRetry(async () =>
      db
        .insert(resourceVersions)
        .values({
          resourceId: publishedResourceId,
          versionNumber: 1,
          versionLabel: 'v1.0',
          title: 'DB Feedback Pub Version 1',
          status: 'PUBLISHED',
          publishedAt: new Date(),
        })
        .returning(),
    );
    publishedVersionId = vp.id;

    // 4. Create draft resource & version
    const [rd] = await withDbRetry(async () =>
      db
        .insert(resources)
        .values({
          countryId,
          resourceTypeId,
          title: `DB Feedback Draft Res ${Date.now()}`,
          slug: `db-feedback-draft-${Date.now()}`,
          status: 'DRAFT',
          qualityLabel: 'STANDARD',
        })
        .returning(),
    );
    draftResourceId = rd.id;

    const [vd] = await withDbRetry(async () =>
      db
        .insert(resourceVersions)
        .values({
          resourceId: draftResourceId,
          versionNumber: 1,
          versionLabel: 'v1.0',
          title: 'DB Feedback Draft Version 1',
          status: 'DRAFT',
        })
        .returning(),
    );
    draftVersionId = vd.id;
  }, 120000);

  it('rejects feedback on draft version via trigger tg_check_feedback_version_match', async () => {
    let caughtErr: any;
    try {
      await withDbRetry(async () =>
        db.insert(resourceFeedback).values({
          resourceId: draftResourceId,
          resourceVersionId: draftVersionId,
          userId: testUserId,
          feedbackType: 'HELPFUL',
          status: 'PENDING',
        }),
      );
    } catch (err: any) {
      caughtErr = err;
    }
    expect(caughtErr).toBeDefined();
    const combined = `${caughtErr?.message || ''} ${caughtErr?.cause?.message || ''}`;
    expect(combined).toMatch(/PUBLISHED/i);
  });

  it('rejects feedback where version does not belong to resource via trigger', async () => {
    let caughtErr: any;
    try {
      await withDbRetry(async () =>
        db.insert(resourceFeedback).values({
          resourceId: publishedResourceId,
          resourceVersionId: draftVersionId, // Version belongs to draftResourceId
          userId: testUserId,
          feedbackType: 'HELPFUL',
          status: 'PENDING',
        }),
      );
    } catch (err: any) {
      caughtErr = err;
    }
    expect(caughtErr).toBeDefined();
    const combined = `${caughtErr?.message || ''} ${caughtErr?.cause?.message || ''}`;
    expect(combined).toMatch(/does not belong to resource_id/);
  });

  it('enforces chk_feedback_status on invalid status insertion', async () => {
    let caughtErr: any;
    try {
      await withDbRetry(async () =>
        db.insert(resourceFeedback).values({
          resourceId: publishedResourceId,
          resourceVersionId: publishedVersionId,
          userId: testUserId,
          feedbackType: 'HELPFUL',
          status: 'INVALID_STATUS' as any,
        }),
      );
    } catch (err: any) {
      caughtErr = err;
    }
    expect(caughtErr).toBeDefined();
    const combined = `${caughtErr?.message || ''} ${caughtErr?.cause?.message || ''}`;
    expect(combined).toMatch(/chk_feedback_status/i);
  });

  it('enforces chk_feedback_type on invalid feedback_type insertion', async () => {
    let caughtErr: any;
    try {
      await withDbRetry(async () =>
        db.insert(resourceFeedback).values({
          resourceId: publishedResourceId,
          resourceVersionId: publishedVersionId,
          userId: testUserId,
          feedbackType: 'NON_EXISTENT_TYPE' as any,
          status: 'PENDING',
        }),
      );
    } catch (err: any) {
      caughtErr = err;
    }
    expect(caughtErr).toBeDefined();
    const combined = `${caughtErr?.message || ''} ${caughtErr?.cause?.message || ''}`;
    expect(combined).toMatch(/chk_feedback_type/i);
  });

  it('enforces chk_feedback_reviewed constraint: PENDING cannot have reviewed_at or reviewed_by', async () => {
    let caughtErr: any;
    try {
      await withDbRetry(async () =>
        db.insert(resourceFeedback).values({
          resourceId: publishedResourceId,
          resourceVersionId: publishedVersionId,
          userId: testUserId,
          feedbackType: 'HELPFUL',
          status: 'PENDING',
          reviewedBy: testUserId, // Violates constraint for PENDING!
          reviewedAt: new Date(),
        }),
      );
    } catch (err: any) {
      caughtErr = err;
    }
    expect(caughtErr).toBeDefined();
    const combined = `${caughtErr?.message || ''} ${caughtErr?.cause?.message || ''}`;
    expect(combined).toMatch(/chk_feedback_reviewed/i);
  });

  it('enforces chk_feedback_details_len constraint on details exceeding 1000 characters', async () => {
    let caughtErr: any;
    try {
      await withDbRetry(async () =>
        db.insert(resourceFeedback).values({
          resourceId: publishedResourceId,
          resourceVersionId: publishedVersionId,
          userId: testUserId,
          feedbackType: 'HELPFUL',
          details: 'X'.repeat(1001),
          status: 'PENDING',
        }),
      );
    } catch (err: any) {
      caughtErr = err;
    }
    expect(caughtErr).toBeDefined();
    const combined = `${caughtErr?.message || ''} ${caughtErr?.cause?.message || ''}`;
    expect(combined).toMatch(/chk_feedback_details_len/i);
  });

  it('enforces ON DELETE RESTRICT on user_id preventing accidental user hard-deletion', async () => {
    // Insert valid feedback
    await withDbRetry(async () =>
      db
        .insert(resourceFeedback)
        .values({
          resourceId: publishedResourceId,
          resourceVersionId: publishedVersionId,
          userId: testUserId,
          feedbackType: 'HELPFUL',
          status: 'PENDING',
        })
        .returning(),
    );

    // Attempt deleting user -> MUST be blocked by foreign key ON DELETE RESTRICT
    let deleteErr: any;
    try {
      await withDbRetry(async () =>
        db.delete(users).where(eq(users.id, testUserId)),
      );
    } catch (err: any) {
      deleteErr = err;
    }
    expect(deleteErr).toBeDefined();
    const combined = `${deleteErr?.message || ''} ${deleteErr?.cause?.message || ''}`;
    expect(combined).toMatch(/foreign key constraint|violates foreign key/i);
  });
});
