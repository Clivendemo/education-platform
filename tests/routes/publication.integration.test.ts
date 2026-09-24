import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, closeDatabase } from '../../src/db/index.js';
import {
  countries,
  resourceTypes,
  schools,
  resources,
  resourceVersions,
  publicationEvents,
} from '../../src/db/schemas.js';
import { DbPublicationService } from '../../src/services/publication.service.js';
import { buildApp } from '../../src/app.js';

describe('Prompt 08: Publication Workflow Integration & Engine Rules', () => {
  const publicationService = new DbPublicationService(db);
  const app = buildApp({
    services: {
      publicationService,
    },
  });

  let kenyaId: string;
  let tanzaniaId: string;
  let typeId: string;
  let inactiveTypeId: string;
  let schoolId: string;
  let inactiveSchoolId: string;

  const cleanupResourceIds: string[] = [];
  const createdCountryIds: string[] = [];

  beforeAll(async () => {
    // Generate a unique 2-character uppercase suffix for ISO code (e.g. 'A1', 'B2', etc.)
    const randAlpha = String.fromCharCode(65 + Math.floor(Math.random() * 26));
    const randNum = Math.floor(Math.random() * 10);
    const keIso = `K${randAlpha}${randNum}`.substring(0, 3);
    const tzIso = `T${randAlpha}${randNum}`.substring(0, 3);
    const kePrefix = `k${Date.now().toString().slice(-4)}${randNum}`;
    const tzPrefix = `t${Date.now().toString().slice(-4)}${randNum}`;

    // 1. Ensure Kenya exists
    const [ke] = await db
      .insert(countries)
      .values({
        name: `PubTest Kenya ${Date.now()}`,
        isoCode: keIso,
        urlPrefix: kePrefix,
        status: 'ACTIVE',
      })
      .returning();
    kenyaId = ke.id;
    createdCountryIds.push(ke.id);

    // Ensure Tanzania (INACTIVE)
    const [tz] = await db
      .insert(countries)
      .values({
        name: `PubTest Tanzania ${Date.now()}`,
        isoCode: tzIso,
        urlPrefix: tzPrefix,
        status: 'INACTIVE',
      })
      .returning();
    tanzaniaId = tz.id;
    createdCountryIds.push(tz.id);

    // 2. Setup Resource Types
    const [t1] = await db
      .insert(resourceTypes)
      .values({
        code: `PUB_EXAM_${Date.now()}`,
        name: 'Pub Exam Paper',
        slug: `pub-exam-${Date.now()}`,
        pillar: 'PAST_PAPERS',
        status: 'ACTIVE',
        sequenceOrder: 1,
      })
      .returning();
    typeId = t1.id;

    const [t2] = await db
      .insert(resourceTypes)
      .values({
        code: `INACT_TYPE_${Date.now()}`,
        name: 'Inactive Type',
        slug: `inact-type-${Date.now()}`,
        pillar: 'PAST_PAPERS',
        status: 'INACTIVE',
        sequenceOrder: 2,
      })
      .returning();
    inactiveTypeId = t2.id;

    // 3. Setup Schools
    const [sc] = await db
      .insert(schools)
      .values({
        countryId: kenyaId,
        name: `Pub School ${Date.now()}`,
        code: `PS-${Date.now()}`,
        schoolType: 'SECONDARY',
        status: 'ACTIVE',
      })
      .returning();
    schoolId = sc.id;

    const [inactSc] = await db
      .insert(schools)
      .values({
        countryId: kenyaId,
        name: `Inactive School ${Date.now()}`,
        code: `INS-${Date.now()}`,
        schoolType: 'SECONDARY',
        status: 'INACTIVE',
      })
      .returning();
    inactiveSchoolId = inactSc.id;
  });

  afterAll(async () => {
    // Note: content.publication_events rows are protected by engine trigger trg_prevent_publication_event_delete.
    // In test teardown, we can cleanly close the connection. Test fixtures use unique IDs that do not conflict.
    await app.close();
    await closeDatabase();
  });

  // Helper to create test resource with version
  async function createTestResource(params?: {
    countryId?: string;
    resourceTypeId?: string;
    schoolId?: string | null;
    status?: any;
    versionStatus?: any;
    publishedAt?: Date | null;
  }) {
    const [res] = await db
      .insert(resources)
      .values({
        countryId: params?.countryId ?? kenyaId,
        resourceTypeId: params?.resourceTypeId ?? typeId,
        schoolId: params?.schoolId !== undefined ? params.schoolId : schoolId,
        title: `Publication Test Resource ${Date.now()}-${Math.random()}`,
        slug: `pub-test-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        status: params?.status ?? 'DRAFT',
      })
      .returning();
    cleanupResourceIds.push(res.id);

    const [ver] = await db
      .insert(resourceVersions)
      .values({
        resourceId: res.id,
        versionNumber: 1,
        versionLabel: 'v1.0',
        title: 'Initial Version Test Title',
        status: params?.versionStatus ?? 'DRAFT',
        publishedAt: params?.publishedAt ?? null,
      })
      .returning();

    return { resource: res, version: ver };
  }

  describe('1. Synchronized State Machine & Review/Approval Cycle', () => {
    it('submits a DRAFT resource for review and synchronizes resource and candidate version to IN_REVIEW', async () => {
      const { resource, version } = await createTestResource();

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${resource.id}/submit`,
        payload: { versionId: version.id },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json().data;
      expect(data.status).toBe('IN_REVIEW');
      expect(data.versionId).toBe(version.id);
      expect(data.event.eventType).toBe('SUBMITTED');
      expect(data.event.fromStatus).toBe('DRAFT');
      expect(data.event.toStatus).toBe('IN_REVIEW');

      // Verify in database
      const [dbRes] = await db.select().from(resources).where(eq(resources.id, resource.id));
      const [dbVer] = await db.select().from(resourceVersions).where(eq(resourceVersions.id, version.id));
      expect(dbRes.status).toBe('IN_REVIEW');
      expect(dbVer.status).toBe('IN_REVIEW');
    });

    it('requires candidate version to be IN_REVIEW before approving resource', async () => {
      // Create resource in IN_REVIEW, but version still in DRAFT
      const { resource } = await createTestResource({
        status: 'IN_REVIEW',
        versionStatus: 'DRAFT',
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${resource.id}/approve`,
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('PUBLICATION_PRECONDITION_FAILED');
      expect(res.json().error.message).toMatch(/candidate resource version must be IN_REVIEW/i);
    });

    it('approves resource when candidate version is IN_REVIEW', async () => {
      const { resource } = await createTestResource({
        status: 'IN_REVIEW',
        versionStatus: 'IN_REVIEW',
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${resource.id}/approve`,
      });

      expect(res.statusCode).toBe(200);
      const data = res.json().data;
      expect(data.status).toBe('APPROVED');
      expect(data.event.eventType).toBe('APPROVED');

      const [dbRes] = await db.select().from(resources).where(eq(resources.id, resource.id));
      expect(dbRes.status).toBe('APPROVED');
    });

    it('mandates rejection reason when rejecting a candidate resource', async () => {
      const { resource } = await createTestResource({
        status: 'IN_REVIEW',
        versionStatus: 'IN_REVIEW',
      });

      // Missing reason in payload
      const emptyRes = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${resource.id}/reject`,
        payload: { reason: '' },
      });
      expect(emptyRes.statusCode).toBe(400);

      // Whitespace reason
      const wsRes = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${resource.id}/reject`,
        payload: { reason: '    ' },
      });
      expect(wsRes.statusCode).toBe(400);

      // Valid rejection reason
      const validRes = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${resource.id}/reject`,
        payload: { reason: 'Formatting does not meet quality guidelines' },
      });
      expect(validRes.statusCode).toBe(200);
      expect(validRes.json().data.status).toBe('REJECTED');
      expect(validRes.json().data.event.reason).toBe('Formatting does not meet quality guidelines');

      // Check DB sync to REJECTED
      const [dbRes] = await db.select().from(resources).where(eq(resources.id, resource.id));
      expect(dbRes.status).toBe('REJECTED');
    });

    it('returns a REJECTED resource to DRAFT and synchronizes candidate version to DRAFT', async () => {
      const { resource, version } = await createTestResource({
        status: 'REJECTED',
        versionStatus: 'REJECTED',
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${resource.id}/return-to-draft`,
        payload: { reason: 'Fixing typographical issues' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.status).toBe('DRAFT');

      const [dbRes] = await db.select().from(resources).where(eq(resources.id, resource.id));
      const [dbVer] = await db.select().from(resourceVersions).where(eq(resourceVersions.id, version.id));
      expect(dbRes.status).toBe('DRAFT');
      expect(dbVer.status).toBe('DRAFT');
    });
  });

  describe('2. Publication Preconditions & Change 2 IN_REVIEW Requirement', () => {
    it('fails publication if candidate version is in DRAFT status (Change 2 requirement)', async () => {
      // Resource is APPROVED, but version is in DRAFT
      const { resource, version } = await createTestResource({
        status: 'APPROVED',
        versionStatus: 'DRAFT',
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${resource.id}/publish`,
        payload: { versionId: version.id },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('PUBLICATION_PRECONDITION_FAILED');
      expect(res.json().error.message).toMatch(/MUST be IN_REVIEW/i);
    });

    it('fails publication if candidate version belongs to a different resource', async () => {
      const r1 = await createTestResource({ status: 'APPROVED', versionStatus: 'IN_REVIEW' });
      const r2 = await createTestResource({ status: 'APPROVED', versionStatus: 'IN_REVIEW' });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${r1.resource.id}/publish`,
        payload: { versionId: r2.version.id },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('RESOURCE_VERSION_MISMATCH');
    });

    it('fails publication if country is INACTIVE', async () => {
      const { resource, version } = await createTestResource({
        countryId: tanzaniaId, // INACTIVE country
        status: 'APPROVED',
        versionStatus: 'IN_REVIEW',
        schoolId: null,
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${resource.id}/publish`,
        payload: { versionId: version.id },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('PUBLICATION_PRECONDITION_FAILED');
      expect(res.json().error.message).toMatch(/country does not exist or is INACTIVE/i);
    });

    it('fails publication if resource type is INACTIVE', async () => {
      const { resource, version } = await createTestResource({
        resourceTypeId: inactiveTypeId,
        status: 'APPROVED',
        versionStatus: 'IN_REVIEW',
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${resource.id}/publish`,
        payload: { versionId: version.id },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('PUBLICATION_PRECONDITION_FAILED');
      expect(res.json().error.message).toMatch(/resource type does not exist or is INACTIVE/i);
    });

    it('fails publication if associated school is INACTIVE', async () => {
      const { resource, version } = await createTestResource({
        schoolId: inactiveSchoolId,
        status: 'APPROVED',
        versionStatus: 'IN_REVIEW',
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${resource.id}/publish`,
        payload: { versionId: version.id },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('PUBLICATION_PRECONDITION_FAILED');
      expect(res.json().error.message).toMatch(/associated school is invalid or inactive/i);
    });
  });

  describe('3. Atomic Publication & Single Published Version Invariant', () => {
    it('successfully and atomically publishes resource and version', async () => {
      const { resource, version } = await createTestResource({
        status: 'APPROVED',
        versionStatus: 'IN_REVIEW',
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${resource.id}/publish`,
        payload: { versionId: version.id },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json().data;
      expect(data.resource.status).toBe('PUBLISHED');
      expect(data.version.status).toBe('PUBLISHED');
      expect(data.version.publishedAt).not.toBeNull();
      expect(data.event.eventType).toBe('PUBLISHED');

      // Verify DB state
      const [dbRes] = await db.select().from(resources).where(eq(resources.id, resource.id));
      const [dbVer] = await db.select().from(resourceVersions).where(eq(resourceVersions.id, version.id));
      expect(dbRes.status).toBe('PUBLISHED');
      expect(dbVer.status).toBe('PUBLISHED');
      expect(dbVer.publishedAt).not.toBeNull();
    });

    it('enforces single published version per resource: rejects publishing a second version', async () => {
      // Resource already has a PUBLISHED version
      const { resource } = await createTestResource({
        status: 'PUBLISHED',
        versionStatus: 'PUBLISHED',
        publishedAt: new Date(),
      });

      // Insert candidate version 2 in IN_REVIEW
      const [v2] = await db
        .insert(resourceVersions)
        .values({
          resourceId: resource.id,
          versionNumber: 2,
          versionLabel: 'v2.0',
          title: 'Candidate Version 2',
          status: 'IN_REVIEW',
        })
        .returning();

      // Attempting to publish v2 must be rejected with 409 Conflict
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${resource.id}/publish`,
        payload: { versionId: v2.id },
      });

      // Resource must be APPROVED first, or if APPROVED already has published version
      expect([400, 409]).toContain(res.statusCode);

      // Now test with resource forced to APPROVED
      await db.update(resources).set({ status: 'APPROVED' }).where(eq(resources.id, resource.id));

      const res2 = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${resource.id}/publish`,
        payload: { versionId: v2.id },
      });

      expect(res2.statusCode).toBe(409);
      expect(res2.json().error.code).toBe('PUBLISHED_VERSION_ALREADY_EXISTS');
      expect(res2.json().error.message).toMatch(/already has a PUBLISHED version/i);
    });

    it('database partial unique index uq_resource_single_published_version blocks concurrent duplicate published versions', async () => {
      const { resource } = await createTestResource({
        status: 'PUBLISHED',
        versionStatus: 'PUBLISHED',
        publishedAt: new Date(),
      });

      // Attempt raw DB insert of second PUBLISHED version on same resource
      let indexViolationThrown = false;
      try {
        await db.insert(resourceVersions).values({
          resourceId: resource.id,
          versionNumber: 2,
          versionLabel: 'v2.0',
          title: 'Direct DB Duplicate Published Version',
          status: 'PUBLISHED',
          publishedAt: new Date(),
        });
      } catch (err: any) {
        indexViolationThrown = true;
        expect(err.cause?.constraint || err.constraint).toBe('uq_resource_single_published_version');
      }
      expect(indexViolationThrown).toBe(true);
    });
  });

  describe('4. Terminal ARCHIVED State & Immutability', () => {
    it('transitions a PUBLISHED resource to terminal ARCHIVED', async () => {
      const { resource } = await createTestResource({
        status: 'PUBLISHED',
        versionStatus: 'PUBLISHED',
        publishedAt: new Date(),
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${resource.id}/archive`,
        payload: { reason: 'Curriculum syllabus superseded' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.status).toBe('ARCHIVED');

      const [dbRes] = await db.select().from(resources).where(eq(resources.id, resource.id));
      expect(dbRes.status).toBe('ARCHIVED');
    });

    it('prohibits returning terminal ARCHIVED resource to DRAFT', async () => {
      const { resource } = await createTestResource({
        status: 'ARCHIVED',
        versionStatus: 'PUBLISHED',
        publishedAt: new Date(),
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${resource.id}/return-to-draft`,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_STATUS_TRANSITION');
      expect(res.json().error.message).toMatch(/ARCHIVED status is terminal/i);
    });

    it('prohibits submitting or approving an ARCHIVED resource', async () => {
      const { resource } = await createTestResource({
        status: 'ARCHIVED',
        versionStatus: 'PUBLISHED',
        publishedAt: new Date(),
      });

      const submitRes = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${resource.id}/submit`,
      });
      expect(submitRes.statusCode).toBe(400);

      const approveRes = await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${resource.id}/approve`,
      });
      expect(approveRes.statusCode).toBe(400);
    });
  });

  describe('5. Immutable Publication Events Ledger', () => {
    it('records publication events in chronological order and exposes GET /resources/:id/events', async () => {
      const { resource, version } = await createTestResource();

      // Submit
      await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${resource.id}/submit`,
        payload: { versionId: version.id },
      });

      // Approve
      await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${resource.id}/approve`,
      });

      // Publish
      await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${resource.id}/publish`,
        payload: { versionId: version.id },
      });

      // Archive
      await app.inject({
        method: 'POST',
        url: `/api/v1/resources/${resource.id}/archive`,
        payload: { reason: 'Archiving after full lifecycle test' },
      });

      const historyRes = await app.inject({
        method: 'GET',
        url: `/api/v1/resources/${resource.id}/events`,
      });

      expect(historyRes.statusCode).toBe(200);
      const events = historyRes.json().data;
      expect(events.length).toBeGreaterThanOrEqual(4);

      // Latest first
      expect(events[0].eventType).toBe('ARCHIVED');
      expect(events[1].eventType).toBe('PUBLISHED');
      expect(events[2].eventType).toBe('APPROVED');
      expect(events[3].eventType).toBe('SUBMITTED');
    });

    it('engine triggers prevent mutating or deleting publication events (immutable audit ledger)', async () => {
      const { resource } = await createTestResource({
        status: 'PUBLISHED',
        versionStatus: 'PUBLISHED',
        publishedAt: new Date(),
      });

      const [ev] = await db
        .insert(publicationEvents)
        .values({
          resourceId: resource.id,
          eventType: 'PUBLISHED',
          fromStatus: 'APPROVED',
          toStatus: 'PUBLISHED',
          reason: 'Initial publication event',
        })
        .returning();

      // Try raw SQL update on audit event
      let updateError = false;
      try {
        await db
          .update(publicationEvents)
          .set({ reason: 'Altered reason attempt' })
          .where(eq(publicationEvents.id, ev.id));
      } catch (err: any) {
        updateError = true;
        expect(err.cause?.message || err.message).toMatch(
          /publication_events rows are immutable audit records/i,
        );
      }
      expect(updateError).toBe(true);

      // Now verify engine trigger trg_prevent_publication_event_delete prevents deleting publication events
      let deleteError = false;
      try {
        await db
          .delete(publicationEvents)
          .where(eq(publicationEvents.id, ev.id));
      } catch (err: any) {
        deleteError = true;
        expect(err.cause?.message || err.message).toMatch(
          /publication_events rows are immutable audit records/i,
        );
      }
      expect(deleteError).toBe(true);
    });
  });
});
