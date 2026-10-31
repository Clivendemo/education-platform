import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db as defaultDb, type AppDatabase } from '../db/index.js';
import {
  CANONICAL_HOMEPAGE_SLOTS,
  CANONICAL_SLOT_BY_KEY,
  type HomepageConfigStatus,
  type HomepageEntityType,
  type HomepageSlotKey,
  type HomepageSlotMode,
} from '../db/schema/homepage.js';
import {
  defaultAuditService,
  type ActorSnapshot,
  type AuditService,
} from './audit.service.js';
import {
  defaultHomepageCacheService,
  HomepageCacheService,
} from './homepage-cache.js';
import {
  evaluatePinWindow,
  extractPinnedItemEntityId,
  parseEvaluationTimestamp,
  type HomepageEligibilityDiagnostic,
} from './homepage-eligibility.js';
import {
  defaultHomepageService,
  HomepageDatabaseUnavailableError,
  HomepageError,
  type HomepageCountrySummaryDto,
  type HomepagePreviewRenderResult,
  type HomepageService,
  type PreviewSlotInput,
} from './homepage.service.js';
import type { PermissionAccessResolution } from './rbac.service.js';
import type { CountryResult } from './geography.service.js';

export interface HomepageAdminActorContext {
  actorUserId: string;
  actorSnapshot: ActorSnapshot;
  requestId?: string | null;
}

export interface ConfigurationScopeTarget {
  id: string;
  countryId: string;
  status: HomepageConfigStatus;
}

export interface DraftPinnedItemInput {
  position: number;
  entityId: string;
  startsAt?: string | Date | null;
  endsAt?: string | Date | null;
  pinNote?: string | null;
}

export interface DraftSlotMutationInput {
  slotKey: HomepageSlotKey;
  mode?: HomepageSlotMode;
  sectionTitle?: string;
  sectionSubtitle?: string | null;
  maxItems?: number;
  items?: DraftPinnedItemInput[];
}

export interface CreateHomepageDraftInput {
  countryId: string;
  title: string;
  notes?: string | null;
  sourceConfigurationId?: string | null;
  slots?: DraftSlotMutationInput[];
}

export interface UpdateHomepageDraftInput {
  title?: string;
  notes?: string | null;
  slots?: DraftSlotMutationInput[];
}

export interface ListHomepageConfigurationsQuery {
  countryId?: string;
  status?: HomepageConfigStatus;
  page?: number;
  pageSize?: number;
}

export interface HomepageConfigurationSummaryDto {
  id: string;
  countryId: string;
  versionNumber: number;
  title: string;
  notes: string | null;
  status: HomepageConfigStatus;
  scheduledStartAt: string | null;
  scheduledUntilAt: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
  supersededAt: string | null;
  supersededByConfigurationId: string | null;
  rolledBackAt: string | null;
  rolledBackBy: string | null;
  rollbackReason: string | null;
  restoredFromConfigurationId: string | null;
  archivedAt: string | null;
  archivedBy: string | null;
  discardedAt: string | null;
  discardedBy: string | null;
  discardReason: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface HomepageAdminSlotItemDto {
  id: string;
  position: number;
  entityType: HomepageEntityType;
  entityId: string;
  entityTitle: string | null;
  startsAt: string | null;
  endsAt: string | null;
  pinNote: string | null;
  liveEligible: boolean;
  entityDiagnostic: HomepageEligibilityDiagnostic;
  pinWindowDiagnostic: HomepageEligibilityDiagnostic;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface HomepageAdminSlotDto {
  id: string;
  slotKey: HomepageSlotKey;
  slotOrder: 1 | 2 | 3 | 4 | 5 | 6;
  entityType: HomepageEntityType;
  mode: HomepageSlotMode;
  sectionTitle: string;
  sectionSubtitle: string | null;
  maxItems: number;
  items: HomepageAdminSlotItemDto[];
}

export interface HomepageRollbackLedgerDto {
  id: string;
  rolledBackConfigurationId: string;
  targetSourceConfigurationId: string;
  cloneConfigurationId: string;
  txid: string;
  reason: string;
  actorUserId: string;
  occurredAt: string;
}

export interface HomepageConfigurationDetailDto extends HomepageConfigurationSummaryDto {
  country: HomepageCountrySummaryDto;
  evaluatedAt: string;
  slots: HomepageAdminSlotDto[];
  rollbackProvenance: {
    asClone: HomepageRollbackLedgerDto | null;
    asRolledBackPredecessor: HomepageRollbackLedgerDto | null;
  };
}

export interface PaginatedHomepageConfigurationsResult {
  data: HomepageConfigurationSummaryDto[];
  summary: {
    countryId: string;
    activeDraftId: string | null;
    activePublishedId: string | null;
    scheduledCount: number;
  } | null;
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  };
}

export interface ScheduleHomepageConfigurationInput {
  action?: 'SCHEDULE' | 'UNSCHEDULE' | 'CANCEL';
  scheduledStartAt?: string | Date;
  scheduledUntilAt?: string | Date | null;
  reason?: string;
}

export interface PublishHomepageConfigurationInput {
  scheduledUntilAt?: string | Date | null;
}

export interface DiscardHomepageDraftInput {
  reason: string;
}

export interface RollbackHomepageConfigurationInput {
  countryId: string;
  targetConfigurationId: string;
  reason: string;
}

export interface RollbackHomepageConfigurationResult {
  cloneConfiguration: HomepageConfigurationDetailDto;
  rolledBackConfigurationId: string;
  targetSourceConfigurationId: string;
  rollbackLedger: HomepageRollbackLedgerDto;
}

export interface AdminPreviewHomepageInput {
  countryId?: string;
  configurationId?: string;
  evaluateAt?: unknown;
  slots?: PreviewSlotInput[];
}

export interface HomepageAdminService {
  getConfigurationScopeTarget(
    configurationId: string,
  ): Promise<ConfigurationScopeTarget | null>;
  countryExists(countryId: string): Promise<boolean>;
  createDraft(
    input: CreateHomepageDraftInput,
    actor: HomepageAdminActorContext,
  ): Promise<HomepageConfigurationDetailDto>;
  listConfigurations(
    query: ListHomepageConfigurationsQuery,
    access: PermissionAccessResolution,
  ): Promise<PaginatedHomepageConfigurationsResult>;
  getConfigurationDetail(
    configurationId: string,
    evalNow?: Date,
  ): Promise<HomepageConfigurationDetailDto>;
  updateDraft(
    configurationId: string,
    input: UpdateHomepageDraftInput,
    actor: HomepageAdminActorContext,
  ): Promise<HomepageConfigurationDetailDto>;
  previewHomepage(
    input: AdminPreviewHomepageInput,
  ): Promise<HomepagePreviewRenderResult>;
  scheduleConfiguration(
    configurationId: string,
    input: ScheduleHomepageConfigurationInput,
    actor: HomepageAdminActorContext,
  ): Promise<HomepageConfigurationDetailDto>;
  publishConfiguration(
    configurationId: string,
    input: PublishHomepageConfigurationInput,
    actor: HomepageAdminActorContext,
  ): Promise<HomepageConfigurationDetailDto>;
  discardDraft(
    configurationId: string,
    input: DiscardHomepageDraftInput,
    actor: HomepageAdminActorContext,
  ): Promise<HomepageConfigurationDetailDto>;
  rollbackConfiguration(
    input: RollbackHomepageConfigurationInput,
    actor: HomepageAdminActorContext,
  ): Promise<RollbackHomepageConfigurationResult>;
}

function toIsoOrNull(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string') {
    const ms = Date.parse(val);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : val;
  }
  return null;
}

function toIsoRequired(val: unknown): string {
  return toIsoOrNull(val) ?? new Date(0).toISOString();
}

function parseOptionalFiniteTimestamp(
  val: string | Date | null | undefined,
  fieldName: string,
): Date | null {
  if (val === undefined || val === null) {
    return null;
  }
  if (val instanceof Date) {
    if (!Number.isFinite(val.getTime())) {
      throw new HomepageError(
        `${fieldName} must be a valid finite timestamp.`,
        400,
        'VALIDATION_ERROR',
      );
    }
    return new Date(val.getTime());
  }
  const parsed = parseEvaluationTimestamp(val);
  if (!parsed.ok) {
    throw new HomepageError(
      `${fieldName} must be a valid ISO-8601 timestamp with timezone.`,
      400,
      'VALIDATION_ERROR',
    );
  }
  return parsed.date;
}

function extractPgErrorInfo(err: unknown): {
  code?: string;
  constraint?: string;
  message?: string;
} {
  if (!err || typeof err !== 'object') return {};
  const anyErr = err as Record<string, any>;
  const cause =
    anyErr.cause && typeof anyErr.cause === 'object' ? anyErr.cause : anyErr;
  return {
    code: typeof cause.code === 'string' ? cause.code : undefined,
    constraint:
      typeof cause.constraint === 'string' ? cause.constraint : undefined,
    message: typeof cause.message === 'string' ? cause.message : undefined,
  };
}

function mapSummaryRow(row: Record<string, any>): HomepageConfigurationSummaryDto {
  return {
    id: String(row.id),
    countryId: String(row.country_id),
    versionNumber: Number(row.version_number),
    title: String(row.title),
    notes: row.notes !== null && row.notes !== undefined ? String(row.notes) : null,
    status: row.status as HomepageConfigStatus,
    scheduledStartAt: toIsoOrNull(row.scheduled_start_at),
    scheduledUntilAt: toIsoOrNull(row.scheduled_until_at),
    publishedAt: toIsoOrNull(row.published_at),
    publishedBy: row.published_by ? String(row.published_by) : null,
    supersededAt: toIsoOrNull(row.superseded_at),
    supersededByConfigurationId: row.superseded_by_configuration_id
      ? String(row.superseded_by_configuration_id)
      : null,
    rolledBackAt: toIsoOrNull(row.rolled_back_at),
    rolledBackBy: row.rolled_back_by ? String(row.rolled_back_by) : null,
    rollbackReason:
      row.rollback_reason !== null && row.rollback_reason !== undefined
        ? String(row.rollback_reason)
        : null,
    restoredFromConfigurationId: row.restored_from_configuration_id
      ? String(row.restored_from_configuration_id)
      : null,
    archivedAt: toIsoOrNull(row.archived_at),
    archivedBy: row.archived_by ? String(row.archived_by) : null,
    discardedAt: toIsoOrNull(row.discarded_at),
    discardedBy: row.discarded_by ? String(row.discarded_by) : null,
    discardReason:
      row.discard_reason !== null && row.discard_reason !== undefined
        ? String(row.discard_reason)
        : null,
    createdBy: String(row.created_by),
    updatedBy: String(row.updated_by),
    createdAt: toIsoRequired(row.created_at),
    updatedAt: toIsoRequired(row.updated_at),
  };
}

