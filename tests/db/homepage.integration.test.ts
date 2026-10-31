import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, getDatabasePool, closeDatabase } from '../../src/db/index.js';
import {
  auditLogs,
  calendarEvents,
  calendarEventTypes,
  calendars,
  countries,
  curricula,
  curriculumVersions,
  educationLevels,
  educationUpdateCategories,
  educationUpdates,
  grades,
  pathways,
  resourceFiles,
  resources,
  resourceTypes,
  resourceVersions,
  schools,
  subjects,
  topics,
  users,
} from '../../src/db/schemas.js';
import { seedRolesAndPermissions } from '../../src/db/seeds/roles-permissions.js';
import { DefaultAuditService } from '../../src/services/audit.service.js';
import { defaultGeographyService } from '../../src/services/geography.service.js';
import { HomepageCacheService } from '../../src/services/homepage-cache.js';
import {
  evaluateResourceProjection,
  evaluateSubjectProjection,
  evaluateTopicAncestry,
  type HomepageEligibilityDiagnostic,
  type TopicAncestryNode,
} from '../../src/services/homepage-eligibility.js';
import {
  evaluateGistPreflightSnapshot,
  runLiveGistPreflight,
} from '../../src/services/homepage-gist-preflight.js';
import { DefaultHomepageService } from '../../src/services/homepage.service.js';
import { DefaultHomepageAdminService } from '../../src/services/homepage-admin.service.js';
import { withDbRetry } from '../helpers/db-retry.js';

const isDbAvailable = Boolean(
  process.env.DATABASE_TEST_URL || process.env.DATABASE_URL,
);

async function expectSqlStateInSavepoint(
  fn: (client: import('pg').PoolClient) => Promise<void>,
  expectedSqlState: string,
): Promise<string> {
  const pool = getDatabasePool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let caught: any = null;
    try {
      await fn(client);
    } catch (err) {
      caught = err;
    }
    await client.query('ROLLBACK');
    expect(
      caught,
      `Expected PostgreSQL error with SQLSTATE ${expectedSqlState}, but query succeeded`,
    ).not.toBeNull();
    expect(caught.code).toBe(expectedSqlState);
    return String(caught.message ?? '');
  } finally {
    client.release();
  }
}

