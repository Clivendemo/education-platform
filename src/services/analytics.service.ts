import { eq, and, sql, gte, lt } from 'drizzle-orm';
import { z } from 'zod';
import { db as defaultDb, type AppDatabase } from '../db/index.js';
import {
  analyticsEventTypes,
  analyticsEvents,
} from '../db/schemas.js';
import {
  type GeographyService,
  defaultGeographyService,
} from './geography.service.js';

export class AnalyticsError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'ANALYTICS_ERROR',
    public readonly statusCode: number = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AnalyticsError';
  }
}

/**
 * Safe integer and PostgreSQL decimal/bigint count formatter.
 * Compares against Number.MAX_SAFE_INTEGER using BigInt before conversion.
 */
export function formatSafeCount(rawVal: string | number | bigint | null | undefined): number | string {
  if (rawVal === null || rawVal === undefined) return 0;
  if (typeof rawVal === 'number') {
    if (!Number.isSafeInteger(rawVal)) {
      throw new AnalyticsError(
        'Cannot format unsafe JavaScript number; counts must be provided as string or bigint to prevent precision loss',
        'NUMERIC_PRECISION_ERROR',
        500,
      );
    }
    return rawVal;
  }
  if (typeof rawVal === 'bigint') {
    return rawVal <= BigInt(Number.MAX_SAFE_INTEGER) && rawVal >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(rawVal)
      : rawVal.toString();
  }
  const str = String(rawVal).trim();
  if (!str) return 0;
  // If PostgreSQL returned a decimal string (e.g. from SUM or numeric "123.00"), truncate fractional part
  const integerPart = str.split('.')[0] || '0';
  try {
    const num = BigInt(integerPart);
    if (num <= BigInt(Number.MAX_SAFE_INTEGER) && num >= BigInt(Number.MIN_SAFE_INTEGER)) {
      return Number(num);
    }
    return num.toString();
  } catch {
    const parsed = Number(str);
    return Number.isSafeInteger(parsed) ? parsed : str;
  }
}

/**
 * 1. Strict Per-Event Allowlist Schemas (.strict() forbids unknown properties)
 */
export const SearchContextSchema = z
  .object({
    search_query_hash: z
      .string()
      .regex(/^[a-f0-9]{64}$/, 'search_query_hash must be a 64-character hex SHA-256'),
    results_count: z.number().int().min(0).max(1_000_000),
    filters_applied: z.array(z.string().max(32)).max(10).default([]),
    zero_results: z.boolean(),
  })
  .strict();

export const ViewContextSchema = z
  .object({
    entity_type: z.enum(['resource', 'publication', 'collection', 'curriculum']),
    entity_id: z.string().uuid(),
    path: z.string().max(2048),
    referrer_type: z
      .enum(['search', 'catalogue', 'direct', 'external', 'recommendation'])
      .optional(),
  })
  .strict();

export const DownloadContextSchema = z
  .object({
    resource_id: z.string().uuid(),
    file_id: z.string().uuid().optional(),
    file_format: z.string().max(16).optional(),
    file_size_bytes: z.number().int().min(0).max(10_000_000_000).optional(),
  })
  .strict();

export const FeedbackContextSchema = z
  .object({
    resource_id: z.string().uuid(),
    feedback_type: z.enum(['RATING', 'REPORT', 'SUGGESTION']),
    score: z.number().int().min(1).max(5).optional(),
  })
  .strict();

export const ShareSaveContextSchema = z
  .object({
    entity_type: z.enum(['resource', 'publication']),
    entity_id: z.string().uuid(),
    platform: z.string().max(32).optional(),
  })
  .strict();

export const CalendarContextSchema = z
  .object({
    calendar_type: z.string().max(32).optional(),
    action: z.string().max(32),
  })
  .strict();