function mapRollbackRow(row: Record<string, any>): HomepageRollbackLedgerDto {
  return {
    id: String(row.id),
    rolledBackConfigurationId: String(row.rolled_back_configuration_id),
    targetSourceConfigurationId: String(row.target_source_configuration_id),
    cloneConfigurationId: String(row.clone_configuration_id),
    txid: String(row.txid),
    reason: String(row.reason),
    actorUserId: String(row.actor_user_id),
    occurredAt: toIsoRequired(row.occurred_at),
  };
}

export class DefaultHomepageAdminService implements HomepageAdminService {
  constructor(
    private readonly dbInstance: AppDatabase = defaultDb,
    private readonly homepageService: HomepageService = defaultHomepageService,
    private readonly cacheService: HomepageCacheService = defaultHomepageCacheService,
    private readonly auditService: AuditService = defaultAuditService,
    private readonly nowProvider: () => Date = () => new Date(),
  ) {}

  async getConfigurationScopeTarget(
    configurationId: string,
  ): Promise<ConfigurationScopeTarget | null> {
    try {
      const res = await this.dbInstance.execute(sql`
        SELECT id, country_id, status
        FROM "content"."homepage_configurations"
        WHERE id = ${configurationId}::uuid
        LIMIT 1
      `);
      const row = res.rows[0] as Record<string, any> | undefined;
      if (!row) {
        return null;
      }
      return {
        id: String(row.id),
        countryId: String(row.country_id),
        status: row.status as HomepageConfigStatus,
      };
    } catch (err) {
      if (err instanceof HomepageError) throw err;
      throw new HomepageDatabaseUnavailableError();
    }
  }

  async countryExists(countryId: string): Promise<boolean> {
    try {
      const res = await this.dbInstance.execute(sql`
        SELECT 1 AS ok
        FROM "platform"."countries"
        WHERE id = ${countryId}::uuid
        LIMIT 1
      `);
      return res.rows.length > 0;
    } catch (err) {
      if (err instanceof HomepageError) throw err;
      throw new HomepageDatabaseUnavailableError();
    }
  }

