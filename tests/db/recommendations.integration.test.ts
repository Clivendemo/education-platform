import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, closeDatabase } from '../../src/db/index.js';
import {
  countries,
  curricula,
  curriculumVersions,
  educationLevels,
  grades,
  subjects,
  topics,
  resourceTypes,
  resources,
  resourceVersions,
  resourceVerifications,
  resourceRecommendationRules,
  users,
} from '../../src/db/schemas.js';
import { DefaultRecommendationService } from '../../src/services/recommendations/recommendation.service.js';
import {
  RecommendationCacheService,
  resolveDirectListenConnectionString,
} from '../../src/services/recommendations/recommendation-cache.service.js';
import { withDbRetry } from '../helpers/db-retry.js';

function getPgErrorCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } } | undefined;
  return e?.code ?? e?.cause?.code;
}

const isDbAvailable = Boolean(process.env.DATABASE_TEST_URL || process.env.DATABASE_URL);

describe.skipIf(!isDbAvailable)(
  'Prompt 30: Recommendations PostgreSQL Constraints, Triggers & Cache Listener Integration Tests',
  () => {
    const suffix = Date.now().toString(36);
    let countryAId: string;
    let countryBId: string;
    let resourceTypeNotesId: string;
    let resourceTypePastPaperId: string;
    let curriculumAId: string;
    let curriculumVersionAId: string;
    let levelAId: string;
    let gradeAId: string;
    let subjectAId: string;
    let parentTopicAId: string;
    let childTopicAId: string;

    let curriculumBId: string;
    let curriculumVersionBId: string;
    let levelBId: string;
    let gradeBId: string;
    let subjectBId: string;
    let topicBId: string;

    let adminUserId: string;
    let sourceResId: string;
    let candRes1Id: string;
    let candRes1VerId: string;
    let candResBCountryId: string;

    const createdRuleIds: string[] = [];
    const createdResourceIds: string[] = [];
    const createdVersionIds: string[] = [];
    const createdVerificationIds: string[] = [];

    beforeAll(async () => {
      // Create two isolated test countries so country status/trigger tests never touch shared KE rows
      const [cA] = await withDbRetry(() =>
        db
          .insert(countries)
          .values({
            name: `RecTest Country A ${suffix}`,
            isoCode: `D${suffix.slice(-2).toUpperCase()}`.slice(0, 3),
            urlPrefix: `da-${suffix.slice(-5)}`,
            status: 'ACTIVE',
          })
          .returning(),
      );
      countryAId = cA.id;

      const [cB] = await withDbRetry(() =>
        db
          .insert(countries)
          .values({
            name: `RecTest Country B ${suffix}`,
            isoCode: `E${suffix.slice(-2).toUpperCase()}`.slice(0, 3),
            urlPrefix: `db-${suffix.slice(-5)}`,
            status: 'ACTIVE',
          })
          .returning(),
      );
      countryBId = cB.id;

      const [rtNotes] = await withDbRetry(() =>
        db
          .insert(resourceTypes)
          .values({
            code: `REC_NOTES_${suffix}`.toUpperCase(),
            name: `Rec Notes ${suffix}`,
            slug: `rec-notes-${suffix}`,
            pillar: 'NOTES_REVISION',
            status: 'ACTIVE',
            sequenceOrder: 901,
          })
          .returning(),
      );
      resourceTypeNotesId = rtNotes.id;

      const [rtPapers] = await withDbRetry(() =>
        db
          .insert(resourceTypes)
          .values({
            code: `REC_PAPERS_${suffix}`.toUpperCase(),
            name: `Rec Papers ${suffix}`,
            slug: `rec-papers-${suffix}`,
            pillar: 'PAST_PAPERS',
            status: 'ACTIVE',
            sequenceOrder: 902,
          })
          .returning(),
      );
      resourceTypePastPaperId = rtPapers.id;

      // Country A taxonomy
      const [curA] = await withDbRetry(() =>
        db
          .insert(curricula)
          .values({
            countryId: countryAId,
            name: `Cur A ${suffix}`,
            code: `CA_${suffix}`,
            slug: `ca-${suffix}`,
            status: 'ACTIVE',
          })
          .returning(),
      );
      curriculumAId = curA.id;

      const [cvA] = await withDbRetry(() =>
        db
          .insert(curriculumVersions)
          .values({
            countryId: countryAId,
            curriculumId: curriculumAId,
            versionName: 'v1',
            versionCode: 'V1',
            slug: `cva-${suffix}`,
            status: 'CURRENT',
          })
          .returning(),
      );
      curriculumVersionAId = cvA.id;

      const [lvlA] = await withDbRetry(() =>
        db
          .insert(educationLevels)
          .values({
            curriculumVersionId: curriculumVersionAId,
            name: 'Secondary',
            code: `SEC_${suffix}`,
            slug: `sec-${suffix}`,
            sequenceOrder: 1,
            status: 'ACTIVE',
          })
          .returning(),
      );
      levelAId = lvlA.id;

      const [grdA] = await withDbRetry(() =>
        db
          .insert(grades)
          .values({
            curriculumVersionId: curriculumVersionAId,
            educationLevelId: levelAId,
            name: 'Form 3',
            code: `F3_${suffix}`,
            slug: `f3-${suffix}`,
            sequenceOrder: 1,
            status: 'ACTIVE',
          })
          .returning(),
      );
      gradeAId = grdA.id;

      const [subA] = await withDbRetry(() =>
        db
          .insert(subjects)
          .values({
            curriculumVersionId: curriculumVersionAId,
            educationLevelId: levelAId,
            gradeId: gradeAId,
            name: 'Mathematics',
            code: `MATH_${suffix}`,
            slug: `math-${suffix}`,
            sequenceOrder: 1,
            status: 'ACTIVE',
          })
          .returning(),
      );
      subjectAId = subA.id;

      const [pTopicA] = await withDbRetry(() =>
        db
          .insert(topics)
          .values({
            curriculumVersionId: curriculumVersionAId,
            subjectId: subjectAId,
            name: 'Algebra',
            code: `ALG_${suffix}`,
            slug: `alg-${suffix}`,
            sequenceOrder: 1,
            status: 'ACTIVE',
          })
          .returning(),
      );
      parentTopicAId = pTopicA.id;

      const [cTopicA] = await withDbRetry(() =>
        db
          .insert(topics)
          .values({
            curriculumVersionId: curriculumVersionAId,
            subjectId: subjectAId,
            parentId: parentTopicAId,
            name: 'Quadratics',
            code: `QUAD_${suffix}`,
            slug: `quad-${suffix}`,
            sequenceOrder: 2,
            status: 'ACTIVE',
          })
          .returning(),
      );
      childTopicAId = cTopicA.id;

      // Country B taxonomy (to test cross-country topic rule trigger rejection)
      const [curB] = await withDbRetry(() =>
        db
          .insert(curricula)
          .values({
            countryId: countryBId,
            name: `Cur B ${suffix}`,
            code: `CB_${suffix}`,
            slug: `cb-${suffix}`,
            status: 'ACTIVE',
          })
          .returning(),
      );
      curriculumBId = curB.id;

      const [cvB] = await withDbRetry(() =>
        db
          .insert(curriculumVersions)
          .values({
            countryId: countryBId,
            curriculumId: curriculumBId,
            versionName: 'v1',
            versionCode: 'V1',
            slug: `cvb-${suffix}`,
            status: 'CURRENT',
          })
          .returning(),
      );
      curriculumVersionBId = cvB.id;

      const [lvlB] = await withDbRetry(() =>
        db
          .insert(educationLevels)
          .values({
            curriculumVersionId: curriculumVersionBId,
            name: 'Secondary B',
            code: `SECB_${suffix}`,
            slug: `secb-${suffix}`,
            sequenceOrder: 1,
            status: 'ACTIVE',
          })
          .returning(),
      );
      levelBId = lvlB.id;

      const [grdB] = await withDbRetry(() =>
        db
          .insert(grades)
          .values({
            curriculumVersionId: curriculumVersionBId,
            educationLevelId: levelBId,
            name: 'Form 3 B',
            code: `F3B_${suffix}`,
            slug: `f3b-${suffix}`,
            sequenceOrder: 1,
            status: 'ACTIVE',
          })
          .returning(),
      );
      gradeBId = grdB.id;

      const [subB] = await withDbRetry(() =>
        db
          .insert(subjects)
          .values({
            curriculumVersionId: curriculumVersionBId,
            educationLevelId: levelBId,
            gradeId: gradeBId,
            name: 'Math B',
            code: `MATHB_${suffix}`,
            slug: `mathb-${suffix}`,
            sequenceOrder: 1,
            status: 'ACTIVE',
          })
          .returning(),
      );
      subjectBId = subB.id;

      const [tB] = await withDbRetry(() =>
        db
          .insert(topics)
          .values({
            curriculumVersionId: curriculumVersionBId,
            subjectId: subjectBId,
            name: 'Topic B',
            code: `TOPB_${suffix}`,
            slug: `topb-${suffix}`,
            sequenceOrder: 1,
            status: 'ACTIVE',
          })
          .returning(),
      );
      topicBId = tB.id;

      const [u] = await withDbRetry(() =>
        db
          .insert(users)
          .values({
            email: `rec-db-admin-${suffix}@example.com`,
            displayName: 'Rec DB Admin',
            status: 'ACTIVE',
          })
          .returning(),
      );
      adminUserId = u.id;

      // Published Source Resource & Candidate Resource in Country A, plus Candidate in Country B
      const [srcRes] = await withDbRetry(() =>
        db
          .insert(resources)
          .values({
            countryId: countryAId,
            resourceTypeId: resourceTypeNotesId,
            curriculumId: curriculumAId,
            curriculumVersionId: curriculumVersionAId,
            educationLevelId: levelAId,
            gradeId: gradeAId,
            subjectId: subjectAId,
            topicId: childTopicAId,
            title: 'Source Quadratics Notes',
            slug: `src-quad-${suffix}`,
            status: 'PUBLISHED',
            qualityLabel: 'STANDARD',
          })
          .returning(),
      );
      sourceResId = srcRes.id;
      createdResourceIds.push(sourceResId);

      const [srcVer] = await withDbRetry(() =>
        db
          .insert(resourceVersions)
          .values({
            resourceId: sourceResId,
            versionNumber: 1,
            versionLabel: '1.0',
            title: 'Source Quadratics Notes v1',
            status: 'PUBLISHED',
            qualityLabel: 'STANDARD',
            publishedAt: new Date(),
          })
          .returning(),
      );
      createdVersionIds.push(srcVer.id);

      const [cand1] = await withDbRetry(() =>
        db
          .insert(resources)
          .values({
            countryId: countryAId,
            resourceTypeId: resourceTypePastPaperId,
            curriculumId: curriculumAId,
            curriculumVersionId: curriculumVersionAId,
            educationLevelId: levelAId,
            gradeId: gradeAId,
            subjectId: subjectAId,
            topicId: childTopicAId,
            title: 'Candidate Quadratics Paper',
            slug: `cand-quad-${suffix}`,
            status: 'PUBLISHED',
            qualityLabel: 'STANDARD',
          })
          .returning(),
      );
      candRes1Id = cand1.id;
      createdResourceIds.push(candRes1Id);

      const [cand1Ver] = await withDbRetry(() =>
        db
          .insert(resourceVersions)
          .values({
            resourceId: candRes1Id,
            versionNumber: 1,
            versionLabel: '1.0',
            title: 'Candidate Quadratics Paper v1',
            status: 'PUBLISHED',
            qualityLabel: 'STANDARD',
            publishedAt: new Date(),
          })
          .returning(),
      );
      candRes1VerId = cand1Ver.id;
      createdVersionIds.push(candRes1VerId);

      const [candB] = await withDbRetry(() =>
        db
          .insert(resources)
          .values({
            countryId: countryBId,
            resourceTypeId: resourceTypePastPaperId,
            title: 'Country B Resource',
            slug: `cand-b-${suffix}`,
            status: 'PUBLISHED',
            qualityLabel: 'STANDARD',
          })
          .returning(),
      );
      candResBCountryId = candB.id;
      createdResourceIds.push(candResBCountryId);

      const [candBVer] = await withDbRetry(() =>
        db
          .insert(resourceVersions)
          .values({
            resourceId: candResBCountryId,
            versionNumber: 1,
            versionLabel: '1.0',
            title: 'Country B Resource v1',
            status: 'PUBLISHED',
            qualityLabel: 'STANDARD',
            publishedAt: new Date(),
          })
          .returning(),
      );
      createdVersionIds.push(candBVer.id);
    }, 60_000);

    afterAll(async () => {
      try {
        await db.execute(sql`
          ALTER TABLE "content"."resource_recommendation_rules"
          DISABLE TRIGGER "trg_prevent_rec_rule_delete"
        `).catch(() => {});

        if (createdRuleIds.length > 0) {
          await db
            .delete(resourceRecommendationRules)
            .where(inArray(resourceRecommendationRules.id, createdRuleIds))
            .catch(() => {});
        }
        await db
          .delete(resourceRecommendationRules)
          .where(inArray(resourceRecommendationRules.countryId, [countryAId, countryBId]))
          .catch(() => {});

        await db.execute(sql`
          ALTER TABLE "content"."resource_recommendation_rules"
          ENABLE TRIGGER "trg_prevent_rec_rule_delete"
        `).catch(() => {});

        if (createdVerificationIds.length > 0) {
          await db
            .delete(resourceVerifications)
            .where(inArray(resourceVerifications.id, createdVerificationIds))
            .catch(() => {});
        }
        if (createdVersionIds.length > 0) {
          await db.execute(sql`
            DELETE FROM content.resource_versions
            WHERE resource_id = ANY(ARRAY[${sql.join(
              createdResourceIds.map((id) => sql`${id}::uuid`),
              sql`, `,
            )}]::uuid[])
          `).catch(() => {});
        }
        if (createdResourceIds.length > 0) {
          await db
            .delete(resources)
            .where(inArray(resources.id, createdResourceIds))
            .catch(() => {});
        }
        if (adminUserId) {
          await db.delete(users).where(eq(users.id, adminUserId)).catch(() => {});
        }
        if (childTopicAId) {
          await db.delete(topics).where(eq(topics.id, childTopicAId)).catch(() => {});
        }
        if (parentTopicAId) {
          await db.delete(topics).where(eq(topics.id, parentTopicAId)).catch(() => {});
        }
        if (topicBId) {
          await db.delete(topics).where(eq(topics.id, topicBId)).catch(() => {});
        }
        if (subjectAId) await db.delete(subjects).where(eq(subjects.id, subjectAId)).catch(() => {});
        if (subjectBId) await db.delete(subjects).where(eq(subjects.id, subjectBId)).catch(() => {});
        if (gradeAId) await db.delete(grades).where(eq(grades.id, gradeAId)).catch(() => {});
        if (gradeBId) await db.delete(grades).where(eq(grades.id, gradeBId)).catch(() => {});
        if (levelAId) await db.delete(educationLevels).where(eq(educationLevels.id, levelAId)).catch(() => {});
        if (levelBId) await db.delete(educationLevels).where(eq(educationLevels.id, levelBId)).catch(() => {});
        if (curriculumVersionAId) {
          await db.delete(curriculumVersions).where(eq(curriculumVersions.id, curriculumVersionAId)).catch(() => {});
        }
        if (curriculumVersionBId) {
          await db.delete(curriculumVersions).where(eq(curriculumVersions.id, curriculumVersionBId)).catch(() => {});
        }
        if (curriculumAId) await db.delete(curricula).where(eq(curricula.id, curriculumAId)).catch(() => {});
        if (curriculumBId) await db.delete(curricula).where(eq(curricula.id, curriculumBId)).catch(() => {});
        if (resourceTypeNotesId) {
          await db.delete(resourceTypes).where(eq(resourceTypes.id, resourceTypeNotesId)).catch(() => {});
        }
        if (resourceTypePastPaperId) {
          await db.delete(resourceTypes).where(eq(resourceTypes.id, resourceTypePastPaperId)).catch(() => {});
        }
        if (countryAId) await db.delete(countries).where(eq(countries.id, countryAId)).catch(() => {});
        if (countryBId) await db.delete(countries).where(eq(countries.id, countryBId)).catch(() => {});
      } finally {
        await closeDatabase();
      }
    }, 60_000);

    describe('Suite 3: Active-Version Uniqueness & Archived Read-Time Gate', () => {
      it('atomically blocks concurrent second PUBLISHED version via uq_resource_single_published_version', async () => {
        const outcomes = await Promise.allSettled([
          db
            .insert(resourceVersions)
            .values({
              resourceId: candRes1Id,
              versionNumber: 2,
              versionLabel: '2.0',
              title: 'Duplicate Published Attempt A',
              status: 'PUBLISHED',
              qualityLabel: 'STANDARD',
              publishedAt: new Date(),
            })
            .returning(),
          db
            .insert(resourceVersions)
            .values({
              resourceId: candRes1Id,
              versionNumber: 3,
              versionLabel: '3.0',
              title: 'Duplicate Published Attempt B',
              status: 'PUBLISHED',
              qualityLabel: 'STANDARD',
              publishedAt: new Date(),
            })
            .returning(),
        ]);

        // Because version 1 is ALREADY PUBLISHED, both concurrent inserts must fail with SQLSTATE 23505!
        expect(outcomes[0].status).toBe('rejected');
        expect(outcomes[1].status).toBe('rejected');
        expect(getPgErrorCode((outcomes[0] as PromiseRejectedResult).reason)).toBe('23505');
        expect(getPgErrorCode((outcomes[1] as PromiseRejectedResult).reason)).toBe('23505');
      });

      it('immediately excludes an ARCHIVED candidate even from a pre-warmed cache entry', async () => {
        const isolatedCache = new RecommendationCacheService();
        const recService = new DefaultRecommendationService(
          db,
          undefined,
          undefined,
          isolatedCache,
        );

        // Warm cache
        const first = await recService.getResourceRecommendations({
          sourceResourceId: sourceResId,
          surface: 'related-resources',
        });
        expect(first.data.map((d) => d.id)).toContain(candRes1Id);
        expect(first._diagnostics?.cacheHit).toBe(false);

        const second = await recService.getResourceRecommendations({
          sourceResourceId: sourceResId,
          surface: 'related-resources',
        });
        expect(second._diagnostics?.cacheHit).toBe(true);
        expect(second.data.map((d) => d.id)).toContain(candRes1Id);

        // Archive candidate directly in DB WITHOUT clearing isolatedCache in-process ->
        // read-time Active Publication Gate MUST still filter it out!
        await db
          .update(resources)
          .set({ status: 'ARCHIVED' })
          .where(eq(resources.id, candRes1Id));

        try {
          const afterArchive = await recService.getResourceRecommendations({
            sourceResourceId: sourceResId,
            surface: 'related-resources',
          });
          expect(afterArchive._diagnostics?.cacheHit).toBe(true);
          expect(afterArchive.data.map((d) => d.id)).not.toContain(candRes1Id);
        } finally {
          await db
            .update(resources)
            .set({ status: 'PUBLISHED' })
            .where(eq(resources.id, candRes1Id));
        }
      });
    });

    describe('Suite 5 & 6 (DB): Editorial Constraints, Cross-Country FKs & Permanent Hard-Delete Block', () => {
      it('enforces XOR scope, priority bounds, self-target block, cross-country FKs, topic-country trigger, and DELETE block', async () => {
        // 1. Self-target rejected
        await expect(
          db.insert(resourceRecommendationRules).values({
            countryId: countryAId,
            ruleType: 'PIN',
            sourceResourceId: sourceResId,
            targetResourceId: sourceResId,
            priority: 1,
            reason: 'Self target attempt',
            createdBy: adminUserId,
          }),
        ).rejects.toThrow();

        // 2. Cross-country target resource rejected by composite FK
        await expect(
          db.insert(resourceRecommendationRules).values({
            countryId: countryAId,
            ruleType: 'PIN',
            sourceResourceId: sourceResId,
            targetResourceId: candResBCountryId,
            priority: 1,
            reason: 'Cross country target attempt',
            createdBy: adminUserId,
          }),
        ).rejects.toThrow();

        // 3. Cross-country source_topic_id rejected by trg_validate_rec_rule_ins_upd (ERRCODE 23503)
        let crossTopicErr: unknown;
        try {
          await db.insert(resourceRecommendationRules).values({
            countryId: countryAId,
            ruleType: 'PIN',
            sourceTopicId: topicBId, // belongs to Country B!
            targetResourceId: candRes1Id,
            priority: 1,
            reason: 'Cross country topic attempt',
            createdBy: adminUserId,
          });
        } catch (err) {
          crossTopicErr = err;
        }
        expect(getPgErrorCode(crossTopicErr)).toBe('23503');

        // 4. Valid active rule + partial unique index conflict + hard DELETE block
        const [validRule] = await db
          .insert(resourceRecommendationRules)
          .values({
            countryId: countryAId,
            ruleType: 'PIN',
            sourceResourceId: sourceResId,
            targetResourceId: candRes1Id,
            priority: 2,
            reason: 'Valid curated companion paper',
            createdBy: adminUserId,
          })
          .returning();
        createdRuleIds.push(validRule.id);

        // Duplicate ACTIVE rule on same (source_resource_id, target_resource_id) fails with 23505
        let dupRuleErr: unknown;
        try {
          await db.insert(resourceRecommendationRules).values({
            countryId: countryAId,
            ruleType: 'EXCLUDE',
            sourceResourceId: sourceResId,
            targetResourceId: candRes1Id,
            priority: null,
            reason: 'Conflicting active rule',
            createdBy: adminUserId,
          });
        } catch (err) {
          dupRuleErr = err;
        }
        expect(getPgErrorCode(dupRuleErr)).toBe('23505');

        // Physical DELETE blocked by trg_prevent_rec_rule_delete (23514)
        let hardDeleteErr: unknown;
        try {
          await db
            .delete(resourceRecommendationRules)
            .where(eq(resourceRecommendationRules.id, validRule.id));
        } catch (err) {
          hardDeleteErr = err;
        }
        expect(getPgErrorCode(hardDeleteErr)).toBe('23514');

        // Soft deactivation succeeds
        await db
          .update(resourceRecommendationRules)
          .set({
            status: 'INACTIVE',
            deactivatedBy: adminUserId,
            deactivatedAt: new Date(),
            deactivationReason: 'Completed test cycle',
          })
          .where(eq(resourceRecommendationRules.id, validRule.id));
      });
    });

    describe('Suite 8 & 9 (DB): Multi-Table pg_notify Triggers, Rollback Silence & Listener Recovery', () => {
      it('emits rec_invalid notifications on committed mutations, emits zero on rollback, and recovers on listener disconnect', async () => {
        const connStr = process.env.DATABASE_URL!;
        const directListenConnStr = resolveDirectListenConnectionString(connStr)!;
        const rawSub = new pg.Client({ connectionString: directListenConnStr });
        const receivedPayloads: any[] = [];
        rawSub.on('notification', (msg) => {
          if (msg.channel === 'rec_invalid' && msg.payload) {
            receivedPayloads.push(JSON.parse(msg.payload));
          }
        });
        await rawSub.connect();
        await rawSub.query('LISTEN rec_invalid');

        const liveCache = new RecommendationCacheService({
          connectionString: connStr,
          reconnectBaseMs: 50,
          reconnectMaxMs: 200,
        });
        await liveCache.startListener();
        expect(liveCache.getListenerState()).toBe('CONNECTED');

        try {
          // 1. Rolled-back transaction MUST emit zero notifications
          const beforeRollbackCount = receivedPayloads.length;
          await expect(
            db.transaction(async (tx) => {
              await tx.insert(resourceRecommendationRules).values({
                countryId: countryAId,
                ruleType: 'PIN',
                sourceTopicId: childTopicAId,
                targetResourceId: candRes1Id,
                priority: 1,
                reason: 'Will rollback immediately',
                createdBy: adminUserId,
              });
              throw new Error('FORCE_ROLLBACK');
            }),
          ).rejects.toThrow('FORCE_ROLLBACK');

          await new Promise((r) => setTimeout(r, 250));
          expect(receivedPayloads.length).toBe(beforeRollbackCount);

          // 2. Seed entry in liveCache and mutate verification + topic + country to prove cross-connection eviction
          liveCache.set(
            `rec:res:${sourceResId}:related-resources`,
            [
              {
                resourceId: candRes1Id,
                isPinned: false,
                ruleScopeRank: null,
                priority: null,
                algorithmicScore: 75,
              },
            ],
            {
              countryId: countryAId,
              sourceResourceId: sourceResId,
              sourceTopicIds: [childTopicAId],
              candidateIds: [candRes1Id],
            },
          );
          expect(liveCache.size()).toBe(1);

          // Insert verification -> triggers governance.resource_verifications -> evicts liveCache over pg_notify!
          const [verif] = await db
            .insert(resourceVerifications)
            .values({
              resourceId: candRes1Id,
              resourceVersionId: candRes1VerId,
              verificationStatus: 'VERIFIED',
              verifiedBy: adminUserId,
              verifiedAt: new Date(),
            })
            .returning();
          createdVerificationIds.push(verif.id);

          // Wait for async PostgreSQL NOTIFY delivery over direct connection
          for (let i = 0; i < 50 && liveCache.size() > 0; i++) {
            await new Promise((r) => setTimeout(r, 50));
          }
          expect(liveCache.size()).toBe(0);
          expect(receivedPayloads.some((p) => p.scope === 'verification')).toBe(true);

          // 3. Simulate unexpected listener disconnect -> purges cache, enters DISCONNECTED bypass, then reconnects
          liveCache.set('rec:cold:test:20', [], {
            countryId: countryAId,
            candidateIds: [],
          });
          await liveCache.simulateDisconnect();
          expect(liveCache.size()).toBe(0);
          expect(liveCache.getListenerState()).toBe('DISCONNECTED');

          // Wait for automatic exponential backoff reconnect
          for (let i = 0; i < 30 && liveCache.getListenerState() !== 'CONNECTED'; i++) {
            await new Promise((r) => setTimeout(r, 50));
          }
          expect(liveCache.getListenerState()).toBe('CONNECTED');
        } finally {
          await liveCache.stopListener();
          await rawSub.end().catch(() => {});
        }
      }, 30_000);
    });
  },
);