export const EVENT_CONTEXT_SCHEMAS: Record<string, z.ZodType<any>> = {
  search: SearchContextSchema,
  view: ViewContextSchema,
  preview: ViewContextSchema,
  download: DownloadContextSchema,
  feedback: FeedbackContextSchema,
  share: ShareSaveContextSchema,
  save: ShareSaveContextSchema,
  calendar_interaction: CalendarContextSchema,
};

/**
 * 2. Deterministic URL / Path Normalization
 */
export function normalizeAndValidatePath(rawPath: string): string {
  if (typeof rawPath !== 'string') {
    throw new AnalyticsError('Path must be a string', 'VALIDATION_ERROR', 400);
  }

  // 1. Length constraint
  if (rawPath.length === 0 || rawPath.length > 2048) {
    throw new AnalyticsError('Path length must be between 1 and 2048 characters', 'VALIDATION_ERROR', 400);
  }

  // 2. Reject ASCII control characters (0x00 - 0x1F, 0x7F)
  for (let i = 0; i < rawPath.length; i++) {
    const code = rawPath.charCodeAt(i);
    if ((code >= 0 && code <= 31) || code === 127) {
      throw new AnalyticsError('Path contains invalid control characters', 'VALIDATION_ERROR', 400);
    }
  }

  // 3. Origin parsing: extract pathname if absolute URL, strip query & hash if relative
  let pathname = rawPath;
  if (/^https?:\/\//i.test(rawPath)) {
    try {
      const parsed = new URL(rawPath);
      pathname = parsed.pathname;
    } catch {
      throw new AnalyticsError('Invalid absolute URL format', 'VALIDATION_ERROR', 400);
    }
  } else {
    // Strip query string and fragment
    const queryIdx = pathname.indexOf('?');
    if (queryIdx !== -1) {
      pathname = pathname.substring(0, queryIdx);
    }
    const hashIdx = pathname.indexOf('#');
    if (hashIdx !== -1) {
      pathname = pathname.substring(0, hashIdx);
    }
  }

  // 4. Decode URI components
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new AnalyticsError('Malformed URL path encoding', 'VALIDATION_ERROR', 400);
  }

  // 5. Convert backslashes to forward slashes
  decoded = decoded.replace(/\\/g, '/');

  // 6. Traversal check on decoded representation (detects encoded traversal e.g. %2e%2e%2f)
  if (
    decoded.includes('\0') ||
    decoded.includes('/../') ||
    decoded.includes('/./') ||
    decoded.startsWith('../') ||
    decoded.endsWith('/..') ||
    decoded === '..'
  ) {
    throw new AnalyticsError('Path traversal attempt detected', 'VALIDATION_ERROR', 400);
  }

  // 7. Collapse consecutive slashes and ensure leading slash
  let normalized = decoded.replace(/\/+/g, '/');
  if (!normalized.startsWith('/')) {
    normalized = '/' + normalized;
  }

  // 8. Strip trailing slash unless root '/'
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

/**
 * 3. In-Memory Bounded LRU Rate Limiter
 * Per-replica limiter: 120 req/min per key.
 * In a cluster of N replicas, cluster aggregate capacity is N * 120 req/min.
 */
interface RateLimitBucket {
  count: number;
  resetAt: number;
  lastAccess: number;
}

export class BoundedRateLimiter {
  private readonly store = new Map<string, RateLimitBucket>();
  private readonly maxKeys = 10_000;
  private readonly windowMs = 60_000;
  private readonly limit = 120;
  private cleanupTimer?: NodeJS.Timeout;

  constructor() {
    this.cleanupTimer = setInterval(() => this.sweepExpired(), 60_000);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  public checkRateLimit(key: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    let bucket = this.store.get(key);

    if (!bucket || now >= bucket.resetAt) {
      // LRU eviction if at capacity
      if (this.store.size >= this.maxKeys) {
        this.evictOne();
      }
      bucket = {
        count: 1,
        resetAt: now + this.windowMs,
        lastAccess: now,
      };
      this.store.set(key, bucket);
      return { allowed: true, remaining: this.limit - 1, resetAt: bucket.resetAt };
    }

    bucket.lastAccess = now;
    if (bucket.count >= this.limit) {
      return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
    }

    bucket.count += 1;
    return { allowed: true, remaining: this.limit - bucket.count, resetAt: bucket.resetAt };
  }

  private evictOne(): void {
    const oldestKey = this.store.keys().next().value;
    if (oldestKey) {
      this.store.delete(oldestKey);
    }
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [key, bucket] of this.store.entries()) {
      if (now >= bucket.resetAt) {
        this.store.delete(key);
      }
    }
  }