describe.skipIf(!isDbAvailable)(
  'Prompt 32: Homepage Intelligence Live PostgreSQL Constraints, Rollback xid8 Handshake, Eligibility Parity & Lifecycle Reconciliation',
  () => {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

    let virtualNow = new Date('2026-10-29T12:00:00.000Z');
    const auditService = new DefaultAuditService(db);
    const cacheService = new HomepageCacheService();
    const homepageService = new DefaultHomepageService(
      db,
      defaultGeographyService,
      cacheService,
      auditService,
    );
    const adminService = new DefaultHomepageAdminService(
      db,
      homepageService,
      cacheService,
      auditService,
      () => virtualNow,
    );

    const createdCountryIds: string[] = [];

    let actorId: string;
    let countryAId: string;
    let countryBId: string;
    let countryCId: string;

    // Seeded Country A taxonomy & entities
    let resourceTypeActiveId: string;
    let resourceTypeInactiveId: string;
    let curriculumActiveId: string;
    let versionCurrentId: string;
    let versionHistoricalId: string;
    let levelActiveId: string;
    let gradeActiveId: string;
    let pathwayActiveId: string;
    let pathwayInactiveId: string;
    let subjectEligibleId: string;
    let subjectInactiveId: string;
    let subjectInactivePathwayId: string;
    let topicDepth16LeafId: string;
    let topicDepth17LeafId: string;
    let topicUnderInactiveAncestorId: string;

    let resEligible1Id: string;
    let resEligible2Id: string;
    let resDraftId: string;
    let resNoFileId: string;
    let resFutureVersionId: string;
    let resInactiveTypeId: string;
    let resHistoricalVersionId: string;
    let resInactivePathwayId: string;
    let resDepth16TopicId: string;
    let resDepth17TopicId: string;
    let resInactiveTopicAncestorId: string;

    let updateCategoryActiveId: string;
    let updateCategoryInactiveId: string;
    let updateEligibleCountryAId: string;
    let updateGlobalMissingCountryId: string;
    let updateCountryBId: string;
    let updateFutureId: string;
    let updateInactiveCatId: string;

    let eventTypeActiveId: string;
    let officialCalendarAId: string;
    let schoolCalendarAId: string;
    let eventEligibleId: string;
    let eventPrivateId: string;
    let eventPastId: string;
    let eventSchoolScopeId: string;

    let fileCounter = 1;

    beforeAll(async () => {
      await withDbRetry(() => seedRolesAndPermissions(db));

      const existingCountries = await withDbRetry(() =>
        db.select().from(countries),
      );
      const usedIso = new Set(existingCountries.map((c) => c.isoCode));
      const pickIso = (prefixChar: string): string => {
        for (let i = 0; i < 26; i++) {
          for (let j = 0; j < 26; j++) {
            const code = `${prefixChar}${String.fromCharCode(65 + i)}${String.fromCharCode(65 + j)}`;
            if (!usedIso.has(code)) {
              usedIso.add(code);
              return code;
            }
          }
        }
        throw new Error('Exhausted test ISO codes');
      };

      const [cA] = await withDbRetry(() =>
        db
          .insert(countries)
          .values({
            name: `HPDB Country A ${suffix}`,
            isoCode: pickIso('H'),
            urlPrefix: `hpa-${suffix.slice(-6)}`,
            currencyCode: 'KES',
            status: 'ACTIVE',
          })
          .returning(),
      );
      countryAId = cA.id;
      createdCountryIds.push(countryAId);

      const [cB] = await withDbRetry(() =>
        db
          .insert(countries)
          .values({
            name: `HPDB Country B ${suffix}`,
            isoCode: pickIso('J'),
            urlPrefix: `hpb-${suffix.slice(-6)}`,
            currencyCode: 'UGX',
            status: 'ACTIVE',
          })
          .returning(),
      );
      countryBId = cB.id;
      createdCountryIds.push(countryBId);

      const [cC] = await withDbRetry(() =>
        db
          .insert(countries)
          .values({
            name: `HPDB Country C ${suffix}`,
            isoCode: pickIso('K'),
            urlPrefix: `hpc-${suffix.slice(-6)}`,
            currencyCode: 'TZS',
            status: 'ACTIVE',
          })
          .returning(),
      );
      countryCId = cC.id;
      createdCountryIds.push(countryCId);

      const [actor] = await withDbRetry(() =>
        db
          .insert(users)
          .values({
            email: `hpdb-actor-${suffix}@example.com`,
            displayName: 'Homepage DB Test Actor',
            status: 'ACTIVE',
          })
          .returning(),
      );
      actorId = actor.id;

      // Resource types
      const [rtActive] = await withDbRetry(() =>
        db
          .insert(resourceTypes)
          .values({
            code: `HP_ACT_${suffix}`.toUpperCase().slice(0, 30),
            name: `HP Active Type ${suffix}`,
            slug: `hp-act-type-${suffix}`,
            pillar: 'PAST_PAPERS',
            status: 'ACTIVE',
            sequenceOrder: 941,
          })
          .returning(),
      );
      resourceTypeActiveId = rtActive.id;

      const [rtInactive] = await withDbRetry(() =>
        db
          .insert(resourceTypes)
          .values({
            code: `HP_INA_${suffix}`.toUpperCase().slice(0, 30),
            name: `HP Inactive Type ${suffix}`,
            slug: `hp-ina-type-${suffix}`,
            pillar: 'LESSON_PLANS',
            status: 'INACTIVE',
            sequenceOrder: 942,
          })
          .returning(),
      );
      resourceTypeInactiveId = rtInactive.id;

      // Curricula & versions in Country A
      const [curAct] = await withDbRetry(() =>
        db
          .insert(curricula)
          .values({
            countryId: countryAId,
            name: `HP CBC ${suffix}`,
            slug: `hp-cbc-${suffix}`,
            code: 'CBC',
            status: 'ACTIVE',
          })
          .returning(),
      );
      curriculumActiveId = curAct.id;

      const [verCur] = await withDbRetry(() =>
        db
          .insert(curriculumVersions)
          .values({
            curriculumId: curriculumActiveId,
            countryId: countryAId,
            versionName: '2026 Current',
            slug: `v-cur-${suffix}`,
            status: 'CURRENT',
          })
          .returning(),
      );
      versionCurrentId = verCur.id;

      const [verHist] = await withDbRetry(() =>
        db
          .insert(curriculumVersions)
          .values({
            curriculumId: curriculumActiveId,
            countryId: countryAId,
            versionName: '2018 Historical',
            slug: `v-hist-${suffix}`,
            status: 'HISTORICAL',
          })
          .returning(),
      );
      versionHistoricalId = verHist.id;

      const [lvlAct] = await withDbRetry(() =>
        db
          .insert(educationLevels)
          .values({
            curriculumVersionId: versionCurrentId,
            name: 'Senior School',
            slug: `lvl-act-${suffix}`,
            sequenceOrder: 1,
            status: 'ACTIVE',
          })
          .returning(),
      );
      levelActiveId = lvlAct.id;

      const [grdAct] = await withDbRetry(() =>
        db
          .insert(grades)
          .values({
            curriculumVersionId: versionCurrentId,
            educationLevelId: levelActiveId,
            name: 'Grade 10',
            slug: `grd-10-${suffix}`,
            sequenceOrder: 1,
            status: 'ACTIVE',
          })
          .returning(),
      );
      gradeActiveId = grdAct.id;

      const [pwAct] = await withDbRetry(() =>
        db
          .insert(pathways)
          .values({
            curriculumVersionId: versionCurrentId,
            educationLevelId: levelActiveId,
            gradeId: gradeActiveId,
            name: 'STEM',
            slug: `pw-stem-${suffix}`,
            sequenceOrder: 1,
            status: 'ACTIVE',
          })
          .returning(),
      );
      pathwayActiveId = pwAct.id;

      const [pwIna] = await withDbRetry(() =>
        db
          .insert(pathways)
          .values({
            curriculumVersionId: versionCurrentId,
            educationLevelId: levelActiveId,
            gradeId: gradeActiveId,
            name: 'Inactive Pathway',
            slug: `pw-ina-${suffix}`,
            sequenceOrder: 2,
            status: 'INACTIVE',
          })
          .returning(),
      );
      pathwayInactiveId = pwIna.id;

      const [subElig] = await withDbRetry(() =>
        db
          .insert(subjects)
          .values({
            curriculumVersionId: versionCurrentId,
            educationLevelId: levelActiveId,
            gradeId: gradeActiveId,
            pathwayId: pathwayActiveId,
            name: 'Mathematics',
            slug: `math-${suffix}`,
            code: 'MATH10',
            sequenceOrder: 1,
            status: 'ACTIVE',
          })
          .returning(),
      );
      subjectEligibleId = subElig.id;

      const [subIna] = await withDbRetry(() =>
        db
          .insert(subjects)
          .values({
            curriculumVersionId: versionCurrentId,
            educationLevelId: levelActiveId,
            gradeId: gradeActiveId,
            name: 'Inactive Subject',
            slug: `ina-sub-${suffix}`,
            sequenceOrder: 1,
            status: 'INACTIVE',
          })
          .returning(),
      );
      subjectInactiveId = subIna.id;

      const [subInaPw] = await withDbRetry(() =>
        db
          .insert(subjects)
          .values({
            curriculumVersionId: versionCurrentId,
            educationLevelId: levelActiveId,
            gradeId: gradeActiveId,
            pathwayId: pathwayInactiveId,
            name: 'Subject Under Inactive Pathway',
            slug: `sub-ina-pw-${suffix}`,
            sequenceOrder: 1,
            status: 'ACTIVE',
          })
          .returning(),
      );
      subjectInactivePathwayId = subInaPw.id;

      // Build 17-node topic chain under subjectEligibleId: depth 1..16 (ELIGIBLE) + depth 17 (TOPIC_ANCESTRY_TOO_DEEP)
      let parentTopicId: string | null = null;
      for (let d = 1; d <= 17; d++) {
        const [tRow] = await withDbRetry(() =>
          db
            .insert(topics)
            .values({
              curriculumVersionId: versionCurrentId,
              subjectId: subjectEligibleId,
              parentId: parentTopicId,
              name: `Topic Depth ${d}`,
              slug: `topic-d${d}-${suffix}`,
              sequenceOrder: 1,
              status: 'ACTIVE',
            })
            .returning(),
        );
        parentTopicId = tRow.id;
        if (d === 16) {
          topicDepth16LeafId = tRow.id;
        }
        if (d === 17) {
          topicDepth17LeafId = tRow.id;
        }
      }

      // Topic chain with INACTIVE ancestor (depth 2 -> TOPIC_ANCESTOR_INACTIVE)
      const [tInaRoot] = await withDbRetry(() =>
        db
          .insert(topics)
          .values({
            curriculumVersionId: versionCurrentId,
            subjectId: subjectEligibleId,
            parentId: null,
            name: 'Inactive Root Topic',
            slug: `topic-ina-root-${suffix}`,
            sequenceOrder: 2,
            status: 'INACTIVE',
          })
          .returning(),
      );
      const [tChildOfIna] = await withDbRetry(() =>
        db
          .insert(topics)
          .values({
            curriculumVersionId: versionCurrentId,
            subjectId: subjectEligibleId,
            parentId: tInaRoot.id,
            name: 'Active Child Under Inactive Root',
            slug: `topic-child-ina-${suffix}`,
            sequenceOrder: 1,
            status: 'ACTIVE',
          })
          .returning(),
      );
      topicUnderInactiveAncestorId = tChildOfIna.id;

      // Helper to create resource + version + AVAILABLE file BEFORE transitioning version to PUBLISHED
      const createResourceWithVersion = async (opts: {
        slugTag: string;
        status?: string;
        resourceTypeId?: string;
        curriculumId?: string | null;
        curriculumVersionId?: string | null;
        educationLevelId?: string | null;
        gradeId?: string | null;
        pathwayId?: string | null;
        subjectId?: string | null;
        topicId?: string | null;
        versionStatus?: string;
        publishedAt?: Date | null;
        attachAvailableFile?: boolean;
      }): Promise<string> => {
        const [r] = await withDbRetry(() =>
          db
            .insert(resources)
            .values({
              countryId: countryAId,
              resourceTypeId: opts.resourceTypeId ?? resourceTypeActiveId,
              curriculumId:
                opts.curriculumId === undefined
                  ? curriculumActiveId
                  : opts.curriculumId,
              curriculumVersionId:
                opts.curriculumVersionId === undefined
                  ? versionCurrentId
                  : opts.curriculumVersionId,
              educationLevelId:
                opts.educationLevelId === undefined
                  ? levelActiveId
                  : opts.educationLevelId,
              gradeId:
                opts.gradeId === undefined ? gradeActiveId : opts.gradeId,
              pathwayId:
                opts.pathwayId === undefined ? pathwayActiveId : opts.pathwayId,
              subjectId:
                opts.subjectId === undefined
                  ? subjectEligibleId
                  : opts.subjectId,
              topicId: opts.topicId ?? null,
              title: `HP Resource ${opts.slugTag} ${suffix}`,
              slug: `hp-res-${opts.slugTag}-${suffix}`,
              status: opts.status ?? 'PUBLISHED',
              qualityLabel: 'VERIFIED',
            })
            .returning(),
        );

        const targetVerStatus = opts.versionStatus ?? 'PUBLISHED';
        const [vRow] = await withDbRetry(() =>
          db
            .insert(resourceVersions)
            .values({
              resourceId: r.id,
              versionNumber: 1,
              versionLabel: '1.0',
              title: `HP Resource ${opts.slugTag} v1`,
              status: 'DRAFT',
              qualityLabel: 'VERIFIED',
            })
            .returning(),
        );

        if (opts.attachAvailableFile !== false) {
          const fc = fileCounter++;
          await withDbRetry(() =>
            db.insert(resourceFiles).values({
              resourceVersionId: vRow.id,
              storageProvider: 'MEMORY',
              storageBucket: 'hpdb-test-bucket',
              objectKey: `resources/${r.id}/versions/${vRow.id}/f-${fc}-${suffix}.pdf`,
              originalFilename: `doc-${fc}.pdf`,
              fileExtension: 'pdf',
              fileType: 'MAIN_DOCUMENT',
              mimeType: 'application/pdf',
              fileSizeBytes: 2048,
              checksumSha256: fc.toString(16).padStart(64, 'c'),
              status: 'AVAILABLE',
              isPrimary: true,
              sequenceOrder: 1,
            }),
          );
        }

        if (targetVerStatus !== 'DRAFT') {
          await withDbRetry(() =>
            db
              .update(resourceVersions)
              .set({
                status: targetVerStatus,
                publishedAt:
                  opts.publishedAt === undefined
                    ? new Date('2026-10-01T00:00:00.000Z')
                    : opts.publishedAt,
              })
              .where(eq(resourceVersions.id, vRow.id)),
          );
        }
        return r.id;
      };

      resEligible1Id = await createResourceWithVersion({ slugTag: 'elig-1' });
      resEligible2Id = await createResourceWithVersion({ slugTag: 'elig-2' });
      resDraftId = await createResourceWithVersion({
        slugTag: 'draft',
        status: 'DRAFT',
        versionStatus: 'DRAFT',
        publishedAt: null,
      });
      resNoFileId = await createResourceWithVersion({
        slugTag: 'no-file',
        attachAvailableFile: false,
      });
      resFutureVersionId = await createResourceWithVersion({
        slugTag: 'future-ver',
        publishedAt: new Date('2027-05-01T00:00:00.000Z'),
      });
      resInactiveTypeId = await createResourceWithVersion({
        slugTag: 'ina-type',
        resourceTypeId: resourceTypeInactiveId,
      });

      const [lvlHist] = await withDbRetry(() =>
        db
          .insert(educationLevels)
          .values({
            curriculumVersionId: versionHistoricalId,
            name: 'Hist Level',
            slug: `lvl-hist-${suffix}`,
            sequenceOrder: 1,
            status: 'ACTIVE',
          })
          .returning(),
      );
      resHistoricalVersionId = await createResourceWithVersion({
        slugTag: 'hist-ver',
        curriculumVersionId: versionHistoricalId,
        educationLevelId: lvlHist.id,
        gradeId: null,
        pathwayId: null,
        subjectId: null,
      });

      resInactivePathwayId = await createResourceWithVersion({
        slugTag: 'ina-pw',
        pathwayId: pathwayInactiveId,
        subjectId: subjectInactivePathwayId,
      });
      resDepth16TopicId = await createResourceWithVersion({
        slugTag: 'd16-topic',
        topicId: topicDepth16LeafId,
      });
      resDepth17TopicId = await createResourceWithVersion({
        slugTag: 'd17-topic',
        topicId: topicDepth17LeafId,
      });
      resInactiveTopicAncestorId = await createResourceWithVersion({
        slugTag: 'ina-anc-topic',
        topicId: topicUnderInactiveAncestorId,
      });

      // Education Updates
      const [uCatAct] = await withDbRetry(() =>
        db
          .insert(educationUpdateCategories)
          .values({
            name: `HP Circulars ${suffix}`,
            slug: `hp-circ-${suffix}`,
            status: 'ACTIVE',
          })
          .returning(),
      );
      updateCategoryActiveId = uCatAct.id;

      const [uCatIna] = await withDbRetry(() =>
        db
          .insert(educationUpdateCategories)
          .values({
            name: `HP Inactive Cat ${suffix}`,
            slug: `hp-ina-cat-${suffix}`,
            status: 'INACTIVE',
          })
          .returning(),
      );
      updateCategoryInactiveId = uCatIna.id;

      const [updA] = await withDbRetry(() =>
        db
          .insert(educationUpdates)
          .values({
            countryId: countryAId,
            categoryId: updateCategoryActiveId,
            title: `Country A Update ${suffix}`,
            slug: `hp-upd-a-${suffix}`,
            summary: 'Official circular summary',
            body: 'Full body text',
            publicationStatus: 'PUBLISHED',
            publishedAt: new Date('2026-10-15T08:00:00.000Z'),
          })
          .returning(),
      );
      updateEligibleCountryAId = updA.id;

      const [updGlobal] = await withDbRetry(() =>
        db
          .insert(educationUpdates)
          .values({
            countryId: null,
            categoryId: updateCategoryActiveId,
            title: `Global Update ${suffix}`,
            slug: `hp-upd-glob-${suffix}`,
            body: 'Global advisory body',
            publicationStatus: 'PUBLISHED',
            publishedAt: new Date('2026-10-16T08:00:00.000Z'),
          })
          .returning(),
      );
      updateGlobalMissingCountryId = updGlobal.id;

      const [updB] = await withDbRetry(() =>
        db
          .insert(educationUpdates)
          .values({
            countryId: countryBId,
            categoryId: updateCategoryActiveId,
            title: `Country B Update ${suffix}`,
            slug: `hp-upd-b-${suffix}`,
            body: 'Country B body',
            publicationStatus: 'PUBLISHED',
            publishedAt: new Date('2026-10-16T08:00:00.000Z'),
          })
          .returning(),
      );
      updateCountryBId = updB.id;

      const [updFuture] = await withDbRetry(() =>
        db
          .insert(educationUpdates)
          .values({
            countryId: countryAId,
            categoryId: updateCategoryActiveId,
            title: `Future Update ${suffix}`,
            slug: `hp-upd-fut-${suffix}`,
            body: 'Future body',
            publicationStatus: 'PUBLISHED',
            publishedAt: new Date('2027-02-01T00:00:00.000Z'),
          })
          .returning(),
      );
      updateFutureId = updFuture.id;

      const [updInaCat] = await withDbRetry(() =>
        db
          .insert(educationUpdates)
          .values({
            countryId: countryAId,
            categoryId: updateCategoryInactiveId,
            title: `Inactive Cat Update ${suffix}`,
            slug: `hp-upd-inacat-${suffix}`,
            body: 'Inactive cat body',
            publicationStatus: 'PUBLISHED',
            publishedAt: new Date('2026-10-10T00:00:00.000Z'),
          })
          .returning(),
      );
      updateInactiveCatId = updInaCat.id;

      // Calendar highlights
      const [evType] = await withDbRetry(() =>
        db
          .insert(calendarEventTypes)
          .values({
            name: `HP Exam Milestone ${suffix}`,
            slug: `hp-exam-ms-${suffix}`,
            status: 'ACTIVE',
            displayOrder: 1,
          })
          .returning(),
      );
      eventTypeActiveId = evType.id;

      const [calOff] = await withDbRetry(() =>
        db
          .insert(calendars)
          .values({
            name: `HP Official Cal ${suffix}`,
            calendarScope: 'OFFICIAL',
            countryId: countryAId,
            academicYear: '2099',
            status: 'ACTIVE',
          })
          .returning(),
      );
      officialCalendarAId = calOff.id;

      const [sch] = await withDbRetry(() =>
        db
          .insert(schools)
          .values({
            countryId: countryAId,
            name: `HP Test School ${suffix}`,
            code: `HPSCH_${suffix}`.slice(0, 40),
            schoolType: 'SECONDARY',
            status: 'ACTIVE',
          })
          .returning(),
      );

      const [calSchool] = await withDbRetry(() =>
        db
          .insert(calendars)
          .values({
            name: `HP School Cal ${suffix}`,
            calendarScope: 'SCHOOL',
            countryId: countryAId,
            schoolId: sch.id,
            status: 'ACTIVE',
          })
          .returning(),
      );
      schoolCalendarAId = calSchool.id;

      const [evElig] = await withDbRetry(() =>
        db
          .insert(calendarEvents)
          .values({
            calendarId: officialCalendarAId,
            eventTypeId: eventTypeActiveId,
            title: `National Term 3 Exams ${suffix}`,
            startDate: '2026-11-15',
            endDate: '2026-11-25',
            sourceType: 'OFFICIAL',
            visibility: 'PUBLIC',
            status: 'ACTIVE',
          })
          .returning(),
      );
      eventEligibleId = evElig.id;

      const [evPriv] = await withDbRetry(() =>
        db
          .insert(calendarEvents)
          .values({
            calendarId: officialCalendarAId,
            eventTypeId: eventTypeActiveId,
            title: `Private Event ${suffix}`,
            startDate: '2026-11-15',
            sourceType: 'OFFICIAL',
            visibility: 'PRIVATE',
            status: 'ACTIVE',
          })
          .returning(),
      );
      eventPrivateId = evPriv.id;

      const [evPast] = await withDbRetry(() =>
        db
          .insert(calendarEvents)
          .values({
            calendarId: officialCalendarAId,
            eventTypeId: eventTypeActiveId,
            title: `Past Event ${suffix}`,
            startDate: '2026-01-10',
            endDate: '2026-01-12',
            sourceType: 'OFFICIAL',
            visibility: 'PUBLIC',
            status: 'ACTIVE',
          })
          .returning(),
      );
      eventPastId = evPast.id;

      const [evSch] = await withDbRetry(() =>
        db
          .insert(calendarEvents)
          .values({
            calendarId: schoolCalendarAId,
            eventTypeId: eventTypeActiveId,
            title: `School Scope Event ${suffix}`,
            startDate: '2026-11-20',
            sourceType: 'SCHOOL',
            visibility: 'PUBLIC',
            status: 'ACTIVE',
          })
          .returning(),
      );
      eventSchoolScopeId = evSch.id;
    }, 120000);

    afterAll(async () => {
      try {
        if (createdCountryIds.length > 0) {
          await withDbRetry(() =>
            db
              .update(calendars)
              .set({ status: 'INACTIVE' })
              .where(inArray(calendars.countryId, createdCountryIds)),
          ).catch(() => {});
          await withDbRetry(() =>
            db
              .update(countries)
              .set({ status: 'INACTIVE' })
              .where(inArray(countries.id, createdCountryIds)),
          ).catch(() => {});
        }
        await withDbRetry(() =>
          db.execute(sql`
            UPDATE "calendar"."calendars" AS cal
            SET "status" = 'INACTIVE'
            FROM "geography"."countries" AS c
            WHERE cal."country_id" = c."id"
              AND c."status" = 'INACTIVE'
              AND cal."status" = 'ACTIVE'
          `),
        ).catch(() => {});
      } finally {
        await closeDatabase();
      }
    }, 60000);

    describe('1. T-PREFLIGHT-GIST-READINESS-LIVE (C56 / C57 / C62 / C66 / CA-02)', () => {
      it('verifies live PostgreSQL GiST + btree_gist readiness and rejects wrong operator strategies or missing DB CREATE', async () => {
        const live = await runLiveGistPreflight(db);
        expect(live.evaluation.readyForMigration).toBe(true);
        expect(live.evaluation.status).toBe('INSTALLED_READY');
        expect(live.snapshot.coreTstzrangeOverlapReady).toBe(true);
        expect(live.snapshot.btreeGistUuidEqReady).toBe(true);

        // Negative live catalog query: strategy 19 instead of strategy 3 (RTOverlapStrategyNumber / BTEqualStrategyNumber)
        const wrongStrategyRes = await db.execute(sql`
          SELECT
            EXISTS (
              SELECT 1
              FROM pg_opclass oc
              JOIN pg_am am ON am.oid = oc.opcmethod
              JOIN pg_amop amop ON amop.amopfamily = oc.opcfamily
              JOIN pg_operator op ON op.oid = amop.amopopr
              WHERE am.amname = 'gist'
                AND oc.opcintype IN ('tstzrange'::regtype, 'anyrange'::regtype)
                AND oc.opcdefault = true
                AND op.oprname = '&&'
                AND amop.amopstrategy = 19
            ) AS bogus_range_strategy,
            EXISTS (
              SELECT 1
              FROM pg_opclass oc
              JOIN pg_am am ON am.oid = oc.opcmethod
              JOIN pg_amop amop ON amop.amopfamily = oc.opcfamily
              JOIN pg_operator op ON op.oid = amop.amopopr
              WHERE am.amname = 'gist'
                AND oc.opcintype = 'uuid'::regtype
                AND oc.opcdefault = true
                AND op.oprname = '='
                AND amop.amopstrategy = 19
            ) AS bogus_uuid_strategy
        `);
        const ws = wrongStrategyRes.rows[0] as Record<string, unknown>;
        expect(Boolean(ws.bogus_range_strategy)).toBe(false);
        expect(Boolean(ws.bogus_uuid_strategy)).toBe(false);

        expect(
          evaluateGistPreflightSnapshot({
            ...live.snapshot,
            coreTstzrangeOverlapReady: false,
          }).status,
        ).toBe('CORE_TSTZRANGE_OVERLAP_MISSING');

        expect(
          evaluateGistPreflightSnapshot({
            ...live.snapshot,
            btreeGistUuidEqReady: false,
          }).status,
        ).toBe('INSTALLED_BROKEN_OPCLASS');

        // C66 negative fixture: public CREATE + USAGE present, trusted extension, non-superuser, DB CREATE missing
        expect(
          evaluateGistPreflightSnapshot({
            ...live.snapshot,
            extInstalled: false,
            btreeGistUuidEqReady: false,
            extAvailable: true,
            aveSuperuser: true,
            aveTrusted: true,
            roleIsSuperuser: false,
            hasDbCreate: false,
            hasPublicCreate: true,
            hasPublicUsage: true,
          }),
        ).toEqual({
          readyForMigration: false,
          status: 'INSUFFICIENT_PRIVILEGES_DB_CREATE_MISSING',
          reason: expect.stringContaining('CREATE privilege on current_database()'),
        });
      });
    });

    describe('2. AC-C48-IMPL: Deterministic PostgreSQL SQLSTATE Enforcement (23502, 23503, 23505, 23P01, 23514)', () => {
      it('enforces 23502 NOT NULL, 23503 composite cross-country FKs, 23505 partial/composite uniques, 23P01 GiST schedule exclusion, and 23514 CHECK + trigger invariants', async () => {
        // 1. 23502 NOT NULL on title
        await expectSqlStateInSavepoint(async (client) => {
          await client.query(
            `INSERT INTO "content"."homepage_configurations"
              (country_id, version_number, title, status, created_by, updated_by)
             VALUES ($1, 1, NULL, 'DRAFT', $2, $2)`,
            [countryAId, actorId],
          );
        }, '23502');

        // 2. 23503 Composite cross-country FK on slots
        await expectSqlStateInSavepoint(async (client) => {
          const cfgRes = await client.query(
            `INSERT INTO "content"."homepage_configurations"
              (country_id, version_number, title, status, created_by, updated_by)
             VALUES ($1, 1, 'Cross FK Draft', 'DRAFT', $2, $2)
             RETURNING id`,
            [countryAId, actorId],
          );
          await client.query(
            `INSERT INTO "content"."homepage_configuration_slots"
              (configuration_id, country_id, slot_key, slot_order, entity_type, mode, section_title, max_items)
             VALUES ($1, $2, 'trending_resources', 1, 'RESOURCE', 'AUTOMATED', 'Trending', 6)`,
            [cfgRes.rows[0].id, countryBId],
          );
        }, '23503');

        // 3. 23505 Duplicate active DRAFT in same country
        await expectSqlStateInSavepoint(async (client) => {
          await client.query(
            `INSERT INTO "content"."homepage_configurations"
              (country_id, version_number, title, status, created_by, updated_by)
             VALUES ($1, 1, 'Draft One', 'DRAFT', $2, $2)`,
            [countryAId, actorId],
          );
          await client.query(
            `INSERT INTO "content"."homepage_configurations"
              (country_id, version_number, title, status, created_by, updated_by)
             VALUES ($1, 2, 'Draft Two', 'DRAFT', $2, $2)`,
            [countryAId, actorId],
          );
        }, '23505');

        // 4. 23P01 GiST exclusion on overlapping SCHEDULED windows in same country, while adjacent [t1,t2)+[t2,t3) and cross-country overlaps succeed
        await expectSqlStateInSavepoint(async (client) => {
          const insertScheduledWithSlots = async (
            cid: string,
            ver: number,
            startIso: string,
            untilIso: string,
          ) => {
            const cRes = await client.query(
              `INSERT INTO "content"."homepage_configurations"
                (country_id, version_number, title, status, scheduled_start_at, scheduled_until_at, created_by, updated_by)
               VALUES ($1, $2, $3, 'DRAFT', NULL, NULL, $4, $4)
               RETURNING id`,
              [cid, ver, `Sched v${ver}`, actorId],
            );
            const cfgId = cRes.rows[0].id;
            await client.query(
              `INSERT INTO "content"."homepage_configuration_slots"
                (configuration_id, country_id, slot_key, slot_order, entity_type, mode, section_title, max_items)
               VALUES
                ($1, $2, 'trending_resources', 1, 'RESOURCE', 'AUTOMATED', 'S1', 6),
                ($1, $2, 'most_downloaded_resources', 2, 'RESOURCE', 'AUTOMATED', 'S2', 6),
                ($1, $2, 'curated_resources', 3, 'RESOURCE', 'AUTOMATED', 'S3', 6),
                ($1, $2, 'education_updates', 4, 'UPDATE', 'AUTOMATED', 'S4', 6),
                ($1, $2, 'calendar_highlights', 5, 'CALENDAR_EVENT', 'AUTOMATED', 'S5', 6),
                ($1, $2, 'curriculum_shortcuts', 6, 'SUBJECT', 'AUTOMATED', 'S6', 6)`,
              [cfgId, cid],
            );
            await client.query(
              `UPDATE "content"."homepage_configurations"
               SET status = 'SCHEDULED',
                   scheduled_start_at = $2::timestamptz,
                   scheduled_until_at = $3::timestamptz
               WHERE id = $1`,
              [cfgId, startIso, untilIso],
            );
          };

          // First window [10:00, 14:00) in Country A -> OK
          await insertScheduledWithSlots(
            countryAId,
            1,
            '2027-06-01T10:00:00.000Z',
            '2027-06-01T14:00:00.000Z',
          );
          // Adjacent half-open [14:00, 18:00) in Country A -> OK!
          await insertScheduledWithSlots(
            countryAId,
            2,
            '2027-06-01T14:00:00.000Z',
            '2027-06-01T18:00:00.000Z',
          );
          // Identical window [10:00, 14:00) in Country B -> OK!
          await insertScheduledWithSlots(
            countryBId,
            1,
            '2027-06-01T10:00:00.000Z',
            '2027-06-01T14:00:00.000Z',
          );
          // Overlapping [12:00, 16:00) in Country A -> MUST FAIL WITH 23P01!
          await insertScheduledWithSlots(
            countryAId,
            3,
            '2027-06-01T12:00:00.000Z',
            '2027-06-01T16:00:00.000Z',
          );
        }, '23P01');

        // 5. 23514 Infinity timestamp check
        await expectSqlStateInSavepoint(async (client) => {
          const cRes = await client.query(
            `INSERT INTO "content"."homepage_configurations"
              (country_id, version_number, title, status, created_by, updated_by)
             VALUES ($1, 1, 'Inf Sched', 'DRAFT', $2, $2)
             RETURNING id`,
            [countryAId, actorId],
          );
          await client.query(
            `UPDATE "content"."homepage_configurations"
             SET status = 'SCHEDULED', scheduled_start_at = 'infinity'::timestamptz
             WHERE id = $1`,
            [cRes.rows[0].id],
          );
        }, '23514');

        // 6. 23514 Entity XOR violation on items
        await expectSqlStateInSavepoint(async (client) => {
          const cfgRes = await client.query(
            `INSERT INTO "content"."homepage_configurations"
              (country_id, version_number, title, status, created_by, updated_by)
             VALUES ($1, 1, 'XOR Draft', 'DRAFT', $2, $2)
             RETURNING id`,
            [countryAId, actorId],
          );
          const slotRes = await client.query(
            `INSERT INTO "content"."homepage_configuration_slots"
              (configuration_id, country_id, slot_key, slot_order, entity_type, mode, section_title, max_items)
             VALUES ($1, $2, 'trending_resources', 1, 'RESOURCE', 'CURATED_HYBRID', 'S1', 6)
             RETURNING id`,
            [cfgRes.rows[0].id, countryAId],
          );
          await client.query(
            `INSERT INTO "content"."homepage_configuration_items"
              (slot_id, configuration_id, country_id, position, entity_type, resource_id, subject_id, created_by)
             VALUES ($1, $2, $3, 1, 'RESOURCE', $4, $5, $6)`,
            [
              slotRes.rows[0].id,
              cfgRes.rows[0].id,
              countryAId,
              resEligible1Id,
              subjectEligibleId,
              actorId,
            ],
          );
        }, '23514');

        // 7. 23514 Physical DELETE blocked on homepage_configurations
        await expectSqlStateInSavepoint(async (client) => {
          const cfgRes = await client.query(
            `INSERT INTO "content"."homepage_configurations"
              (country_id, version_number, title, status, created_by, updated_by)
             VALUES ($1, 1, 'No Delete Draft', 'DRAFT', $2, $2)
             RETURNING id`,
            [countryAId, actorId],
          );
          await client.query(
            `DELETE FROM "content"."homepage_configurations" WHERE id = $1`,
            [cfgRes.rows[0].id],
          );
        }, '23514');

        // 8. 23514 Slot/item mutation blocked once configuration leaves DRAFT
        await expectSqlStateInSavepoint(async (client) => {
          const cfgRes = await client.query(
            `INSERT INTO "content"."homepage_configurations"
              (country_id, version_number, title, status, created_by, updated_by)
             VALUES ($1, 1, 'Mut Guard Draft', 'DRAFT', $2, $2)
             RETURNING id`,
            [countryAId, actorId],
          );
          const cfgId = cfgRes.rows[0].id;
          await client.query(
            `INSERT INTO "content"."homepage_configuration_slots"
              (configuration_id, country_id, slot_key, slot_order, entity_type, mode, section_title, max_items)
             VALUES
              ($1, $2, 'trending_resources', 1, 'RESOURCE', 'AUTOMATED', 'S1', 6),
              ($1, $2, 'most_downloaded_resources', 2, 'RESOURCE', 'AUTOMATED', 'S2', 6),
              ($1, $2, 'curated_resources', 3, 'RESOURCE', 'AUTOMATED', 'S3', 6),
              ($1, $2, 'education_updates', 4, 'UPDATE', 'AUTOMATED', 'S4', 6),
              ($1, $2, 'calendar_highlights', 5, 'CALENDAR_EVENT', 'AUTOMATED', 'S5', 6),
              ($1, $2, 'curriculum_shortcuts', 6, 'SUBJECT', 'AUTOMATED', 'S6', 6)`,
            [cfgId, countryAId],
          );
          await client.query(
            `UPDATE "content"."homepage_configurations"
             SET status = 'PUBLISHED', published_at = NOW(), published_by = $2
             WHERE id = $1`,
            [cfgId, actorId],
          );
          await client.query(
            `UPDATE "content"."homepage_configuration_slots"
             SET section_title = 'Illegal Post-Publish Edit'
             WHERE configuration_id = $1 AND slot_key = 'trending_resources'`,
            [cfgId],
          );
        }, '23514');

        // 9. 23514 Deferred completeness trigger rejects MANUAL_OVERRIDE with 0 items on PUBLISH
        const emptyOverrideMsg = await expectSqlStateInSavepoint(
          async (client) => {
            const cfgRes = await client.query(
              `INSERT INTO "content"."homepage_configurations"
                (country_id, version_number, title, status, created_by, updated_by)
               VALUES ($1, 1, 'Empty Manual Draft', 'DRAFT', $2, $2)
               RETURNING id`,
              [countryAId, actorId],
            );
            const cfgId = cfgRes.rows[0].id;
            await client.query(
              `INSERT INTO "content"."homepage_configuration_slots"
                (configuration_id, country_id, slot_key, slot_order, entity_type, mode, section_title, max_items)
               VALUES
                ($1, $2, 'trending_resources', 1, 'RESOURCE', 'MANUAL_OVERRIDE', 'S1', 6),
                ($1, $2, 'most_downloaded_resources', 2, 'RESOURCE', 'AUTOMATED', 'S2', 6),
                ($1, $2, 'curated_resources', 3, 'RESOURCE', 'AUTOMATED', 'S3', 6),
                ($1, $2, 'education_updates', 4, 'UPDATE', 'AUTOMATED', 'S4', 6),
                ($1, $2, 'calendar_highlights', 5, 'CALENDAR_EVENT', 'AUTOMATED', 'S5', 6),
                ($1, $2, 'curriculum_shortcuts', 6, 'SUBJECT', 'AUTOMATED', 'S6', 6)`,
              [cfgId, countryAId],
            );
            await client.query(
              `UPDATE "content"."homepage_configurations"
               SET status = 'PUBLISHED', published_at = NOW(), published_by = $2
               WHERE id = $1`,
              [cfgId, actorId],
            );
            await client.query(`SET CONSTRAINTS ALL IMMEDIATE`);
          },
          '23514',
        );
        expect(String(emptyOverrideMsg).toUpperCase()).toContain('MANUAL_OVERRIDE');

        // 10. 23514 Deferred completeness trigger rejects ineligible DRAFT resource on PUBLISH
        const ineligMsg = await expectSqlStateInSavepoint(async (client) => {
          const cfgRes = await client.query(
            `INSERT INTO "content"."homepage_configurations"
              (country_id, version_number, title, status, created_by, updated_by)
             VALUES ($1, 1, 'Ineligible Item Draft', 'DRAFT', $2, $2)
             RETURNING id`,
            [countryAId, actorId],
          );
          const cfgId = cfgRes.rows[0].id;
          const s1Res = await client.query(
            `INSERT INTO "content"."homepage_configuration_slots"
              (configuration_id, country_id, slot_key, slot_order, entity_type, mode, section_title, max_items)
             VALUES
              ($1, $2, 'trending_resources', 1, 'RESOURCE', 'CURATED_HYBRID', 'S1', 6),
              ($1, $2, 'most_downloaded_resources', 2, 'RESOURCE', 'AUTOMATED', 'S2', 6),
              ($1, $2, 'curated_resources', 3, 'RESOURCE', 'AUTOMATED', 'S3', 6),
              ($1, $2, 'education_updates', 4, 'UPDATE', 'AUTOMATED', 'S4', 6),
              ($1, $2, 'calendar_highlights', 5, 'CALENDAR_EVENT', 'AUTOMATED', 'S5', 6),
              ($1, $2, 'curriculum_shortcuts', 6, 'SUBJECT', 'AUTOMATED', 'S6', 6)
             RETURNING id, slot_key`,
            [cfgId, countryAId],
          );
          const s1Id = s1Res.rows.find(
            (r) => r.slot_key === 'trending_resources',
          )!.id;
          await client.query(
            `INSERT INTO "content"."homepage_configuration_items"
              (slot_id, configuration_id, country_id, position, entity_type, resource_id, created_by)
             VALUES ($1, $2, $3, 1, 'RESOURCE', $4, $5)`,
            [s1Id, cfgId, countryAId, resDraftId, actorId],
          );
          await client.query(
            `UPDATE "content"."homepage_configurations"
             SET status = 'PUBLISHED', published_at = NOW(), published_by = $2
             WHERE id = $1`,
            [cfgId, actorId],
          );
          await client.query(`SET CONSTRAINTS ALL IMMEDIATE`);
        }, '23514');
        expect(ineligMsg).toContain('RESOURCE_NOT_PUBLISHED');
      });
    });

    describe('3. T-ELIGIBILITY-LIVE-PARITY (C52 / C54 / C60): SQL vs TypeScript Diagnostic Parity', () => {
      it('matches live SQL fn_evaluate_homepage_entity_eligibility and projection helpers 1-for-1 with TypeScript evaluators', async () => {
        const evalAtIso = '2026-10-29T12:00:00.000Z';

        const checkLiveDiag = async (
          entityType: 'RESOURCE' | 'UPDATE' | 'CALENDAR_EVENT' | 'SUBJECT',
          entityId: string,
        ): Promise<HomepageEligibilityDiagnostic> => {
          const res = await db.execute(sql`
            SELECT "content"."fn_evaluate_homepage_entity_eligibility"(
              ${countryAId}::uuid,
              ${entityType}::"content"."homepage_entity_type",
              ${entityId}::uuid,
              ${evalAtIso}::timestamptz
            ) AS diag
          `);
          return (res.rows[0] as any).diag as HomepageEligibilityDiagnostic;
        };

        // Resource checks
        expect(await checkLiveDiag('RESOURCE', resEligible1Id)).toBe('ELIGIBLE');
        expect(await checkLiveDiag('RESOURCE', resDraftId)).toBe(
          'RESOURCE_NOT_PUBLISHED',
        );
        expect(await checkLiveDiag('RESOURCE', resNoFileId)).toBe(
          'NO_AVAILABLE_FILE',
        );
        expect(await checkLiveDiag('RESOURCE', resFutureVersionId)).toBe(
          'PUBLISHED_VERSION_FUTURE_DATED',
        );
        expect(await checkLiveDiag('RESOURCE', resInactiveTypeId)).toBe(
          'RESOURCE_TYPE_INACTIVE',
        );
        expect(await checkLiveDiag('RESOURCE', resHistoricalVersionId)).toBe(
          'CURRICULUM_VERSION_NOT_CURRENT',
        );
        expect(await checkLiveDiag('RESOURCE', resInactivePathwayId)).toBe(
          'PATHWAY_INACTIVE',
        );
        expect(await checkLiveDiag('RESOURCE', resDepth16TopicId)).toBe(
          'ELIGIBLE',
        );
        expect(await checkLiveDiag('RESOURCE', resDepth17TopicId)).toBe(
          'TOPIC_ANCESTRY_TOO_DEEP',
        );
        expect(await checkLiveDiag('RESOURCE', resInactiveTopicAncestorId)).toBe(
          'TOPIC_ANCESTOR_INACTIVE',
        );

        // Update checks
        expect(await checkLiveDiag('UPDATE', updateEligibleCountryAId)).toBe(
          'ELIGIBLE',
        );
        expect(
          await checkLiveDiag('UPDATE', updateGlobalMissingCountryId),
        ).toBe('UPDATE_COUNTRY_MISSING');
        expect(await checkLiveDiag('UPDATE', updateCountryBId)).toBe(
          'COUNTRY_MISMATCH',
        );
        expect(await checkLiveDiag('UPDATE', updateFutureId)).toBe(
          'UPDATE_FUTURE_DATED',
        );
        expect(await checkLiveDiag('UPDATE', updateInactiveCatId)).toBe(
          'UPDATE_CATEGORY_INACTIVE',
        );

        // Calendar Event checks
        expect(await checkLiveDiag('CALENDAR_EVENT', eventEligibleId)).toBe(
          'ELIGIBLE',
        );
        expect(await checkLiveDiag('CALENDAR_EVENT', eventPrivateId)).toBe(
          'CALENDAR_EVENT_NOT_PUBLIC',
        );
        expect(await checkLiveDiag('CALENDAR_EVENT', eventPastId)).toBe(
          'CALENDAR_EVENT_PAST',
        );
        expect(await checkLiveDiag('CALENDAR_EVENT', eventSchoolScopeId)).toBe(
          'CALENDAR_NOT_OFFICIAL',
        );

        // Subject checks
        expect(await checkLiveDiag('SUBJECT', subjectEligibleId)).toBe(
          'ELIGIBLE',
        );
        expect(await checkLiveDiag('SUBJECT', subjectInactiveId)).toBe(
          'SUBJECT_INACTIVE',
        );
        expect(await checkLiveDiag('SUBJECT', subjectInactivePathwayId)).toBe(
          'PATHWAY_INACTIVE',
        );

        // Tier-2 DDL-blocked projection parity (C60 E-39a..b, E-40a..b, E-41a..b)
        const baseUuid = '10000000-0000-4000-8000-000000000001';
        const otherUuid = '20000000-0000-4000-8000-000000000002';

        // E-39b on fn_diag_homepage_resource_projection (42 args): pathway education_level_id mismatch -> PATHWAY_MISMATCH
        const sqlResE39b = await db.execute(sql`
          SELECT "content"."fn_diag_homepage_resource_projection"(
            ${baseUuid}::uuid,
            '2026-10-29T12:00:00Z'::timestamptz,
            true,
            ${baseUuid}::uuid,
            'PUBLISHED',
            'ACTIVE',
            'ACTIVE',
            NULL::uuid, NULL::uuid, NULL::text,
            1,
            '2026-10-01T00:00:00Z'::timestamptz,
            1,
            ${baseUuid}::uuid, ${baseUuid}::uuid, 'ACTIVE',
            ${baseUuid}::uuid, ${baseUuid}::uuid, ${baseUuid}::uuid, 'CURRENT',
            ${baseUuid}::uuid, ${baseUuid}::uuid, 'ACTIVE',
            ${baseUuid}::uuid, ${baseUuid}::uuid, ${baseUuid}::uuid, 'ACTIVE',
            ${baseUuid}::uuid, ${baseUuid}::uuid, ${otherUuid}::uuid, ${baseUuid}::uuid, 'ACTIVE',
            NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text,
            NULL::uuid, NULL::uuid, NULL::uuid,
            'ELIGIBLE'
          ) AS diag
        `);
        const tsResE39b = evaluateResourceProjection({
          targetCountryId: baseUuid,
          evalTime: new Date('2026-10-29T12:00:00Z'),
          resExists: true,
          resCountryId: baseUuid,
          resStatus: 'PUBLISHED',
          countryStatus: 'ACTIVE',
          rtStatus: 'ACTIVE',
          pubVersionCount: 1,
          pubPublishedAt: new Date('2026-10-01T00:00:00Z'),
          availFileCount: 1,
          curriculumId: baseUuid,
          curCountryId: baseUuid,
          curStatus: 'ACTIVE',
          curriculumVersionId: baseUuid,
          cvCountryId: baseUuid,
          cvCurriculumId: baseUuid,
          cvStatus: 'CURRENT',
          educationLevelId: baseUuid,
          elCvId: baseUuid,
          elStatus: 'ACTIVE',
          gradeId: baseUuid,
          gCvId: baseUuid,
          gElId: baseUuid,
          gStatus: 'ACTIVE',
          pathwayId: baseUuid,
          pCvId: baseUuid,
          pElId: otherUuid,
          pGradeId: baseUuid,
          pStatus: 'ACTIVE',
          topicAncestryDiag: 'ELIGIBLE',
        });
        expect((sqlResE39b.rows[0] as any).diag).toBe('PATHWAY_MISMATCH');
        expect((sqlResE39b.rows[0] as any).diag).toBe(tsResE39b);

        // E-41a on fn_diag_homepage_subject_projection (24 args): pathway_id present, p_status NULL -> PATHWAY_INACTIVE
        const sqlSubE41a = await db.execute(sql`
          SELECT "content"."fn_diag_homepage_subject_projection"(
            ${baseUuid}::uuid,
            '2026-10-29T12:00:00Z'::timestamptz,
            true,
            'ACTIVE',
            ${baseUuid}::uuid, ${baseUuid}::uuid, 'ACTIVE',
            ${baseUuid}::uuid, ${baseUuid}::uuid, ${baseUuid}::uuid, 'CURRENT',
            ${baseUuid}::uuid, ${baseUuid}::uuid, 'ACTIVE',
            ${baseUuid}::uuid, ${baseUuid}::uuid, ${baseUuid}::uuid, 'ACTIVE',
            ${baseUuid}::uuid, ${baseUuid}::uuid, ${baseUuid}::uuid, ${baseUuid}::uuid, NULL::text,
            'ACTIVE'
          ) AS diag
        `);
        const tsSubE41a = evaluateSubjectProjection({
          targetCountryId: baseUuid,
          evalTime: new Date('2026-10-29T12:00:00Z'),
          subExists: true,
          countryStatus: 'ACTIVE',
          curId: baseUuid,
          curCountryId: baseUuid,
          curStatus: 'ACTIVE',
          sCvId: baseUuid,
          cvCountryId: baseUuid,
          cvCurriculumId: baseUuid,
          cvStatus: 'CURRENT',
          sElId: baseUuid,
          elCvId: baseUuid,
          elStatus: 'ACTIVE',
          sGradeId: baseUuid,
          gCvId: baseUuid,
          gElId: baseUuid,
          gStatus: 'ACTIVE',
          sPathwayId: baseUuid,
          pCvId: baseUuid,
          pElId: baseUuid,
          pGradeId: baseUuid,
          pStatus: null,
          sStatus: 'ACTIVE',
        });
        expect((sqlSubE41a.rows[0] as any).diag).toBe('PATHWAY_INACTIVE');
        expect((sqlSubE41a.rows[0] as any).diag).toBe(tsSubE41a);

        // Topic ancestry parity on live depth-16, depth-17, and missing leaf + depth-16 missing parent map
        const liveD16Anc = await db.execute(sql`
          SELECT "content"."fn_diag_homepage_topic_ancestry"(
            ${topicDepth16LeafId}::uuid,
            ${subjectEligibleId}::uuid,
            ${versionCurrentId}::uuid
          ) AS diag
        `);
        expect((liveD16Anc.rows[0] as any).diag).toBe('ELIGIBLE');

        const liveD17Anc = await db.execute(sql`
          SELECT "content"."fn_diag_homepage_topic_ancestry"(
            ${topicDepth17LeafId}::uuid,
            ${subjectEligibleId}::uuid,
            ${versionCurrentId}::uuid
          ) AS diag
        `);
        expect((liveD17Anc.rows[0] as any).diag).toBe(
          'TOPIC_ANCESTRY_TOO_DEEP',
        );

        const missingTopicId = '99999999-9999-4999-8999-999999999999';
        const liveMissingAnc = await db.execute(sql`
          SELECT "content"."fn_diag_homepage_topic_ancestry"(
            ${missingTopicId}::uuid,
            ${subjectEligibleId}::uuid,
            ${versionCurrentId}::uuid
          ) AS diag
        `);
        expect((liveMissingAnc.rows[0] as any).diag).toBe(
          'TOPIC_ANCESTOR_MISSING',
        );

        // Verify TypeScript evaluateTopicAncestryMap reports TOPIC_ANCESTOR_MISSING on missing parent at depth 16
        const tsMap = new Map<string, TopicAncestryNode>();
        let prevId = missingTopicId;
        const ids: string[] = [];
        for (let i = 16; i >= 1; i--) {
          const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
          ids.unshift(id);
          tsMap.set(id, {
            id,
            parentId: prevId,
            subjectId: subjectEligibleId,
            curriculumVersionId: versionCurrentId,
            status: 'ACTIVE',
          });
          prevId = id;
        }
        expect(
          evaluateTopicAncestry(
            ids[0],
            subjectEligibleId,
            versionCurrentId,
            tsMap,
          ),
        ).toBe('TOPIC_ANCESTOR_MISSING');

        // DDL barrier check: pathways.status NOT NULL -> 23502
        await expectSqlStateInSavepoint(async (c) => {
          await c.query(
            `INSERT INTO "taxonomy"."pathways"
              (curriculum_version_id, education_level_id, grade_id, name, slug, sequence_order, status)
             VALUES ($1, $2, $3, 'Null Status PW', 'null-pw', 99, NULL)`,
            [versionCurrentId, levelActiveId, gradeActiveId],
          );
        }, '23502');
      });
    });

    describe('4. AC-C45-IMPL: Atomic xid8 Rollback Pairing, Handshake & Immutability (D3)', () => {
      it('executes clone-forward rollback in a single xid8 transaction and rejects unpaired ROLLED_BACK or ledger mutations', async () => {
        const actorCtx = {
          actorUserId: actorId,
          actorSnapshot: {
            actorType: 'AUTHENTICATED' as const,
            actorRole: 'system_admin',
            emailDomain: 'example.com',
          },
          requestId: `req-rb-${suffix}`.slice(0, 64),
        };

        // Create & publish v1 in Country A
        virtualNow = new Date('2026-10-29T12:00:00.000Z');
        const v1Draft = await adminService.createDraft(
          {
            countryId: countryAId,
            title: 'Country A v1 Baseline',
            slots: [
              {
                slotKey: 'curated_resources',
                mode: 'MANUAL_OVERRIDE',
                sectionTitle: 'v1 Curated Picks',
                maxItems: 4,
                items: [{ position: 1, entityId: resEligible1Id }],
              },
            ],
          },
          actorCtx,
        );
        const v1Pub = await adminService.publishConfiguration(
          v1Draft.id,
          {},
          actorCtx,
        );
        expect(v1Pub.versionNumber).toBe(1);
        expect(v1Pub.status).toBe('PUBLISHED');

        // Create & publish v2 in Country A (supersedes v1)
        virtualNow = new Date('2026-10-29T12:05:00.000Z');
        const v2Draft = await adminService.createDraft(
          {
            countryId: countryAId,
            title: 'Country A v2 Replacement',
            slots: [
              {
                slotKey: 'curated_resources',
                mode: 'MANUAL_OVERRIDE',
                sectionTitle: 'v2 Curated Picks',
                maxItems: 6,
                items: [{ position: 1, entityId: resEligible2Id }],
              },
            ],
          },
          actorCtx,
        );
        const v2Pub = await adminService.publishConfiguration(
          v2Draft.id,
          {},
          actorCtx,
        );
        expect(v2Pub.versionNumber).toBe(2);
        expect(v2Pub.status).toBe('PUBLISHED');

        const v1AfterSupersede = await adminService.getConfigurationDetail(
          v1Pub.id,
        );
        expect(v1AfterSupersede.status).toBe('SUPERSEDED');
        expect(v1AfterSupersede.supersededByConfigurationId).toBe(v2Pub.id);

        // Rollback Country A from v2 back to v1 -> produces v3 PUBLISHED clone + v2 ROLLED_BACK + immutable xid8 ledger row
        virtualNow = new Date('2026-10-29T12:10:00.000Z');
        const rbResult = await adminService.rollbackConfiguration(
          {
            countryId: countryAId,
            targetConfigurationId: v1Pub.id,
            reason: 'Editorial regression in v2 curated picks',
          },
          actorCtx,
        );

        expect(rbResult.rolledBackConfigurationId).toBe(v2Pub.id);
        expect(rbResult.targetSourceConfigurationId).toBe(v1Pub.id);
        expect(rbResult.cloneConfiguration.versionNumber).toBe(3);
        expect(rbResult.cloneConfiguration.status).toBe('PUBLISHED');
        expect(rbResult.cloneConfiguration.restoredFromConfigurationId).toBe(
          v1Pub.id,
        );
        expect(rbResult.cloneConfiguration.scheduledStartAt).toBeNull();
        expect(rbResult.cloneConfiguration.scheduledUntilAt).toBeNull();

        const v2AfterRb = await adminService.getConfigurationDetail(v2Pub.id);
        expect(v2AfterRb.status).toBe('ROLLED_BACK');
        expect(v2AfterRb.supersededByConfigurationId).toBeNull();
        expect(
          v2AfterRb.rollbackProvenance.asRolledBackPredecessor
            ?.cloneConfigurationId,
        ).toBe(rbResult.cloneConfiguration.id);

        expect(rbResult.rollbackLedger.rolledBackConfigurationId).toBe(
          v2Pub.id,
        );
        expect(rbResult.rollbackLedger.targetSourceConfigurationId).toBe(
          v1Pub.id,
        );
        expect(rbResult.rollbackLedger.cloneConfigurationId).toBe(
          rbResult.cloneConfiguration.id,
        );
        expect(Number(rbResult.rollbackLedger.txid)).toBeGreaterThan(0);

        // Verify immutable ledger blocks UPDATE and DELETE with 23514
        await expectSqlStateInSavepoint(async (client) => {
          await client.query(
            `UPDATE "content"."homepage_configuration_rollbacks"
             SET reason = 'Tampered reason'
             WHERE id = $1`,
            [rbResult.rollbackLedger.id],
          );
        }, '23514');

        await expectSqlStateInSavepoint(async (client) => {
          await client.query(
            `DELETE FROM "content"."homepage_configuration_rollbacks"
             WHERE id = $1`,
            [rbResult.rollbackLedger.id],
          );
        }, '23514');

        // Verify deferred handshake rejects transitioning v3 PUBLISHED -> ROLLED_BACK without ledger row
        await expectSqlStateInSavepoint(async (client) => {
          await client.query(
            `UPDATE "content"."homepage_configurations"
             SET status = 'ROLLED_BACK',
                 rolled_back_at = NOW(),
                 rolled_back_by = $2,
                 rollback_reason = 'Unpaired rollback attempt'
             WHERE id = $1`,
            [rbResult.cloneConfiguration.id, actorId],
          );
          await client.query(`SET CONSTRAINTS ALL IMMEDIATE`);
        }, '23514');
      });
    });

    describe('5. Lazy Schedule Promotion, D4 Expired Schedule Archival & R17-03 Underfill Recovery', () => {
      it('promotes due SCHEDULED configurations, archives expired scheduled_until_at to DEFAULT_FALLBACK (D4), and recovers cached underfill once per 5s cooldown (R17-03)', async () => {
        const actorCtx = {
          actorUserId: actorId,
          actorSnapshot: {
            actorType: 'AUTHENTICATED' as const,
            actorRole: 'system_admin',
            emailDomain: 'example.com',
          },
          requestId: `req-d4-${suffix}`.slice(0, 64),
        };

        // Seed 8 eligible resources (each with an AVAILABLE file) in Country C
        const seedCountryCRes = async (idx: number) => {
          const [r] = await db
            .insert(resources)
            .values({
              countryId: countryCId,
              resourceTypeId: resourceTypeActiveId,
              title: `Country C Res ${idx} ${suffix}`,
              slug: `cc-res-${idx}-${suffix}`,
              status: 'PUBLISHED',
              qualityLabel: 'VERIFIED',
            })
            .returning();
          const [vDraft] = await db
            .insert(resourceVersions)
            .values({
              resourceId: r.id,
              versionNumber: 1,
              versionLabel: '1.0',
              title: `Country C Res ${idx} v1`,
              status: 'DRAFT',
              qualityLabel: 'VERIFIED',
            })
            .returning();
          const fc = fileCounter++;
          await db.insert(resourceFiles).values({
            resourceVersionId: vDraft.id,
            storageProvider: 'MEMORY',
            storageBucket: 'hpdb-test-bucket',
            objectKey: `resources/${r.id}/versions/${vDraft.id}/c-${fc}-${suffix}.pdf`,
            originalFilename: `c-${fc}.pdf`,
            fileExtension: 'pdf',
            fileType: 'MAIN_DOCUMENT',
            mimeType: 'application/pdf',
            fileSizeBytes: 1024,
            checksumSha256: fc.toString(16).padStart(64, 'd'),
            status: 'AVAILABLE',
            isPrimary: true,
            sequenceOrder: 1,
          });
          await db
            .update(resourceVersions)
            .set({
              status: 'PUBLISHED',
              publishedAt: new Date(
                Date.parse('2026-10-01T00:00:00.000Z') + idx * 60_000,
              ),
            })
            .where(eq(resourceVersions.id, vDraft.id));
          return r.id;
        };

        const cResIds: string[] = [];
        for (let i = 1; i <= 8; i++) {
          cResIds.push(await seedCountryCRes(i));
        }

        // Create & schedule v1 in Country C for window [2026-11-01T10:00Z, 2026-11-01T12:00Z)
        virtualNow = new Date('2026-11-01T09:00:00.000Z');
        const cDraft = await adminService.createDraft(
          {
            countryId: countryCId,
            title: 'Country C Campaign Window',
            slots: [
              {
                slotKey: 'trending_resources',
                mode: 'AUTOMATED',
                sectionTitle: 'Campaign Trending',
                maxItems: 6,
              },
            ],
          },
          actorCtx,
        );

        const cScheduled = await adminService.scheduleConfiguration(
          cDraft.id,
          {
            action: 'SCHEDULE',
            scheduledStartAt: '2026-11-01T10:00:00.000Z',
            scheduledUntilAt: '2026-11-01T12:00:00.000Z',
          },
          actorCtx,
        );
        expect(cScheduled.status).toBe('SCHEDULED');

        // 1. Before window (09:30Z): serves DEFAULT_FALLBACK
        const beforeWin = await homepageService.getPublicHomepage({
          countryIdentifier: countryCId,
          evalNow: '2026-11-01T09:30:00.000Z',
        });
        expect(beforeWin.data.source).toBe('DEFAULT_FALLBACK');
        expect(beforeWin.data.configuration).toBeNull();

        // 2. Inside window (10:30Z): lazy promotion transitions SCHEDULED -> PUBLISHED
        const duringWin = await homepageService.getPublicHomepage({
          countryIdentifier: countryCId,
          evalNow: '2026-11-01T10:30:00.000Z',
        });
        expect(duringWin.data.source).toBe('PUBLISHED_CONFIGURATION');
        expect(duringWin.data.configuration?.id).toBe(cDraft.id);
        expect(duringWin.data.sections[0].title).toBe('Campaign Trending');
        expect(duringWin.data.sections[0].items).toHaveLength(6);

        // 3. R17-03 live cache underfill recovery:
        // Add brand-new resource #9 (not in cached skeleton) and archive 4 cached resources so live count drops to 4 < 6 -> forces 1-shot DB rebuild picking up resource #9!
        const res9Id = await seedCountryCRes(9);
        await db
          .update(resources)
          .set({ status: 'ARCHIVED' })
          .where(inArray(resources.id, cResIds.slice(4, 8)));

        const recovered = await homepageService.getPublicHomepage({
          countryIdentifier: countryCId,
          evalNow: '2026-11-01T10:31:00.000Z',
        });
        const renderedTrendingIds = recovered.data.sections[0].items.map(
          (it) => it.id,
        );
        expect(renderedTrendingIds).toContain(res9Id);
        expect(renderedTrendingIds).toHaveLength(5);

        // 4. At/After scheduled_until_at (12:00:00Z) with no replacement: D4 transitions PUBLISHED -> ARCHIVED and serves DEFAULT_FALLBACK!
        const afterWin = await homepageService.getPublicHomepage({
          countryIdentifier: countryCId,
          evalNow: '2026-11-01T12:00:00.000Z',
        });
        expect(afterWin.data.source).toBe('DEFAULT_FALLBACK');
        expect(afterWin.data.configuration).toBeNull();

        const archivedCfg = await adminService.getConfigurationDetail(cDraft.id);
        expect(archivedCfg.status).toBe('ARCHIVED');
        expect(archivedCfg.archivedBy).toBeNull();
        expect(archivedCfg.archivedAt).toBe('2026-11-01T12:00:00.000Z');

        // Verify SYSTEM audit event homepage.configuration.expire_archive
        const sysAudits = await db
          .select()
          .from(auditLogs)
          .where(eq(auditLogs.entityId, cDraft.id));
        const expireAudit = sysAudits.find(
          (a) => a.action === 'homepage.configuration.expire_archive',
        );
        expect(expireAudit).toBeDefined();
        expect(expireAudit?.outcome).toBe('SUCCESS');
      });
    });
  },
);