  async createDraft(
    input: CreateHomepageDraftInput,
    actor: HomepageAdminActorContext,
  ): Promise<HomepageConfigurationDetailDto> {
    const trimmedTitle = input.title.trim();
    if (trimmedTitle.length < 1 || trimmedTitle.length > 160) {
      throw new HomepageError(
        'Draft title must be between 1 and 160 non-whitespace characters.',
        400,
        'VALIDATION_ERROR',
      );
    }
    if (input.notes !== undefined && input.notes !== null && input.notes.length > 2000) {
      throw new HomepageError(
        'Draft notes cannot exceed 2000 characters.',
        400,
        'VALIDATION_ERROR',
      );
    }

    const now = this.nowProvider();
    const nowIso = now.toISOString();

    try {
      const country = await this.requireCountryForWrite(input.countryId);

      const createdId = await this.dbInstance.transaction(async (tx) => {
        await this.acquireCountryLock(tx, country.id);

        const existingDraftRes = await tx.execute(sql`
          SELECT id
          FROM "content"."homepage_configurations"
          WHERE country_id = ${country.id}::uuid
            AND status = 'DRAFT'
          LIMIT 1
        `);
        if (existingDraftRes.rows.length > 0) {
          throw new HomepageError(
            'An active draft homepage configuration already exists for this country.',
            409,
            'ACTIVE_DRAFT_ALREADY_EXISTS',
          );
        }

        // Optional source clone lookup within exact same country
        const sourceSlotsByKey = new Map<
          HomepageSlotKey,
          {
            mode: HomepageSlotMode;
            sectionTitle: string;
            sectionSubtitle: string | null;
            maxItems: number;
            items: Array<{
              position: number;
              entityId: string;
              startsAt: Date | null;
              endsAt: Date | null;
              pinNote: string | null;
            }>;
          }
        >();

        if (input.sourceConfigurationId) {
          const srcCfgRes = await tx.execute(sql`
            SELECT id
            FROM "content"."homepage_configurations"
            WHERE id = ${input.sourceConfigurationId}::uuid
              AND country_id = ${country.id}::uuid
            LIMIT 1
          `);
          if (srcCfgRes.rows.length === 0) {
            throw new HomepageError(
              'Source homepage configuration was not found in the target country.',
              404,
              'SOURCE_CONFIGURATION_NOT_FOUND',
            );
          }

          const srcSlotsRes = await tx.execute(sql`
            SELECT id, slot_key, mode, section_title, section_subtitle, max_items
            FROM "content"."homepage_configuration_slots"
            WHERE configuration_id = ${input.sourceConfigurationId}::uuid
            ORDER BY slot_order ASC
          `);
          const srcItemsRes = await tx.execute(sql`
            SELECT
              slot_id,
              entity_type,
              position,
              resource_id,
              update_id,
              calendar_event_id,
              subject_id,
              starts_at,
              ends_at,
              pin_note
            FROM "content"."homepage_configuration_items"
            WHERE configuration_id = ${input.sourceConfigurationId}::uuid
            ORDER BY slot_id, position ASC
          `);

          const itemsBySlotId = new Map<
            string,
            Array<{
              position: number;
              entityId: string;
              startsAt: Date | null;
              endsAt: Date | null;
              pinNote: string | null;
            }>
          >();

          for (const rawItem of srcItemsRes.rows) {
            const r = rawItem as Record<string, any>;
            const entityId = extractPinnedItemEntityId({
              entityType: r.entity_type as HomepageEntityType,
              resourceId: r.resource_id,
              updateId: r.update_id,
              calendarEventId: r.calendar_event_id,
              subjectId: r.subject_id,
            });
            if (!entityId) continue;
            const list = itemsBySlotId.get(String(r.slot_id)) ?? [];
            list.push({
              position: Number(r.position),
              entityId,
              startsAt: r.starts_at ? new Date(r.starts_at) : null,
              endsAt: r.ends_at ? new Date(r.ends_at) : null,
              pinNote: r.pin_note !== null ? String(r.pin_note) : null,
            });
            itemsBySlotId.set(String(r.slot_id), list);
          }

          for (const rawSlot of srcSlotsRes.rows) {
            const s = rawSlot as Record<string, any>;
            sourceSlotsByKey.set(s.slot_key as HomepageSlotKey, {
              mode: s.mode as HomepageSlotMode,
              sectionTitle: String(s.section_title),
              sectionSubtitle:
                s.section_subtitle !== null ? String(s.section_subtitle) : null,
              maxItems: Number(s.max_items),
              items: itemsBySlotId.get(String(s.id)) ?? [],
            });
          }
        }

        const overrideByKey = new Map<HomepageSlotKey, DraftSlotMutationInput>();
        for (const s of input.slots ?? []) {
          if (overrideByKey.has(s.slotKey)) {
            throw new HomepageError(
              `Duplicate slotKey '${s.slotKey}' in draft request.`,
              400,
              'VALIDATION_ERROR',
            );
          }
          overrideByKey.set(s.slotKey, s);
        }

        const nextVerRes = await tx.execute(sql`
          SELECT (COALESCE(MAX(version_number), 0) + 1)::int AS next_version
          FROM "content"."homepage_configurations"
          WHERE country_id = ${country.id}::uuid
        `);
        const nextVersion = Number(nextVerRes.rows[0]?.next_version ?? 1);
        const draftId = crypto.randomUUID();

        await tx.execute(sql`
          INSERT INTO "content"."homepage_configurations" (
            id,
            country_id,
            version_number,
            title,
            notes,
            status,
            created_by,
            updated_by,
            created_at,
            updated_at
          ) VALUES (
            ${draftId}::uuid,
            ${country.id}::uuid,
            ${nextVersion},
            ${trimmedTitle},
            ${input.notes ?? null},
            'DRAFT',
            ${actor.actorUserId}::uuid,
            ${actor.actorUserId}::uuid,
            ${nowIso}::timestamptz,
            ${nowIso}::timestamptz
          )
        `);

        for (const spec of CANONICAL_HOMEPAGE_SLOTS) {
          const cloned = sourceSlotsByKey.get(spec.slotKey);
          const ov = overrideByKey.get(spec.slotKey);

          const mode: HomepageSlotMode =
            ov?.mode ?? cloned?.mode ?? 'AUTOMATED';
          const sectionTitle =
            ov?.sectionTitle !== undefined
              ? ov.sectionTitle.trim()
              : cloned?.sectionTitle ?? spec.defaultTitle;
          if (sectionTitle.length < 1 || sectionTitle.length > 120) {
            throw new HomepageError(
              `Section title for '${spec.slotKey}' must be 1 to 120 characters.`,
              400,
              'VALIDATION_ERROR',
            );
          }
          const sectionSubtitle =
            ov?.sectionSubtitle !== undefined
              ? ov.sectionSubtitle
              : cloned !== undefined
                ? cloned.sectionSubtitle
                : spec.defaultSubtitle;
          if (sectionSubtitle !== null && sectionSubtitle.length > 240) {
            throw new HomepageError(
              `Section subtitle for '${spec.slotKey}' cannot exceed 240 characters.`,
              400,
              'VALIDATION_ERROR',
            );
          }

          const maxItems = ov?.maxItems ?? cloned?.maxItems ?? spec.defaultMaxItems;
          if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 6) {
            throw new HomepageError(
              `maxItems for '${spec.slotKey}' must be an integer between 1 and 6.`,
              400,
              'VALIDATION_ERROR',
            );
          }

          const slotId = crypto.randomUUID();
          await tx.execute(sql`
            INSERT INTO "content"."homepage_configuration_slots" (
              id,
              configuration_id,
              country_id,
              slot_key,
              slot_order,
              entity_type,
              mode,
              section_title,
              section_subtitle,
              max_items,
              created_at,
              updated_at
            ) VALUES (
              ${slotId}::uuid,
              ${draftId}::uuid,
              ${country.id}::uuid,
              ${spec.slotKey}::"content"."homepage_slot_key",
              ${spec.slotOrder},
              ${spec.entityType}::"content"."homepage_entity_type",
              ${mode}::"content"."homepage_slot_mode",
              ${sectionTitle},
              ${sectionSubtitle},
              ${maxItems},
              ${nowIso}::timestamptz,
              ${nowIso}::timestamptz
            )
          `);

          if (ov?.items !== undefined) {
            await this.validateAndInsertSlotItems(
              tx,
              {
                configurationId: draftId,
                slotId,
                slotKey: spec.slotKey,
                entityType: spec.entityType,
                countryId: country.id,
                maxItems,
                items: ov.items,
                requireLiveEligibility: true,
              },
              actor.actorUserId,
              now,
            );
          } else if (cloned && cloned.items.length > 0) {
            const fittingCloned = cloned.items.filter(
              (item) => item.position <= maxItems,
            );
            await this.validateAndInsertSlotItems(
              tx,
              {
                configurationId: draftId,
                slotId,
                slotKey: spec.slotKey,
                entityType: spec.entityType,
                countryId: country.id,
                maxItems,
                items: fittingCloned,
                requireLiveEligibility: false,
              },
              actor.actorUserId,
              now,
            );
          }
        }

        await this.auditService.logEvent(
          {
            action: 'homepage.draft.create',
            entityType: 'HOMEPAGE_CONFIGURATION',
            entityId: draftId,
            actorType: 'AUTHENTICATED',
            actorUserId: actor.actorUserId,
            actorSnapshot: actor.actorSnapshot,
            outcome: 'SUCCESS',
            requestId: actor.requestId ?? null,
            countryId: country.id,
            occurredAt: now,
            afterState: {
              configurationId: draftId,
              versionNumber: nextVersion,
              status: 'DRAFT',
              sourceConfigurationId: input.sourceConfigurationId ?? null,
            },
          },
          tx,
        );

        return draftId;
      });

      return await this.getConfigurationDetail(createdId, now);
    } catch (err) {
      throw this.translateDatabaseError(err);
    }
  }

  async listConfigurations(
    query: ListHomepageConfigurationsQuery,
    access: PermissionAccessResolution,
  ): Promise<PaginatedHomepageConfigurationsResult> {
    const page = Math.max(1, Math.trunc(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Math.trunc(query.pageSize ?? 20)));
    const offset = (page - 1) * pageSize;

    try {
      if (!access.hasGlobalGrant && access.countryIds.length === 0) {
        return {
          data: [],
          summary: null,
          pagination: { page, pageSize, totalCount: 0, totalPages: 0 },
        };
      }

      const conditions = [sql`1 = 1`];
      if (query.countryId) {
        conditions.push(sql`c.country_id = ${query.countryId}::uuid`);
      } else if (!access.hasGlobalGrant) {
        const allowedSql = sql.join(
          access.countryIds.map((cid) => sql`${cid}::uuid`),
          sql`, `,
        );
        conditions.push(sql`c.country_id IN (${allowedSql})`);
      }

      if (query.status) {
        conditions.push(
          sql`c.status = ${query.status}::"content"."homepage_config_status"`,
        );
      }

      const whereSql = sql.join(conditions, sql` AND `);

      const countRes = await this.dbInstance.execute(sql`
        SELECT COUNT(*)::int AS total
        FROM "content"."homepage_configurations" c
        WHERE ${whereSql}
      `);
      const totalCount = Number(countRes.rows[0]?.total ?? 0);
      const totalPages = Math.ceil(totalCount / pageSize);

      const listRes = await this.dbInstance.execute(sql`
        SELECT c.*
        FROM "content"."homepage_configurations" c
        WHERE ${whereSql}
        ORDER BY c.country_id ASC, c.version_number DESC
        LIMIT ${pageSize}
        OFFSET ${offset}
      `);

      let summary: PaginatedHomepageConfigurationsResult['summary'] = null;
      if (query.countryId) {
        const sumRes = await this.dbInstance.execute(sql`
          SELECT
            (
              SELECT id
              FROM "content"."homepage_configurations"
              WHERE country_id = ${query.countryId}::uuid AND status = 'DRAFT'
              LIMIT 1
            ) AS active_draft_id,
            (
              SELECT id
              FROM "content"."homepage_configurations"
              WHERE country_id = ${query.countryId}::uuid AND status = 'PUBLISHED'
              LIMIT 1
            ) AS active_published_id,
            (
              SELECT COUNT(*)::int
              FROM "content"."homepage_configurations"
              WHERE country_id = ${query.countryId}::uuid AND status = 'SCHEDULED'
            ) AS scheduled_count
        `);
        const sRow = sumRes.rows[0] as Record<string, any> | undefined;
        summary = {
          countryId: query.countryId,
          activeDraftId: sRow?.active_draft_id ? String(sRow.active_draft_id) : null,
          activePublishedId: sRow?.active_published_id
            ? String(sRow.active_published_id)
            : null,
          scheduledCount: Number(sRow?.scheduled_count ?? 0),
        };
      }

      return {
        data: listRes.rows.map((r) => mapSummaryRow(r as Record<string, any>)),
        summary,
        pagination: {
          page,
          pageSize,
          totalCount,
          totalPages,
        },
      };
    } catch (err) {
      throw this.translateDatabaseError(err);
    }
  }

  async getConfigurationDetail(
    configurationId: string,
    evalNow?: Date,
  ): Promise<HomepageConfigurationDetailDto> {
    const evalTime = evalNow ?? this.nowProvider();
    const evalIso = evalTime.toISOString();

    try {
      const cfgRes = await this.dbInstance.execute(sql`
        SELECT
          c.*,
          co.name AS country_name,
          co.iso_code AS country_iso_code,
          co.url_prefix AS country_url_prefix,
          co.currency_code AS country_currency_code
        FROM "content"."homepage_configurations" c
        JOIN "platform"."countries" co ON co.id = c.country_id
        WHERE c.id = ${configurationId}::uuid
        LIMIT 1
      `);
      const cfgRow = cfgRes.rows[0] as Record<string, any> | undefined;
      if (!cfgRow) {
        throw new HomepageError(
          'Homepage configuration was not found.',
          404,
          'HOMEPAGE_CONFIGURATION_NOT_FOUND',
        );
      }

      const countryId = String(cfgRow.country_id);

      const slotsRes = await this.dbInstance.execute(sql`
        SELECT *
        FROM "content"."homepage_configuration_slots"
        WHERE configuration_id = ${configurationId}::uuid
        ORDER BY slot_order ASC
      `);

      const itemsRes = await this.dbInstance.execute(sql`
        SELECT
          i.*,
          COALESCE(r.title, u.title, ce.title, s.name) AS entity_title,
          "content"."fn_evaluate_homepage_entity_eligibility"(
            ${countryId}::uuid,
            i.entity_type,
            COALESCE(i.resource_id, i.update_id, i.calendar_event_id, i.subject_id),
            ${evalIso}::timestamptz
          ) AS entity_diag
        FROM "content"."homepage_configuration_items" i
        LEFT JOIN "content"."resources" r ON r.id = i.resource_id
        LEFT JOIN "content"."education_updates" u ON u.id = i.update_id
        LEFT JOIN "calendar"."calendar_events" ce ON ce.id = i.calendar_event_id
        LEFT JOIN "taxonomy"."subjects" s ON s.id = i.subject_id
        WHERE i.configuration_id = ${configurationId}::uuid
        ORDER BY i.slot_id, i.position ASC
      `);

      const rbRes = await this.dbInstance.execute(sql`
        SELECT
          id,
          rolled_back_configuration_id,
          target_source_configuration_id,
          clone_configuration_id,
          txid::text AS txid,
          reason,
          actor_user_id,
          occurred_at
        FROM "content"."homepage_configuration_rollbacks"
        WHERE clone_configuration_id = ${configurationId}::uuid
           OR rolled_back_configuration_id = ${configurationId}::uuid
      `);

      let asClone: HomepageRollbackLedgerDto | null = null;
      let asRolledBackPredecessor: HomepageRollbackLedgerDto | null = null;
      for (const rawRb of rbRes.rows) {
        const rbRow = rawRb as Record<string, any>;
        const mapped = mapRollbackRow(rbRow);
        if (mapped.cloneConfigurationId === configurationId) {
          asClone = mapped;
        }
        if (mapped.rolledBackConfigurationId === configurationId) {
          asRolledBackPredecessor = mapped;
        }
      }

      const itemsBySlotId = new Map<string, HomepageAdminSlotItemDto[]>();
      for (const rawItem of itemsRes.rows) {
        const row = rawItem as Record<string, any>;
        const entityType = row.entity_type as HomepageEntityType;
        const entityId =
          extractPinnedItemEntityId({
            entityType,
            resourceId: row.resource_id,
            updateId: row.update_id,
            calendarEventId: row.calendar_event_id,
            subjectId: row.subject_id,
          }) ?? '';

        const startsAtDate = row.starts_at ? new Date(row.starts_at) : null;
        const endsAtDate = row.ends_at ? new Date(row.ends_at) : null;
        const pinDiag = evaluatePinWindow(startsAtDate, endsAtDate, evalTime);
        const entityDiag = String(
          row.entity_diag ?? 'ENTITY_NOT_FOUND',
        ) as HomepageEligibilityDiagnostic;

        const dto: HomepageAdminSlotItemDto = {
          id: String(row.id),
          position: Number(row.position),
          entityType,
          entityId,
          entityTitle:
            row.entity_title !== null && row.entity_title !== undefined
              ? String(row.entity_title)
              : null,
          startsAt: toIsoOrNull(row.starts_at),
          endsAt: toIsoOrNull(row.ends_at),
          pinNote:
            row.pin_note !== null && row.pin_note !== undefined
              ? String(row.pin_note)
              : null,
          liveEligible: entityDiag === 'ELIGIBLE' && pinDiag === 'ELIGIBLE',
          entityDiagnostic: entityDiag,
          pinWindowDiagnostic: pinDiag,
          createdBy: String(row.created_by),
          createdAt: toIsoRequired(row.created_at),
          updatedAt: toIsoRequired(row.updated_at),
        };

        const slotId = String(row.slot_id);
        const list = itemsBySlotId.get(slotId) ?? [];
        list.push(dto);
        itemsBySlotId.set(slotId, list);
      }

      const slots: HomepageAdminSlotDto[] = slotsRes.rows.map((rawSlot) => {
        const s = rawSlot as Record<string, any>;
        const slotId = String(s.id);
        return {
          id: slotId,
          slotKey: s.slot_key as HomepageSlotKey,
          slotOrder: Number(s.slot_order) as 1 | 2 | 3 | 4 | 5 | 6,
          entityType: s.entity_type as HomepageEntityType,
          mode: s.mode as HomepageSlotMode,
          sectionTitle: String(s.section_title),
          sectionSubtitle:
            s.section_subtitle !== null && s.section_subtitle !== undefined
              ? String(s.section_subtitle)
              : null,
          maxItems: Number(s.max_items),
          items: itemsBySlotId.get(slotId) ?? [],
        };
      });

      return {
        ...mapSummaryRow(cfgRow),
        country: {
          id: countryId,
          name: String(cfgRow.country_name),
          isoCode: String(cfgRow.country_iso_code),
          urlPrefix: String(cfgRow.country_url_prefix),
          currencyCode: String(cfgRow.country_currency_code),
        },
        evaluatedAt: evalIso,
        slots,
        rollbackProvenance: {
          asClone,
          asRolledBackPredecessor,
        },
      };
    } catch (err) {
      throw this.translateDatabaseError(err);
    }
  }

  async updateDraft(
    configurationId: string,
    input: UpdateHomepageDraftInput,
    actor: HomepageAdminActorContext,
  ): Promise<HomepageConfigurationDetailDto> {
    if (input.title !== undefined) {
      const trimmed = input.title.trim();
      if (trimmed.length < 1 || trimmed.length > 160) {
        throw new HomepageError(
          'Draft title must be between 1 and 160 non-whitespace characters.',
          400,
          'VALIDATION_ERROR',
        );
      }
    }
    if (input.notes !== undefined && input.notes !== null && input.notes.length > 2000) {
      throw new HomepageError(
        'Draft notes cannot exceed 2000 characters.',
        400,
        'VALIDATION_ERROR',
      );
    }

    const now = this.nowProvider();
    const nowIso = now.toISOString();

    try {
      await this.dbInstance.transaction(async (tx) => {
        const cfgRes = await tx.execute(sql`
          SELECT id, country_id, status, title, notes
          FROM "content"."homepage_configurations"
          WHERE id = ${configurationId}::uuid
          FOR UPDATE
        `);
        const cfg = cfgRes.rows[0] as Record<string, any> | undefined;
        if (!cfg) {
          throw new HomepageError(
            'Homepage configuration was not found.',
            404,
            'HOMEPAGE_CONFIGURATION_NOT_FOUND',
          );
        }

        const countryId = String(cfg.country_id);
        await this.acquireCountryLock(tx, countryId);

        if (cfg.status !== 'DRAFT') {
          throw new HomepageError(
            `Only DRAFT homepage configurations can be edited (current status: ${cfg.status}).`,
            409,
            'INVALID_CONFIGURATION_STATE',
          );
        }

        const nextTitle =
          input.title !== undefined ? input.title.trim() : String(cfg.title);
        const nextNotes =
          input.notes !== undefined
            ? input.notes
            : cfg.notes !== null
              ? String(cfg.notes)
              : null;

        if (input.slots && input.slots.length > 0) {
          const seenKeys = new Set<HomepageSlotKey>();
          for (const s of input.slots) {
            if (seenKeys.has(s.slotKey)) {
              throw new HomepageError(
                `Duplicate slotKey '${s.slotKey}' in update payload.`,
                400,
                'VALIDATION_ERROR',
              );
            }
            seenKeys.add(s.slotKey);
          }

          const existingSlotsRes = await tx.execute(sql`
            SELECT id, slot_key, entity_type, mode, section_title, section_subtitle, max_items
            FROM "content"."homepage_configuration_slots"
            WHERE configuration_id = ${configurationId}::uuid
            FOR UPDATE
          `);
          const slotRowByKey = new Map<HomepageSlotKey, Record<string, any>>();
          for (const r of existingSlotsRes.rows) {
            const row = r as Record<string, any>;
            slotRowByKey.set(row.slot_key as HomepageSlotKey, row);
          }

          for (const slotPatch of input.slots) {
            const existingSlot = slotRowByKey.get(slotPatch.slotKey);
            if (!existingSlot) {
              throw new HomepageError(
                `Canonical slot '${slotPatch.slotKey}' is missing on configuration.`,
                422,
                'MISSING_CANONICAL_SLOT',
              );
            }

            const slotId = String(existingSlot.id);
            const entityType = existingSlot.entity_type as HomepageEntityType;
            const nextMode: HomepageSlotMode =
              slotPatch.mode ?? (existingSlot.mode as HomepageSlotMode);
            const nextSectionTitle =
              slotPatch.sectionTitle !== undefined
                ? slotPatch.sectionTitle.trim()
                : String(existingSlot.section_title);
            if (nextSectionTitle.length < 1 || nextSectionTitle.length > 120) {
              throw new HomepageError(
                `Section title for '${slotPatch.slotKey}' must be 1 to 120 characters.`,
                400,
                'VALIDATION_ERROR',
              );
            }

            const nextSubtitle =
              slotPatch.sectionSubtitle !== undefined
                ? slotPatch.sectionSubtitle
                : existingSlot.section_subtitle !== null
                  ? String(existingSlot.section_subtitle)
                  : null;
            if (nextSubtitle !== null && nextSubtitle.length > 240) {
              throw new HomepageError(
                `Section subtitle for '${slotPatch.slotKey}' cannot exceed 240 characters.`,
                400,
                'VALIDATION_ERROR',
              );
            }

            const nextMaxItems =
              slotPatch.maxItems ?? Number(existingSlot.max_items);
            if (!Number.isInteger(nextMaxItems) || nextMaxItems < 1 || nextMaxItems > 6) {
              throw new HomepageError(
                `maxItems for '${slotPatch.slotKey}' must be an integer between 1 and 6.`,
                400,
                'VALIDATION_ERROR',
              );
            }

            if (slotPatch.items !== undefined) {
              // Delete existing items BEFORE reducing max_items on the slot so
              // trg_homepage_slots_mutation_guard sees no overflowing positions.
              await tx.execute(sql`
                DELETE FROM "content"."homepage_configuration_items"
                WHERE slot_id = ${slotId}::uuid
              `);
            } else if (nextMaxItems < Number(existingSlot.max_items)) {
              const overflowRes = await tx.execute(sql`
                SELECT COUNT(*)::int AS cnt
                FROM "content"."homepage_configuration_items"
                WHERE slot_id = ${slotId}::uuid
                  AND position > ${nextMaxItems}
              `);
              if (Number(overflowRes.rows[0]?.cnt ?? 0) > 0) {
                throw new HomepageError(
                  `Cannot reduce maxItems to ${nextMaxItems} for '${slotPatch.slotKey}' while pinned items exist beyond position ${nextMaxItems}.`,
                  422,
                  'MAX_ITEMS_BELOW_PINNED_COUNT',
                );
              }
            }

            await tx.execute(sql`
              UPDATE "content"."homepage_configuration_slots"
              SET
                mode = ${nextMode}::"content"."homepage_slot_mode",
                section_title = ${nextSectionTitle},
                section_subtitle = ${nextSubtitle},
                max_items = ${nextMaxItems},
                updated_at = ${nowIso}::timestamptz
              WHERE id = ${slotId}::uuid
            `);

            if (slotPatch.items !== undefined) {
              await this.validateAndInsertSlotItems(
                tx,
                {
                  configurationId,
                  slotId,
                  slotKey: slotPatch.slotKey,
                  entityType,
                  countryId,
                  maxItems: nextMaxItems,
                  items: slotPatch.items,
                  requireLiveEligibility: true,
                },
                actor.actorUserId,
                now,
              );
            }
          }
        }

        await tx.execute(sql`
          UPDATE "content"."homepage_configurations"
          SET
            title = ${nextTitle},
            notes = ${nextNotes},
            updated_by = ${actor.actorUserId}::uuid,
            updated_at = ${nowIso}::timestamptz
          WHERE id = ${configurationId}::uuid
        `);

        await this.auditService.logEvent(
          {
            action: 'homepage.draft.update',
            entityType: 'HOMEPAGE_CONFIGURATION',
            entityId: configurationId,
            actorType: 'AUTHENTICATED',
            actorUserId: actor.actorUserId,
            actorSnapshot: actor.actorSnapshot,
            outcome: 'SUCCESS',
            requestId: actor.requestId ?? null,
            countryId,
            occurredAt: now,
            afterState: {
              configurationId,
              title: nextTitle,
              updatedSlotKeys: (input.slots ?? []).map((s) => s.slotKey),
            },
          },
          tx,
        );
      });

      return await this.getConfigurationDetail(configurationId, now);
    } catch (err) {
      throw this.translateDatabaseError(err);
    }
  }

  async previewHomepage(
    input: AdminPreviewHomepageInput,
  ): Promise<HomepagePreviewRenderResult> {
    // Fail-closed evaluation timestamp parsing (C61)
    const parsedEval = parseEvaluationTimestamp(input.evaluateAt, this.nowProvider);
    if (!parsedEval.ok) {
      throw new HomepageError(parsedEval.message, 400, parsedEval.code);
    }
    const evalTime = parsedEval.date;

    if (!input.configurationId && !input.countryId) {
      throw new HomepageError(
        'Preview requires either configurationId or countryId.',
        400,
        'VALIDATION_ERROR',
      );
    }

    try {
      if (input.configurationId) {
        const cfgRes = await this.dbInstance.execute(sql`
          SELECT id, country_id, version_number, status
          FROM "content"."homepage_configurations"
          WHERE id = ${input.configurationId}::uuid
          LIMIT 1
        `);
        const cfg = cfgRes.rows[0] as Record<string, any> | undefined;
        if (!cfg) {
          throw new HomepageError(
            'Homepage configuration was not found.',
            404,
            'HOMEPAGE_CONFIGURATION_NOT_FOUND',
          );
        }

        const cfgCountryId = String(cfg.country_id);
        if (input.countryId && input.countryId !== cfgCountryId) {
          throw new HomepageError(
            'Provided countryId does not match the configuration country.',
            422,
            'COUNTRY_CONFIGURATION_MISMATCH',
          );
        }

        const country = await this.requireCountryForWrite(cfgCountryId);
        const baseSlots = await this.loadConfigurationPreviewSlots(
          input.configurationId,
        );
        const mergedSlots = this.mergePreviewSlotOverrides(
          baseSlots,
          input.slots,
        );

        return await this.homepageService.renderPreview({
          country,
          source: 'CONFIGURATION_PREVIEW',
          configuration: {
            id: String(cfg.id),
            versionNumber: Number(cfg.version_number),
            status: cfg.status as HomepageConfigStatus,
          },
          slots: mergedSlots,
          evalTime,
        });
      }

      const country = await this.requireCountryForWrite(input.countryId!);

      if (input.slots && input.slots.length > 0) {
        const defaultSlots: PreviewSlotInput[] = CANONICAL_HOMEPAGE_SLOTS.map(
          (spec) => ({
            slotKey: spec.slotKey,
            mode: 'AUTOMATED',
            sectionTitle: spec.defaultTitle,
            sectionSubtitle: spec.defaultSubtitle,
            maxItems: spec.defaultMaxItems,
            items: [],
          }),
        );
        const mergedSlots = this.mergePreviewSlotOverrides(
          defaultSlots,
          input.slots,
        );
        return await this.homepageService.renderPreview({
          country,
          source: 'AD_HOC_PREVIEW',
          configuration: null,
          slots: mergedSlots,
          evalTime,
        });
      }

      // Check if an active PUBLISHED configuration exists for country
      const activePubRes = await this.dbInstance.execute(sql`
        SELECT id, version_number, status
        FROM "content"."homepage_configurations"
        WHERE country_id = ${country.id}::uuid
          AND status = 'PUBLISHED'
        LIMIT 1
      `);
      const activePub = activePubRes.rows[0] as Record<string, any> | undefined;
      if (activePub) {
        const pubSlots = await this.loadConfigurationPreviewSlots(
          String(activePub.id),
        );
        return await this.homepageService.renderPreview({
          country,
          source: 'PUBLISHED_CONFIGURATION',
          configuration: {
            id: String(activePub.id),
            versionNumber: Number(activePub.version_number),
            status: activePub.status as HomepageConfigStatus,
          },
          slots: pubSlots,
          evalTime,
        });
      }

      const fallbackSlots: PreviewSlotInput[] = CANONICAL_HOMEPAGE_SLOTS.map(
        (spec) => ({
          slotKey: spec.slotKey,
          mode: 'AUTOMATED',
          sectionTitle: spec.defaultTitle,
          sectionSubtitle: spec.defaultSubtitle,
          maxItems: spec.defaultMaxItems,
          items: [],
        }),
      );
      return await this.homepageService.renderPreview({
        country,
        source: 'DEFAULT_FALLBACK',
        configuration: null,
        slots: fallbackSlots,
        evalTime,
      });
    } catch (err) {
      throw this.translateDatabaseError(err);
    }
  }

  async scheduleConfiguration(
    configurationId: string,
    input: ScheduleHomepageConfigurationInput,
    actor: HomepageAdminActorContext,
  ): Promise<HomepageConfigurationDetailDto> {
    const action = input.action ?? 'SCHEDULE';
    const now = this.nowProvider();
    const nowIso = now.toISOString();

    try {
      await this.dbInstance.transaction(async (tx) => {
        const cfgRes = await tx.execute(sql`
          SELECT id, country_id, status, version_number
          FROM "content"."homepage_configurations"
          WHERE id = ${configurationId}::uuid
          FOR UPDATE
        `);
        const cfg = cfgRes.rows[0] as Record<string, any> | undefined;
        if (!cfg) {
          throw new HomepageError(
            'Homepage configuration was not found.',
            404,
            'HOMEPAGE_CONFIGURATION_NOT_FOUND',
          );
        }

        const countryId = String(cfg.country_id);
        await this.acquireCountryLock(tx, countryId);

        if (action === 'UNSCHEDULE') {
          if (cfg.status !== 'SCHEDULED') {
            throw new HomepageError(
              `Only SCHEDULED homepage configurations can be unscheduled to DRAFT (current status: ${cfg.status}).`,
              409,
              'INVALID_CONFIGURATION_STATE',
            );
          }

          const existingDraftRes = await tx.execute(sql`
            SELECT id
            FROM "content"."homepage_configurations"
            WHERE country_id = ${countryId}::uuid
              AND status = 'DRAFT'
            LIMIT 1
          `);
          if (existingDraftRes.rows.length > 0) {
            throw new HomepageError(
              'Cannot unschedule to DRAFT while another active DRAFT exists for this country. Discard the existing draft or use action CANCEL.',
              409,
              'ACTIVE_DRAFT_ALREADY_EXISTS',
            );
          }

          await tx.execute(sql`
            UPDATE "content"."homepage_configurations"
            SET
              status = 'DRAFT',
              scheduled_start_at = NULL,
              scheduled_until_at = NULL,
              updated_by = ${actor.actorUserId}::uuid,
              updated_at = ${nowIso}::timestamptz
            WHERE id = ${configurationId}::uuid
          `);

          await this.auditService.logEvent(
            {
              action: 'homepage.configuration.unschedule',
              entityType: 'HOMEPAGE_CONFIGURATION',
              entityId: configurationId,
              actorType: 'AUTHENTICATED',
              actorUserId: actor.actorUserId,
              actorSnapshot: actor.actorSnapshot,
              outcome: 'SUCCESS',
              requestId: actor.requestId ?? null,
              countryId,
              occurredAt: now,
              beforeState: { status: 'SCHEDULED' },
              afterState: { status: 'DRAFT' },
            },
            tx,
          );
          return;
        }

        if (action === 'CANCEL') {
          if (cfg.status !== 'SCHEDULED') {
            throw new HomepageError(
              `Only SCHEDULED homepage configurations can be cancelled via schedule endpoint (current status: ${cfg.status}).`,
              409,
              'INVALID_CONFIGURATION_STATE',
            );
          }
          const trimmedReason = (input.reason ?? '').trim();
          if (trimmedReason.length < 3 || trimmedReason.length > 1000) {
            throw new HomepageError(
              'Cancellation reason must be between 3 and 1000 characters.',
              400,
              'VALIDATION_ERROR',
            );
          }

          await tx.execute(sql`
            UPDATE "content"."homepage_configurations"
            SET
              status = 'DISCARDED',
              discarded_at = ${nowIso}::timestamptz,
              discarded_by = ${actor.actorUserId}::uuid,
              discard_reason = ${trimmedReason},
              updated_by = ${actor.actorUserId}::uuid,
              updated_at = ${nowIso}::timestamptz
            WHERE id = ${configurationId}::uuid
          `);

          await this.auditService.logEvent(
            {
              action: 'homepage.configuration.schedule_cancel',
              entityType: 'HOMEPAGE_CONFIGURATION',
              entityId: configurationId,
              actorType: 'AUTHENTICATED',
              actorUserId: actor.actorUserId,
              actorSnapshot: actor.actorSnapshot,
              outcome: 'SUCCESS',
              requestId: actor.requestId ?? null,
              countryId,
              occurredAt: now,
              beforeState: { status: 'SCHEDULED' },
              afterState: { status: 'DISCARDED', discardReason: trimmedReason },
            },
            tx,
          );
          return;
        }

        // action === 'SCHEDULE'
        if (cfg.status !== 'DRAFT' && cfg.status !== 'SCHEDULED') {
          throw new HomepageError(
            `Only DRAFT or SCHEDULED homepage configurations can be scheduled (current status: ${cfg.status}).`,
            409,
            'INVALID_CONFIGURATION_STATE',
          );
        }

        await this.requireCountryForWrite(countryId, tx);

        if (!input.scheduledStartAt) {
          throw new HomepageError(
            'scheduledStartAt is required when scheduling a homepage configuration.',
            400,
            'VALIDATION_ERROR',
          );
        }

        const startAt = parseOptionalFiniteTimestamp(
          input.scheduledStartAt,
          'scheduledStartAt',
        )!;
        const untilAt = parseOptionalFiniteTimestamp(
          input.scheduledUntilAt,
          'scheduledUntilAt',
        );

        if (startAt.getTime() <= now.getTime()) {
          throw new HomepageError(
            'scheduledStartAt must be in the future.',
            422,
            'INVALID_SCHEDULE_WINDOW',
          );
        }

        if (untilAt !== null && untilAt.getTime() <= startAt.getTime()) {
          throw new HomepageError(
            'scheduledUntilAt must be strictly greater than scheduledStartAt.',
            422,
            'INVALID_SCHEDULE_WINDOW',
          );
        }

        await this.assertConfigurationReadyForActivation(
          tx,
          configurationId,
          countryId,
          now,
          startAt,
        );

        await tx.execute(sql`
          UPDATE "content"."homepage_configurations"
          SET
            status = 'SCHEDULED',
            scheduled_start_at = ${startAt.toISOString()}::timestamptz,
            scheduled_until_at = ${untilAt ? untilAt.toISOString() : null}::timestamptz,
            updated_by = ${actor.actorUserId}::uuid,
            updated_at = ${nowIso}::timestamptz
          WHERE id = ${configurationId}::uuid
        `);

        await tx.execute(sql`
          SET CONSTRAINTS "content"."trg_homepage_cfg_publish_completeness" IMMEDIATE
        `);

        await this.auditService.logEvent(
          {
            action: 'homepage.configuration.schedule',
            entityType: 'HOMEPAGE_CONFIGURATION',
            entityId: configurationId,
            actorType: 'AUTHENTICATED',
            actorUserId: actor.actorUserId,
            actorSnapshot: actor.actorSnapshot,
            outcome: 'SUCCESS',
            requestId: actor.requestId ?? null,
            countryId,
            occurredAt: now,
            beforeState: { status: cfg.status },
            afterState: {
              status: 'SCHEDULED',
              scheduledStartAt: startAt.toISOString(),
              scheduledUntilAt: untilAt ? untilAt.toISOString() : null,
            },
          },
          tx,
        );
      });

      return await this.getConfigurationDetail(configurationId, now);
    } catch (err) {
      throw this.translateDatabaseError(err);
    }
  }

  async publishConfiguration(
    configurationId: string,
    input: PublishHomepageConfigurationInput,
    actor: HomepageAdminActorContext,
  ): Promise<HomepageConfigurationDetailDto> {
    const now = this.nowProvider();
    const nowIso = now.toISOString();

    let targetCountryId = '';

    try {
      await this.dbInstance.transaction(async (tx) => {
        const cfgRes = await tx.execute(sql`
          SELECT id, country_id, status, version_number, scheduled_until_at
          FROM "content"."homepage_configurations"
          WHERE id = ${configurationId}::uuid
          FOR UPDATE
        `);
        const cfg = cfgRes.rows[0] as Record<string, any> | undefined;
        if (!cfg) {
          throw new HomepageError(
            'Homepage configuration was not found.',
            404,
            'HOMEPAGE_CONFIGURATION_NOT_FOUND',
          );
        }

        const countryId = String(cfg.country_id);
        targetCountryId = countryId;
        await this.acquireCountryLock(tx, countryId);

        if (cfg.status !== 'DRAFT' && cfg.status !== 'SCHEDULED') {
          throw new HomepageError(
            `Only DRAFT or SCHEDULED homepage configurations can be published (current status: ${cfg.status}).`,
            409,
            'INVALID_CONFIGURATION_STATE',
          );
        }

        await this.requireCountryForWrite(countryId, tx);

        let effectiveUntil: Date | null;
        if (input.scheduledUntilAt !== undefined) {
          effectiveUntil = parseOptionalFiniteTimestamp(
            input.scheduledUntilAt,
            'scheduledUntilAt',
          );
        } else {
          effectiveUntil = cfg.scheduled_until_at
            ? new Date(cfg.scheduled_until_at)
            : null;
        }

        if (effectiveUntil !== null && effectiveUntil.getTime() <= now.getTime()) {
          throw new HomepageError(
            'scheduledUntilAt must be strictly in the future when publishing.',
            422,
            'INVALID_SCHEDULE_WINDOW',
          );
        }

        await this.assertConfigurationReadyForActivation(
          tx,
          configurationId,
          countryId,
          now,
          now,
        );

        const prevPubRes = await tx.execute(sql`
          SELECT id, version_number
          FROM "content"."homepage_configurations"
          WHERE country_id = ${countryId}::uuid
            AND status = 'PUBLISHED'
          FOR UPDATE
        `);
        const prevPub = prevPubRes.rows[0] as Record<string, any> | undefined;

        if (prevPub) {
          await tx.execute(sql`
            UPDATE "content"."homepage_configurations"
            SET
              status = 'SUPERSEDED',
              superseded_at = ${nowIso}::timestamptz,
              superseded_by_configuration_id = ${configurationId}::uuid,
              updated_by = ${actor.actorUserId}::uuid,
              updated_at = ${nowIso}::timestamptz
            WHERE id = ${String(prevPub.id)}::uuid
          `);
        }

        await tx.execute(sql`
          UPDATE "content"."homepage_configurations"
          SET
            status = 'PUBLISHED',
            scheduled_start_at = NULL,
            scheduled_until_at = ${effectiveUntil ? effectiveUntil.toISOString() : null}::timestamptz,
            published_at = ${nowIso}::timestamptz,
            published_by = ${actor.actorUserId}::uuid,
            updated_by = ${actor.actorUserId}::uuid,
            updated_at = ${nowIso}::timestamptz
          WHERE id = ${configurationId}::uuid
        `);

        await tx.execute(sql`
          SET CONSTRAINTS
            "content"."fk_homepage_cfg_superseded_by",
            "content"."trg_homepage_cfg_publish_completeness"
          IMMEDIATE
        `);

        await this.auditService.logEvent(
          {
            action: 'homepage.configuration.publish',
            entityType: 'HOMEPAGE_CONFIGURATION',
            entityId: configurationId,
            actorType: 'AUTHENTICATED',
            actorUserId: actor.actorUserId,
            actorSnapshot: actor.actorSnapshot,
            outcome: 'SUCCESS',
            requestId: actor.requestId ?? null,
            countryId,
            occurredAt: now,
            beforeState: {
              status: cfg.status,
              previousPublishedId: prevPub ? String(prevPub.id) : null,
            },
            afterState: {
              status: 'PUBLISHED',
              versionNumber: Number(cfg.version_number),
              scheduledUntilAt: effectiveUntil ? effectiveUntil.toISOString() : null,
            },
          },
          tx,
        );
      });

      if (targetCountryId) {
        this.cacheService.invalidateCountry(targetCountryId);
      }

      return await this.getConfigurationDetail(configurationId, now);
    } catch (err) {
      throw this.translateDatabaseError(err);
    }
  }

  async discardDraft(
    configurationId: string,
    input: DiscardHomepageDraftInput,
    actor: HomepageAdminActorContext,
  ): Promise<HomepageConfigurationDetailDto> {
    const trimmedReason = input.reason.trim();
    if (trimmedReason.length < 3 || trimmedReason.length > 1000) {
      throw new HomepageError(
        'Discard reason must be between 3 and 1000 characters.',
        400,
        'VALIDATION_ERROR',
      );
    }

    const now = this.nowProvider();
    const nowIso = now.toISOString();

    try {
      await this.dbInstance.transaction(async (tx) => {
        const cfgRes = await tx.execute(sql`
          SELECT id, country_id, status
          FROM "content"."homepage_configurations"
          WHERE id = ${configurationId}::uuid
          FOR UPDATE
        `);
        const cfg = cfgRes.rows[0] as Record<string, any> | undefined;
        if (!cfg) {
          throw new HomepageError(
            'Homepage configuration was not found.',
            404,
            'HOMEPAGE_CONFIGURATION_NOT_FOUND',
          );
        }

        const countryId = String(cfg.country_id);
        await this.acquireCountryLock(tx, countryId);

        if (cfg.status !== 'DRAFT') {
          throw new HomepageError(
            `Only DRAFT homepage configurations can be discarded via this endpoint (current status: ${cfg.status}).`,
            409,
            'INVALID_CONFIGURATION_STATE',
          );
        }

        await tx.execute(sql`
          UPDATE "content"."homepage_configurations"
          SET
            status = 'DISCARDED',
            discarded_at = ${nowIso}::timestamptz,
            discarded_by = ${actor.actorUserId}::uuid,
            discard_reason = ${trimmedReason},
            updated_by = ${actor.actorUserId}::uuid,
            updated_at = ${nowIso}::timestamptz
          WHERE id = ${configurationId}::uuid
        `);

        await this.auditService.logEvent(
          {
            action: 'homepage.draft.discard',
            entityType: 'HOMEPAGE_CONFIGURATION',
            entityId: configurationId,
            actorType: 'AUTHENTICATED',
            actorUserId: actor.actorUserId,
            actorSnapshot: actor.actorSnapshot,
            outcome: 'SUCCESS',
            requestId: actor.requestId ?? null,
            countryId,
            occurredAt: now,
            beforeState: { status: 'DRAFT' },
            afterState: { status: 'DISCARDED', discardReason: trimmedReason },
          },
          tx,
        );
      });

      return await this.getConfigurationDetail(configurationId, now);
    } catch (err) {
      throw this.translateDatabaseError(err);
    }
  }

  async rollbackConfiguration(
    input: RollbackHomepageConfigurationInput,
    actor: HomepageAdminActorContext,
  ): Promise<RollbackHomepageConfigurationResult> {
    const trimmedReason = input.reason.trim();
    if (trimmedReason.length < 3 || trimmedReason.length > 1000) {
      throw new HomepageError(
        'Rollback reason must be between 3 and 1000 characters.',
        400,
        'VALIDATION_ERROR',
      );
    }

    const now = this.nowProvider();
    const nowIso = now.toISOString();

    try {
      const country = await this.requireCountryForWrite(input.countryId);

      const txResult = await this.dbInstance.transaction(async (tx) => {
        await this.acquireCountryLock(tx, country.id);

        const activePubRes = await tx.execute(sql`
          SELECT id, version_number, status
          FROM "content"."homepage_configurations"
          WHERE country_id = ${country.id}::uuid
            AND status = 'PUBLISHED'
          FOR UPDATE
        `);
        const activePub = activePubRes.rows[0] as Record<string, any> | undefined;
        if (!activePub) {
          throw new HomepageError(
            'No active PUBLISHED homepage configuration exists for this country to roll back.',
            409,
            'NO_PUBLISHED_CONFIGURATION_TO_ROLLBACK',
          );
        }

        const targetRes = await tx.execute(sql`
          SELECT id, version_number, title, notes, status
          FROM "content"."homepage_configurations"
          WHERE id = ${input.targetConfigurationId}::uuid
            AND country_id = ${country.id}::uuid
          FOR UPDATE
        `);
        const target = targetRes.rows[0] as Record<string, any> | undefined;
        if (!target) {
          throw new HomepageError(
            'Target historical homepage configuration was not found in this country.',
            404,
            'ROLLBACK_TARGET_NOT_FOUND',
          );
        }

        const predecessorId = String(activePub.id);
        const targetId = String(target.id);
        const targetStatus = String(target.status) as HomepageConfigStatus;

        if (
          targetId === predecessorId ||
          !['SUPERSEDED', 'ROLLED_BACK', 'ARCHIVED'].includes(targetStatus)
        ) {
          throw new HomepageError(
            `Rollback target must be a historical configuration in SUPERSEDED, ROLLED_BACK, or ARCHIVED status (received: ${targetStatus}).`,
            409,
            'INVALID_ROLLBACK_TARGET_STATE',
          );
        }

        // Validate target completeness and live item eligibility at rollback time
        await this.assertConfigurationReadyForActivation(
          tx,
          targetId,
          country.id,
          now,
          now,
          'INELIGIBLE_ROLLBACK_TARGET',
        );

        const targetSlotsRes = await tx.execute(sql`
          SELECT
            id,
            slot_key,
            slot_order,
            entity_type,
            mode,
            section_title,
            section_subtitle,
            max_items
          FROM "content"."homepage_configuration_slots"
          WHERE configuration_id = ${targetId}::uuid
          ORDER BY slot_order ASC
        `);

        const targetItemsRes = await tx.execute(sql`
          SELECT
            slot_id,
            entity_type,
            position,
            resource_id,
            update_id,
            calendar_event_id,
            subject_id,
            starts_at,
            ends_at,
            pin_note
          FROM "content"."homepage_configuration_items"
          WHERE configuration_id = ${targetId}::uuid
          ORDER BY slot_id, position ASC
        `);

        const nextVerRes = await tx.execute(sql`
          SELECT (COALESCE(MAX(version_number), 0) + 1)::int AS next_version
          FROM "content"."homepage_configurations"
          WHERE country_id = ${country.id}::uuid
        `);
        const nextVersion = Number(nextVerRes.rows[0]?.next_version ?? 1);
        const cloneId = crypto.randomUUID();
        const rollbackId = crypto.randomUUID();

        // Step 1: Transition active PUBLISHED predecessor -> ROLLED_BACK
        await tx.execute(sql`
          UPDATE "content"."homepage_configurations"
          SET
            status = 'ROLLED_BACK',
            rolled_back_at = ${nowIso}::timestamptz,
            rolled_back_by = ${actor.actorUserId}::uuid,
            rollback_reason = ${trimmedReason},
            updated_by = ${actor.actorUserId}::uuid,
            updated_at = ${nowIso}::timestamptz
          WHERE id = ${predecessorId}::uuid
        `);

        // Step 2: Insert newly versioned unscheduled PUBLISHED clone
        await tx.execute(sql`
          INSERT INTO "content"."homepage_configurations" (
            id,
            country_id,
            version_number,
            title,
            notes,
            status,
            scheduled_start_at,
            scheduled_until_at,
            published_at,
            published_by,
            restored_from_configuration_id,
            created_by,
            updated_by,
            created_at,
            updated_at
          ) VALUES (
            ${cloneId}::uuid,
            ${country.id}::uuid,
            ${nextVersion},
            ${String(target.title)},
            ${target.notes ?? null},
            'PUBLISHED',
            NULL,
            NULL,
            ${nowIso}::timestamptz,
            ${actor.actorUserId}::uuid,
            ${targetId}::uuid,
            ${actor.actorUserId}::uuid,
            ${actor.actorUserId}::uuid,
            ${nowIso}::timestamptz,
            ${nowIso}::timestamptz
          )
        `);

        // Step 3: Insert immutable xid8 rollback pairing row BEFORE cloning slots/items
        // so slot & item mutation triggers immediately verify same-transaction pairing.
        const rbInsertRes = await tx.execute(sql`
          INSERT INTO "content"."homepage_configuration_rollbacks" (
            id,
            country_id,
            rolled_back_configuration_id,
            target_source_configuration_id,
            clone_configuration_id,
            txid,
            reason,
            actor_user_id,
            occurred_at
          ) VALUES (
            ${rollbackId}::uuid,
            ${country.id}::uuid,
            ${predecessorId}::uuid,
            ${targetId}::uuid,
            ${cloneId}::uuid,
            pg_current_xact_id(),
            ${trimmedReason},
            ${actor.actorUserId}::uuid,
            ${nowIso}::timestamptz
          )
          RETURNING
            id,
            rolled_back_configuration_id,
            target_source_configuration_id,
            clone_configuration_id,
            txid::text AS txid,
            reason,
            actor_user_id,
            occurred_at
        `);
        const rbLedger = mapRollbackRow(
          rbInsertRes.rows[0] as Record<string, any>,
        );

        // Step 4: Clone all 6 canonical slots and pinned items
        const newSlotIdByOldSlotId = new Map<string, string>();
        for (const rawSlot of targetSlotsRes.rows) {
          const s = rawSlot as Record<string, any>;
          const newSlotId = crypto.randomUUID();
          newSlotIdByOldSlotId.set(String(s.id), newSlotId);

          await tx.execute(sql`
            INSERT INTO "content"."homepage_configuration_slots" (
              id,
              configuration_id,
              country_id,
              slot_key,
              slot_order,
              entity_type,
              mode,
              section_title,
              section_subtitle,
              max_items,
              created_at,
              updated_at
            ) VALUES (
              ${newSlotId}::uuid,
              ${cloneId}::uuid,
              ${country.id}::uuid,
              ${String(s.slot_key)}::"content"."homepage_slot_key",
              ${Number(s.slot_order)},
              ${String(s.entity_type)}::"content"."homepage_entity_type",
              ${String(s.mode)}::"content"."homepage_slot_mode",
              ${String(s.section_title)},
              ${s.section_subtitle ?? null},
              ${Number(s.max_items)},
              ${nowIso}::timestamptz,
              ${nowIso}::timestamptz
            )
          `);
        }

        for (const rawItem of targetItemsRes.rows) {
          const i = rawItem as Record<string, any>;
          const mappedSlotId = newSlotIdByOldSlotId.get(String(i.slot_id));
          if (!mappedSlotId) continue;

          await tx.execute(sql`
            INSERT INTO "content"."homepage_configuration_items" (
              id,
              slot_id,
              configuration_id,
              country_id,
              entity_type,
              position,
              resource_id,
              update_id,
              calendar_event_id,
              subject_id,
              starts_at,
              ends_at,
              pin_note,
              created_by,
              created_at,
              updated_at
            ) VALUES (
              ${crypto.randomUUID()}::uuid,
              ${mappedSlotId}::uuid,
              ${cloneId}::uuid,
              ${country.id}::uuid,
              ${String(i.entity_type)}::"content"."homepage_entity_type",
              ${Number(i.position)},
              ${i.resource_id ?? null}::uuid,
              ${i.update_id ?? null}::uuid,
              ${i.calendar_event_id ?? null}::uuid,
              ${i.subject_id ?? null}::uuid,
              ${i.starts_at ? toIsoRequired(i.starts_at) : null}::timestamptz,
              ${i.ends_at ? toIsoRequired(i.ends_at) : null}::timestamptz,
              ${i.pin_note ?? null},
              ${actor.actorUserId}::uuid,
              ${nowIso}::timestamptz,
              ${nowIso}::timestamptz
            )
          `);
        }

        // Step 5: Eagerly verify deferred completeness & bidirectional xid8 handshake triggers
        await tx.execute(sql`
          SET CONSTRAINTS
            "content"."trg_homepage_cfg_publish_completeness",
            "content"."trg_homepage_rollbacks_handshake"
          IMMEDIATE
        `);

        // Step 6: Transactional audit log
        await this.auditService.logEvent(
          {
            action: 'homepage.configuration.rollback',
            entityType: 'HOMEPAGE_CONFIGURATION',
            entityId: cloneId,
            actorType: 'AUTHENTICATED',
            actorUserId: actor.actorUserId,
            actorSnapshot: actor.actorSnapshot,
            outcome: 'SUCCESS',
            requestId: actor.requestId ?? null,
            countryId: country.id,
            occurredAt: now,
            beforeState: {
              rolledBackConfigurationId: predecessorId,
              previousVersionNumber: Number(activePub.version_number),
            },
            afterState: {
              cloneConfigurationId: cloneId,
              cloneVersionNumber: nextVersion,
              targetSourceConfigurationId: targetId,
              rollbackLedgerId: rbLedger.id,
              txid: rbLedger.txid,
            },
          },
          tx,
        );

        return {
          cloneId,
          predecessorId,
          targetId,
          rbLedger,
        };
      });

      this.cacheService.invalidateCountry(country.id);

      const cloneDetail = await this.getConfigurationDetail(
        txResult.cloneId,
        now,
      );

      return {
        cloneConfiguration: cloneDetail,
        rolledBackConfigurationId: txResult.predecessorId,
        targetSourceConfigurationId: txResult.targetId,
        rollbackLedger: txResult.rbLedger,
      };
    } catch (err) {
      throw this.translateDatabaseError(err);
    }
  }

  private async acquireCountryLock(
    executor: Pick<AppDatabase, 'execute'>,
    countryId: string,
  ): Promise<void> {
    await executor.execute(sql`
      SELECT pg_advisory_xact_lock(
        hashtext('homepage_cfg_country'),
        hashtext(${countryId}::text)
      )
    `);
  }

  private async requireCountryForWrite(
    countryId: string,
    executor: Pick<AppDatabase, 'execute'> = this.dbInstance,
  ): Promise<CountryResult> {
    const res = await executor.execute(sql`
      SELECT
        id,
        name,
        iso_code,
        url_prefix,
        default_language_code,
        currency_code,
        status
      FROM "platform"."countries"
      WHERE id = ${countryId}::uuid
      LIMIT 1
    `);
    const row = res.rows[0] as Record<string, any> | undefined;
    if (!row) {
      throw new HomepageError(
        'The specified country was not found.',
        404,
        'COUNTRY_NOT_FOUND',
      );
    }
    if (row.status !== 'ACTIVE') {
      throw new HomepageError(
        'The specified country is inactive.',
        422,
        'COUNTRY_INACTIVE',
      );
    }
    return {
      id: String(row.id),
      name: String(row.name),
      isoCode: String(row.iso_code),
      urlPrefix: String(row.url_prefix),
      defaultLanguageCode: String(row.default_language_code),
      currencyCode: String(row.currency_code),
      status: String(row.status),
    };
  }

  private async validateAndInsertSlotItems(
    executor: Pick<AppDatabase, 'execute'>,
    params: {
      configurationId: string;
      slotId: string;
      slotKey: HomepageSlotKey;
      entityType: HomepageEntityType;
      countryId: string;
      maxItems: number;
      items: DraftPinnedItemInput[];
      requireLiveEligibility: boolean;
    },
    actorUserId: string,
    evalTime: Date,
  ): Promise<void> {
    const {
      configurationId,
      slotId,
      slotKey,
      entityType,
      countryId,
      maxItems,
      items,
      requireLiveEligibility,
    } = params;

    if (items.length > maxItems) {
      throw new HomepageError(
        `Slot '${slotKey}' allows at most ${maxItems} pinned items (received ${items.length}).`,
        422,
        'PINNED_ITEMS_EXCEED_MAX_ITEMS',
      );
    }

    const sorted = [...items].sort((a, b) => a.position - b.position);
    const seenEntities = new Set<string>();

    for (let idx = 0; idx < sorted.length; idx++) {
      const item = sorted[idx];
      const expectedPos = idx + 1;
      if (!Number.isInteger(item.position) || item.position !== expectedPos) {
        throw new HomepageError(
          `Pinned item positions in slot '${slotKey}' must be contiguous 1..${sorted.length}.`,
          422,
          'NON_CONTIGUOUS_PIN_POSITIONS',
        );
      }

      const normEntityId = item.entityId.toLowerCase();
      if (seenEntities.has(normEntityId)) {
        throw new HomepageError(
          `Duplicate pinned entity '${item.entityId}' in slot '${slotKey}'.`,
          422,
          'DUPLICATE_PINNED_ENTITY',
        );
      }
      seenEntities.add(normEntityId);

      const startsAt = parseOptionalFiniteTimestamp(
        item.startsAt,
        `${slotKey}.items[${idx}].startsAt`,
      );
      const endsAt = parseOptionalFiniteTimestamp(
        item.endsAt,
        `${slotKey}.items[${idx}].endsAt`,
      );

      if (
        startsAt !== null &&
        endsAt !== null &&
        endsAt.getTime() <= startsAt.getTime()
      ) {
        throw new HomepageError(
          `Pinned item endsAt must be strictly greater than startsAt in slot '${slotKey}'.`,
          422,
          'INVALID_PIN_WINDOW',
        );
      }

      if (
        requireLiveEligibility &&
        endsAt !== null &&
        endsAt.getTime() <= evalTime.getTime()
      ) {
        throw new HomepageError(
          `Pinned item endsAt in slot '${slotKey}' has already expired.`,
          422,
          'INELIGIBLE_PINNED_ENTITY',
          {
            slotKey,
            position: item.position,
            entityId: item.entityId,
            reason: 'PIN_WINDOW_EXPIRED',
          },
        );
      }

      if (item.pinNote !== undefined && item.pinNote !== null && item.pinNote.length > 500) {
        throw new HomepageError(
          `pinNote in slot '${slotKey}' cannot exceed 500 characters.`,
          400,
          'VALIDATION_ERROR',
        );
      }

      if (requireLiveEligibility) {
        const diagRes = await executor.execute(sql`
          SELECT "content"."fn_evaluate_homepage_entity_eligibility"(
            ${countryId}::uuid,
            ${entityType}::"content"."homepage_entity_type",
            ${item.entityId}::uuid,
            ${evalTime.toISOString()}::timestamptz
          ) AS diag
        `);
        const diag = String(
          diagRes.rows[0]?.diag ?? 'ENTITY_NOT_FOUND',
        ) as HomepageEligibilityDiagnostic;

        if (diag !== 'ELIGIBLE') {
          throw new HomepageError(
            `Pinned entity '${item.entityId}' in slot '${slotKey}' is ineligible (${diag}).`,
            422,
            'INELIGIBLE_PINNED_ENTITY',
            {
              slotKey,
              position: item.position,
              entityType,
              entityId: item.entityId,
              reason: diag,
            },
          );
        }
      }

      const resourceId = entityType === 'RESOURCE' ? item.entityId : null;
      const updateId = entityType === 'UPDATE' ? item.entityId : null;
      const calendarEventId =
        entityType === 'CALENDAR_EVENT' ? item.entityId : null;
      const subjectId = entityType === 'SUBJECT' ? item.entityId : null;
      const evalIso = evalTime.toISOString();

      await executor.execute(sql`
        INSERT INTO "content"."homepage_configuration_items" (
          id,
          slot_id,
          configuration_id,
          country_id,
          entity_type,
          position,
          resource_id,
          update_id,
          calendar_event_id,
          subject_id,
          starts_at,
          ends_at,
          pin_note,
          created_by,
          created_at,
          updated_at
        ) VALUES (
          ${crypto.randomUUID()}::uuid,
          ${slotId}::uuid,
          ${configurationId}::uuid,
          ${countryId}::uuid,
          ${entityType}::"content"."homepage_entity_type",
          ${item.position},
          ${resourceId}::uuid,
          ${updateId}::uuid,
          ${calendarEventId}::uuid,
          ${subjectId}::uuid,
          ${startsAt ? startsAt.toISOString() : null}::timestamptz,
          ${endsAt ? endsAt.toISOString() : null}::timestamptz,
          ${item.pinNote ?? null},
          ${actorUserId}::uuid,
          ${evalIso}::timestamptz,
          ${evalIso}::timestamptz
        )
      `);
    }
  }

  private async assertConfigurationReadyForActivation(
    executor: Pick<AppDatabase, 'execute'>,
    configurationId: string,
    countryId: string,
    evalTime: Date,
    pinExpiryFloor: Date,
    errorCode: string = 'INELIGIBLE_PINNED_ENTITY',
  ): Promise<void> {
    const slotsRes = await executor.execute(sql`
      SELECT id, slot_key, mode, max_items
      FROM "content"."homepage_configuration_slots"
      WHERE configuration_id = ${configurationId}::uuid
      ORDER BY slot_order ASC
    `);

    if (slotsRes.rows.length !== 6) {
      throw new HomepageError(
        `Homepage configuration must contain all 6 canonical slots (found ${slotsRes.rows.length}).`,
        422,
        'INCOMPLETE_HOMEPAGE_SLOTS',
      );
    }

    for (const rawSlot of slotsRes.rows) {
      const s = rawSlot as Record<string, any>;
      if (s.mode === 'MANUAL_OVERRIDE') {
        const cntRes = await executor.execute(sql`
          SELECT COUNT(*)::int AS cnt
          FROM "content"."homepage_configuration_items"
          WHERE slot_id = ${String(s.id)}::uuid
        `);
        if (Number(cntRes.rows[0]?.cnt ?? 0) < 1) {
          throw new HomepageError(
            `MANUAL_OVERRIDE slot '${s.slot_key}' must have at least 1 pinned item.`,
            422,
            errorCode === 'INELIGIBLE_ROLLBACK_TARGET'
              ? 'INELIGIBLE_ROLLBACK_TARGET'
              : 'EMPTY_MANUAL_OVERRIDE_SLOT',
          );
        }
      }
    }

    const evalIso = evalTime.toISOString();
    const floorIso = pinExpiryFloor.toISOString();

    const badItemsRes = await executor.execute(sql`
      SELECT
        s.slot_key,
        i.position,
        i.entity_type,
        COALESCE(i.resource_id, i.update_id, i.calendar_event_id, i.subject_id) AS entity_id,
        i.ends_at,
        "content"."fn_evaluate_homepage_entity_eligibility"(
          ${countryId}::uuid,
          i.entity_type,
          COALESCE(i.resource_id, i.update_id, i.calendar_event_id, i.subject_id),
          ${evalIso}::timestamptz
        ) AS diag
      FROM "content"."homepage_configuration_items" i
      JOIN "content"."homepage_configuration_slots" s ON s.id = i.slot_id
      WHERE i.configuration_id = ${configurationId}::uuid
        AND (
          "content"."fn_is_homepage_entity_eligible"(
            ${countryId}::uuid,
            i.entity_type,
            COALESCE(i.resource_id, i.update_id, i.calendar_event_id, i.subject_id),
            ${evalIso}::timestamptz
          ) IS NOT TRUE
          OR (i.ends_at IS NOT NULL AND (i.ends_at > ${floorIso}::timestamptz) IS NOT TRUE)
        )
      ORDER BY s.slot_order ASC, i.position ASC
    `);

    if (badItemsRes.rows.length > 0) {
      const details = badItemsRes.rows.map((r) => {
        const row = r as Record<string, any>;
        const diag = String(row.diag);
        return {
          slotKey: String(row.slot_key),
          position: Number(row.position),
          entityType: String(row.entity_type),
          entityId: String(row.entity_id),
          reason: diag !== 'ELIGIBLE' ? diag : 'PIN_WINDOW_EXPIRED',
        };
      });

      throw new HomepageError(
        `Configuration contains ${details.length} ineligible or expired pinned item(s).`,
        422,
        errorCode,
        { ineligibleItems: details },
      );
    }
  }

  private async loadConfigurationPreviewSlots(
    configurationId: string,
  ): Promise<PreviewSlotInput[]> {
    const slotsRes = await this.dbInstance.execute(sql`
      SELECT id, slot_key, mode, section_title, section_subtitle, max_items
      FROM "content"."homepage_configuration_slots"
      WHERE configuration_id = ${configurationId}::uuid
      ORDER BY slot_order ASC
    `);
    const itemsRes = await this.dbInstance.execute(sql`
      SELECT
        slot_id,
        entity_type,
        position,
        resource_id,
        update_id,
        calendar_event_id,
        subject_id,
        starts_at,
        ends_at,
        pin_note
      FROM "content"."homepage_configuration_items"
      WHERE configuration_id = ${configurationId}::uuid
      ORDER BY slot_id, position ASC
    `);

    const itemsBySlotId = new Map<
      string,
      NonNullable<PreviewSlotInput['items']>
    >();
    for (const rawItem of itemsRes.rows) {
      const i = rawItem as Record<string, any>;
      const entityId = extractPinnedItemEntityId({
        entityType: i.entity_type as HomepageEntityType,
        resourceId: i.resource_id,
        updateId: i.update_id,
        calendarEventId: i.calendar_event_id,
        subjectId: i.subject_id,
      });
      if (!entityId) continue;

      const list = itemsBySlotId.get(String(i.slot_id)) ?? [];
      list.push({
        position: Number(i.position),
        entityId,
        startsAt: i.starts_at ? new Date(i.starts_at) : null,
        endsAt: i.ends_at ? new Date(i.ends_at) : null,
        pinNote: i.pin_note !== null ? String(i.pin_note) : null,
      });
      itemsBySlotId.set(String(i.slot_id), list);
    }

    return slotsRes.rows.map((rawSlot) => {
      const s = rawSlot as Record<string, any>;
      return {
        slotKey: s.slot_key as HomepageSlotKey,
        mode: s.mode as HomepageSlotMode,
        sectionTitle: String(s.section_title),
        sectionSubtitle:
          s.section_subtitle !== null ? String(s.section_subtitle) : null,
        maxItems: Number(s.max_items),
        items: itemsBySlotId.get(String(s.id)) ?? [],
      };
    });
  }

  private mergePreviewSlotOverrides(
    baseSlots: PreviewSlotInput[],
    overrides?: PreviewSlotInput[],
  ): PreviewSlotInput[] {
    if (!overrides || overrides.length === 0) {
      return baseSlots;
    }
    const baseByKey = new Map<HomepageSlotKey, PreviewSlotInput>();
    for (const b of baseSlots) {
      baseByKey.set(b.slotKey, b);
    }
    for (const ov of overrides) {
      const spec = CANONICAL_SLOT_BY_KEY[ov.slotKey];
      const existing = baseByKey.get(ov.slotKey);
      baseByKey.set(ov.slotKey, {
        slotKey: ov.slotKey,
        mode: ov.mode ?? existing?.mode ?? 'AUTOMATED',
        sectionTitle:
          ov.sectionTitle ?? existing?.sectionTitle ?? spec.defaultTitle,
        sectionSubtitle:
          ov.sectionSubtitle !== undefined
            ? ov.sectionSubtitle
            : existing?.sectionSubtitle ?? spec.defaultSubtitle,
        maxItems: ov.maxItems ?? existing?.maxItems ?? spec.defaultMaxItems,
        items: ov.items !== undefined ? ov.items : existing?.items ?? [],
      });
    }
    return CANONICAL_HOMEPAGE_SLOTS.map(
      (spec) =>
        baseByKey.get(spec.slotKey) ?? {
          slotKey: spec.slotKey,
          mode: 'AUTOMATED',
          sectionTitle: spec.defaultTitle,
          sectionSubtitle: spec.defaultSubtitle,
          maxItems: spec.defaultMaxItems,
          items: [],
        },
    );
  }

  private translateDatabaseError(err: unknown): HomepageError {
    if (err instanceof HomepageError) {
      return err;
    }

    const pg = extractPgErrorInfo(err);
    if (pg.code === '23P01') {
      return new HomepageError(
        'The requested schedule window overlaps an existing scheduled homepage configuration for this country.',
        409,
        'SCHEDULE_WINDOW_OVERLAP',
      );
    }

    if (pg.code === '23505') {
      if (pg.constraint === 'uq_homepage_cfg_one_active_draft_per_country') {
        return new HomepageError(
          'An active draft homepage configuration already exists for this country.',
          409,
          'ACTIVE_DRAFT_ALREADY_EXISTS',
        );
      }
      if (pg.constraint === 'uq_homepage_cfg_one_published_per_country') {
        return new HomepageError(
          'A published homepage configuration already exists for this country.',
          409,
          'PUBLISHED_CONFIGURATION_CONFLICT',
        );
      }
      return new HomepageError(
        'Duplicate homepage configuration or slot constraint conflict.',
        409,
        'HOMEPAGE_UNIQUE_CONFLICT',
      );
    }

    if (pg.code === '23503') {
      return new HomepageError(
        'Referenced homepage entity or country does not exist.',
        422,
        'REFERENCED_ENTITY_NOT_FOUND',
      );
    }

    if (pg.code === '23514') {
      return new HomepageError(
        'Homepage configuration invariant or item eligibility check failed.',
        422,
        'HOMEPAGE_INVARIANT_VIOLATION',
      );
    }

    return new HomepageDatabaseUnavailableError();
  }
}

export const defaultHomepageAdminService = new DefaultHomepageAdminService();