  public destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }
}

/**
 * 4. Analytics Service Interfaces
 */
export interface RecordEventInput {
  eventCode: string;
  actorType?: 'AUTHENTICATED' | 'ANONYMOUS' | 'SYSTEM';
  userId?: string | null;
  anonymousSessionHash?: string | null;
  idempotencyKey?: string | null;
  country?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  context?: Record<string, unknown>;
  occurredAt?: Date;
}

export interface OverviewMetricsInput {
  startDate: Date;
  endDate: Date;
  eventCode?: string;
  country?: string;
}

export interface OverviewMetricsResult {
  window: {
    startDate: string;
    endDate: string;
  };
  metrics: {
    actionCount: number | string;
    authenticatedUsers: number | string;
    pureAnonymousSessions: number | string;
    estimatedActorCount: number | string;
    downloadUrlIssuedCount: number | string;
    zeroResultRate: number | null;
  };
}

export interface AnalyticsService {
  recordEvent(input: RecordEventInput): Promise<{ status: 'RECORDED' | 'DEDUPLICATED'; eventId?: string }>;
  captureSafe(input: RecordEventInput): void;
  getOverviewMetrics(input: OverviewMetricsInput): Promise<OverviewMetricsResult>;
  listEventTypes(): Promise<any[]>;
  updateEventTypeStatus(id: string, status: 'ACTIVE' | 'DISABLED' | 'ARCHIVED'): Promise<any>;
  invalidateEventTypeCache(): void;
  checkRateLimit(key: string): { allowed: boolean; remaining: number; resetAt: number };
}

export class DefaultAnalyticsService implements AnalyticsService {
  private readonly rateLimiter = new BoundedRateLimiter();
  private eventTypesCache: Map<string, typeof analyticsEventTypes.$inferSelect> = new Map();
  private cacheExpiresAt = 0;
  private cacheStaleCeiling = 0;
  private readonly cacheTtlMs = 300_000; // 5 minutes bounded-staleness
  private readonly staleCeilingMs = 900_000; // 15 minutes hard ceiling before fail-closed
  private countryCache = new Map<string, { id: string | null; expiresAt: number }>();

  constructor(
    private readonly dbInstance: AppDatabase = defaultDb,
    private readonly geographyService: GeographyService = defaultGeographyService,
  ) {}

  public checkRateLimit(key: string) {
    return this.rateLimiter.checkRateLimit(key);
  }

  public invalidateEventTypeCache(): void {
    this.cacheExpiresAt = 0;
    this.cacheStaleCeiling = 0;
    this.eventTypesCache.clear();
  }

  /**
   * Loads event types with bounded-staleness (5m) and fail-closed after 15m DB outage.
   */
  private async getActiveEventType(eventCode: string): Promise<typeof analyticsEventTypes.$inferSelect> {
    const now = Date.now();
    if (this.eventTypesCache.size > 0 && now < this.cacheExpiresAt) {
      const cached = this.eventTypesCache.get(eventCode);
      if (!cached || cached.status !== 'ACTIVE') {
        throw new AnalyticsError(`Event type '${eventCode}' is disabled or not found`, 'INVALID_EVENT_TYPE', 400);
      }
      return cached;
    }

    try {
      const records = await this.dbInstance
        .select()
        .from(analyticsEventTypes);

      const newMap = new Map<string, typeof analyticsEventTypes.$inferSelect>();
      for (const rec of records) {
        newMap.set(rec.eventCode, rec);
      }
      this.eventTypesCache = newMap;
      this.cacheExpiresAt = now + this.cacheTtlMs;
      this.cacheStaleCeiling = now + this.staleCeilingMs;
    } catch (err) {
      // Fallback: If cache has records and within 15-min stale ceiling, serve stale
      if (this.eventTypesCache.size > 0 && now < this.cacheStaleCeiling) {
        const cached = this.eventTypesCache.get(eventCode);
        if (!cached || cached.status !== 'ACTIVE') {
          throw new AnalyticsError(`Event type '${eventCode}' is disabled or not found`, 'INVALID_EVENT_TYPE', 400);
        }
        return cached;
      }
      // Past 15 minutes without DB or empty cache: fail closed
      throw new AnalyticsError('Analytics event verification unavailable', 'SERVICE_UNAVAILABLE', 503);
    }

    const matched = this.eventTypesCache.get(eventCode);
    if (!matched || matched.status !== 'ACTIVE') {
      throw new AnalyticsError(`Event type '${eventCode}' is disabled or not found`, 'INVALID_EVENT_TYPE', 400);
    }
    return matched;
  }

  /**
   * Resolves country via GeographyService with 1-hour in-memory cache.
   */
  private async resolveCountryId(countryInput?: string | null): Promise<string | null> {
    if (!countryInput) return null;
    const trimmed = countryInput.trim();
    if (!trimmed) return null;

    const now = Date.now();
    const cached = this.countryCache.get(trimmed.toLowerCase());
    if (cached && now < cached.expiresAt) {
      return cached.id;
    }

    try {
      const found = await this.geographyService.getActiveCountryByIdentifier(trimmed);
      const countryId = found ? found.id : null;
      this.countryCache.set(trimmed.toLowerCase(), {
        id: countryId,
        expiresAt: now + 3600_000,
      });
      return countryId;
    } catch {
      return null;
    }
  }

  /**
   * Validates event context against strict allowlist schema.
   */
  private validateContext(eventCode: string, rawContext: Record<string, unknown> = {}): Record<string, unknown> {
    const stringified = JSON.stringify(rawContext);
    if (Buffer.byteLength(stringified, 'utf8') > 4096) {
      throw new AnalyticsError('Event context payload exceeds maximum allowed size (4KB)', 'VALIDATION_ERROR', 400);
    }

    const schema = EVENT_CONTEXT_SCHEMAS[eventCode];
    if (schema) {
      // Normalize path if present in context
      if (typeof rawContext.path === 'string') {
        rawContext.path = normalizeAndValidatePath(rawContext.path);
      }
      const parsed = schema.safeParse(rawContext);
      if (!parsed.success) {
        throw new AnalyticsError(
          parsed.error.errors[0]?.message || 'Invalid context fields for event type',
          'VALIDATION_ERROR',
          400,
          parsed.error.flatten(),
        );
      }
      return parsed.data;
    }

    // If event has no schema defined, reject arbitrary context properties
    if (Object.keys(rawContext).length > 0) {
      throw new AnalyticsError(`Unexpected context properties for event '${eventCode}'`, 'VALIDATION_ERROR', 400);
    }
    return {};
  }

  /**
   * Synchronous event recording for public ingestion endpoint.
   * Awaits DB persistence and returns confirmed eventId or DEDUPLICATED status.
   */
  async recordEvent(input: RecordEventInput): Promise<{ status: 'RECORDED' | 'DEDUPLICATED'; eventId?: string }> {
    const eventType = await this.getActiveEventType(input.eventCode);
    const validatedContext = this.validateContext(input.eventCode, input.context || {});
    const countryId = await this.resolveCountryId(input.country);

    const actorType = input.actorType || (input.userId ? 'AUTHENTICATED' : 'ANONYMOUS');
    if (actorType === 'ANONYMOUS' && !input.anonymousSessionHash) {
      throw new AnalyticsError('Anonymous events require an anonymousSessionHash', 'VALIDATION_ERROR', 400);
    }

    const occurredAt = input.occurredAt || new Date();

    const insertResult = await this.dbInstance
      .insert(analyticsEvents)
      .values({
        eventTypeId: eventType.id,
        actorType,
        userId: input.userId || null,
        anonymousSessionHash: input.anonymousSessionHash || null,
        idempotencyKey: input.idempotencyKey || null,
        countryId,
        entityType: input.entityType || null,
        entityId: input.entityId || null,
        context: validatedContext,
        occurredAt,
      })
      .onConflictDoNothing({ target: analyticsEvents.idempotencyKey })
      .returning({ id: analyticsEvents.id });

    if (insertResult.length === 0) {
      return { status: 'DEDUPLICATED' };
    }

    return { status: 'RECORDED', eventId: insertResult[0].id };
  }

  /**
   * Safe asynchronous background capture.
   * Fire-and-forget: Catches synchronous errors and promise rejections.
   * Best-effort delivery; does not block caller.
   */
  captureSafe(input: RecordEventInput): void {
    Promise.resolve()
      .then(() => this.recordEvent(input))
      .catch((err) => {
        // Log warning without bubbling error to caller
        console.warn('[AnalyticsService:captureSafe] Non-fatal background event recording failed:', err?.message || err);
      });
  }

  /**
   * Administrative aggregate overview metrics over half-open interval [startDate, endDate).
   */
  async getOverviewMetrics(input: OverviewMetricsInput): Promise<OverviewMetricsResult> {
    const { startDate, endDate, eventCode, country } = input;
    if (startDate >= endDate) {
      throw new AnalyticsError('startDate must be strictly before endDate', 'VALIDATION_ERROR', 400);
    }

    const countryId = await this.resolveCountryId(country);

    // 1. Resolve eventTypeId if filtered by code
    let filterEventTypeId: string | null = null;
    if (eventCode) {
      const [typeRow] = await this.dbInstance
        .select({ id: analyticsEventTypes.id })
        .from(analyticsEventTypes)
        .where(eq(analyticsEventTypes.eventCode, eventCode))
        .limit(1);
      if (typeRow) {
        filterEventTypeId = typeRow.id;
      }
    }

    // 2. Action count
    const actionConditions = [
      gte(analyticsEvents.occurredAt, startDate),
      lt(analyticsEvents.occurredAt, endDate),
    ];
    if (filterEventTypeId) {
      actionConditions.push(eq(analyticsEvents.eventTypeId, filterEventTypeId));
    }
    if (countryId) {
      actionConditions.push(eq(analyticsEvents.countryId, countryId));
    }

    const [actionRow] = await this.dbInstance
      .select({ count: sql<string>`count(*)` })
      .from(analyticsEvents)
      .where(and(...actionConditions));

    // 3. Authenticated distinct users
    const authConditions = [
      gte(analyticsEvents.occurredAt, startDate),
      lt(analyticsEvents.occurredAt, endDate),
      sql`${analyticsEvents.userId} IS NOT NULL`,
    ];
    if (countryId) {
      authConditions.push(eq(analyticsEvents.countryId, countryId));
    }

    const [authRow] = await this.dbInstance
      .select({ count: sql<string>`count(distinct ${analyticsEvents.userId})` })
      .from(analyticsEvents)
      .where(and(...authConditions));

    // 4. Pure anonymous sessions (sessions that never converted to authenticated in window)
    const pureAnonQuery = await this.dbInstance.execute(sql`
      SELECT COUNT(DISTINCT e.anonymous_session_hash)::bigint AS count
      FROM "analytics"."analytics_events" e
      WHERE e.occurred_at >= ${startDate} AND e.occurred_at < ${endDate}
        AND e.actor_type = 'ANONYMOUS'
        AND e.anonymous_session_hash IS NOT NULL
        ${countryId ? sql`AND e.country_id = ${countryId}` : sql``}
        AND NOT EXISTS (
          SELECT 1
          FROM "analytics"."analytics_events" sub
          WHERE sub.occurred_at >= ${startDate} AND sub.occurred_at < ${endDate}
            AND sub.user_id IS NOT NULL
            AND sub.anonymous_session_hash = e.anonymous_session_hash
        )
    `);
    const pureAnonCountStr = (pureAnonQuery.rows[0] as any)?.count || '0';

    // 5. Download URL issued count
    const [downloadRow] = await this.dbInstance
      .select({ count: sql<string>`count(*)` })
      .from(analyticsEvents)
      .innerJoin(analyticsEventTypes, eq(analyticsEvents.eventTypeId, analyticsEventTypes.id))
      .where(
        and(
          gte(analyticsEvents.occurredAt, startDate),
          lt(analyticsEvents.occurredAt, endDate),
          eq(analyticsEventTypes.eventCode, 'download'),
          countryId ? eq(analyticsEvents.countryId, countryId) : undefined,
        ),
      );

    // 6. Zero result rate for search events (returns null when no searches occurred)
    const zeroRateQuery = await this.dbInstance.execute(sql`
      SELECT 
        CASE 
          WHEN COUNT(*) = 0 THEN NULL
          ELSE ROUND(
            COUNT(*) FILTER (
              WHERE (e.context->>'zero_results') = 'true'
                 OR (
                   (e.context->>'results_count') ~ '^[0-9]+$' 
                   AND (e.context->>'results_count')::numeric = 0
                 )
            )::numeric / COUNT(*)::numeric, 
            4
          )
        END AS rate
      FROM "analytics"."analytics_events" e
      JOIN "analytics"."analytics_event_types" t ON e.event_type_id = t.id
      WHERE e.occurred_at >= ${startDate} AND e.occurred_at < ${endDate}
        AND t.event_code = 'search'
        ${countryId ? sql`AND e.country_id = ${countryId}` : sql``}
    `);
    const rawZeroRate = (zeroRateQuery.rows[0] as any)?.rate;
    const zeroRate = rawZeroRate !== null && rawZeroRate !== undefined ? parseFloat(rawZeroRate) : null;

    const actionCountVal = formatSafeCount(actionRow?.count || '0');
    const authUsersVal = formatSafeCount(authRow?.count || '0');
    const pureAnonVal = formatSafeCount(pureAnonCountStr);

    // Estimated actor count = authUsers + pureAnon
    const totalActorsBig = BigInt(String(authRow?.count || '0').split('.')[0] || '0') +
      BigInt(String(pureAnonCountStr).split('.')[0] || '0');
    const estimatedActorVal = totalActorsBig <= BigInt(Number.MAX_SAFE_INTEGER) && totalActorsBig >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(totalActorsBig)
      : totalActorsBig.toString();

    return {
      window: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
      metrics: {
        actionCount: actionCountVal,
        authenticatedUsers: authUsersVal,
        pureAnonymousSessions: pureAnonVal,
        estimatedActorCount: estimatedActorVal,
        downloadUrlIssuedCount: formatSafeCount(downloadRow?.count || '0'),
        zeroResultRate: zeroRate,
      },
    };
  }

  async listEventTypes(): Promise<any[]> {
    return this.dbInstance
      .select()
      .from(analyticsEventTypes)
      .orderBy(analyticsEventTypes.eventCode);
  }

  async updateEventTypeStatus(id: string, status: 'ACTIVE' | 'DISABLED' | 'ARCHIVED'): Promise<any> {
    const [updated] = await this.dbInstance
      .update(analyticsEventTypes)
      .set({ status, updatedAt: new Date() })
      .where(eq(analyticsEventTypes.id, id))
      .returning();

    if (!updated) {
      throw new AnalyticsError('Event type not found', 'NOT_FOUND', 404);
    }

    // Invalidate local in-process cache immediately
    this.invalidateEventTypeCache();
    return updated;
  }
}

export const defaultAnalyticsService: AnalyticsService = new DefaultAnalyticsService();
