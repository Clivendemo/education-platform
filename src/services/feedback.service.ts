import crypto from 'node:crypto';
import { sql, eq, and, ne, desc, count } from 'drizzle-orm';
import { db as defaultDb, type AppDatabase } from '../db/index.js';
import {
  resourceFeedback,
  resourceFeedbackEvents,
  resources,
  resourceVersions,
  users,
  type ResourceFeedback,
  type ResourceFeedbackEvent,
  type FeedbackType,
  type FeedbackStatus,
} from '../db/schemas.js';

// Cookie & Storage constants
export const FEEDBACK_SESSION_COOKIE_NAME = 'rf_sid';
export const FEEDBACK_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days
export const FEEDBACK_COOLDOWN_WINDOW_SECONDS = 3600; // 1 hour duplicate cooldown

/**
 * Hash raw anonymous cookie token into SHA-256 hex string for persistent storage.
 */
export function hashFeedbackSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

// Custom Domain Error Classes
export class FeedbackError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400,
    public code: string = 'FEEDBACK_ERROR',
  ) {
    super(message);
    this.name = 'FeedbackError';
  }
}

export class ResourceNotFoundError extends FeedbackError {
  constructor(resourceId: string) {
    super(`Resource with id '${resourceId}' was not found.`, 404, 'RESOURCE_NOT_FOUND');
    this.name = 'ResourceNotFoundError';
  }
}

export class ResourceVersionNotFoundError extends FeedbackError {
  constructor(versionId: string) {
    super(`Resource version with id '${versionId}' was not found.`, 404, 'RESOURCE_VERSION_NOT_FOUND');
    this.name = 'ResourceVersionNotFoundError';
  }
}

export class DuplicateFeedbackCooldownError extends FeedbackError {
  constructor() {
    super(
      'A feedback submission for this version and type was already received recently. Please try again later.',
      429,
      'DUPLICATE_FEEDBACK_COOLDOWN',
    );
    this.name = 'DuplicateFeedbackCooldownError';
  }
}

export class FeedbackNotFoundError extends FeedbackError {
  constructor(id: string) {
    super(`Resource feedback entry '${id}' was not found.`, 404, 'FEEDBACK_NOT_FOUND');
    this.name = 'FeedbackNotFoundError';
  }
}

export class InvalidFeedbackTransitionError extends FeedbackError {
  constructor(fromStatus: string, toStatus: string) {
    super(
      `Cannot transition feedback from '${fromStatus}' to '${toStatus}'.`,
      400,
      'INVALID_FEEDBACK_TRANSITION',
    );
    this.name = 'InvalidFeedbackTransitionError';
  }
}

// Valid state machine transitions
const ALLOWED_TRANSITIONS: Record<FeedbackStatus, FeedbackStatus[]> = {
  PENDING: ['UNDER_REVIEW', 'ACCEPTED', 'REJECTED'],
  UNDER_REVIEW: ['ACCEPTED', 'REJECTED'],
  ACCEPTED: ['REOPENED'],
  REJECTED: ['REOPENED'],
  REOPENED: ['UNDER_REVIEW', 'ACCEPTED', 'REJECTED'],
};

export interface SubmitFeedbackInput {
  resourceId: string;
  resourceVersionId: string;
  feedbackType: FeedbackType;
  details?: string | null;
  userId?: string | null;
  sessionId?: string | null; // Pre-hashed SHA-256 session token
}

export interface ListFeedbackQuery {
  status?: FeedbackStatus;
  resourceId?: string;
  resourceVersionId?: string;
  feedbackType?: FeedbackType;
  page?: number;
  limit?: number;
}

export interface TriageFeedbackInput {
  feedbackId: string;
  toStatus: FeedbackStatus;
  actorUserId: string;
  internalNote?: string | null;
}

export interface PublicFeedbackSummary {
  resourceId: string;
  totalFeedback: number;
  helpfulCount: number;
}

export class FeedbackService {
  constructor(private db: AppDatabase = defaultDb) {}

  /**
   * Submit feedback for a published resource version.
   * Atomically enforces:
   * 1. Published resource and version parentage check.
   * 2. Exactly one identity constraint (user_id OR session_id).
   * 3. 1-hour duplicate cooldown via transaction advisory locking.
   */
  async submitFeedback(input: SubmitFeedbackInput): Promise<{
    id: string;
    resourceId: string;
    resourceVersionId: string;
    feedbackType: FeedbackType;
    status: FeedbackStatus;
    createdAt: Date;
  }> {
    const { resourceId, resourceVersionId, feedbackType, details, userId, sessionId } = input;

    // Validate identity: exactly one identity required
    if ((userId && sessionId) || (!userId && !sessionId)) {
      throw new FeedbackError(
        'Feedback submission must provide exactly one identity (either userId or sessionId).',
        400,
        'INVALID_IDENTITY',
      );
    }

    return await this.db.transaction(async (tx) => {
      // 1. Verify resource exists and is PUBLISHED (404 if not found or draft)
      const [res] = await tx
        .select({ id: resources.id, status: resources.status })
        .from(resources)
        .where(eq(resources.id, resourceId))
        .limit(1);

      if (!res || res.status !== 'PUBLISHED') {
        throw new ResourceNotFoundError(resourceId);
      }

      // 2. Verify version exists, belongs to resource, and is PUBLISHED
      const [ver] = await tx
        .select({
          id: resourceVersions.id,
          resourceId: resourceVersions.resourceId,
          status: resourceVersions.status,
        })
        .from(resourceVersions)
        .where(
          and(
            eq(resourceVersions.id, resourceVersionId),
            eq(resourceVersions.resourceId, resourceId),
          ),
        )
        .limit(1);

      if (!ver || ver.status !== 'PUBLISHED') {
        throw new ResourceVersionNotFoundError(resourceVersionId);
      }

      // 3. Acquire transaction-scoped advisory lock for concurrency protection
      const identityKey = userId ?? sessionId!;
      const lockKey = `feedback_lock_${identityKey}_${resourceVersionId}_${feedbackType}`;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);

      // 4. Duplicate cooldown check: within 1 hour for same identity + version + feedbackType
      const oneHourAgo = new Date(Date.now() - FEEDBACK_COOLDOWN_WINDOW_SECONDS * 1000);

      const identityCondition = userId
        ? eq(resourceFeedback.userId, userId)
        : eq(resourceFeedback.sessionId, sessionId!);

      const [recentExisting] = await tx
        .select({ id: resourceFeedback.id })
        .from(resourceFeedback)
        .where(
          and(
            identityCondition,
            eq(resourceFeedback.resourceVersionId, resourceVersionId),
            eq(resourceFeedback.feedbackType, feedbackType),
            sql`${resourceFeedback.createdAt} >= ${oneHourAgo}`,
          ),
        )
        .limit(1);

      if (recentExisting) {
        throw new DuplicateFeedbackCooldownError();
      }

      // 5. Insert feedback record with status PENDING
      const [inserted] = await tx
        .insert(resourceFeedback)
        .values({
          resourceId,
          resourceVersionId,
          userId: userId ?? null,
          sessionId: sessionId ?? null,
          feedbackType,
          details: details?.trim() || null,
          status: 'PENDING',
        })
        .returning({
          id: resourceFeedback.id,
          resourceId: resourceFeedback.resourceId,
          resourceVersionId: resourceFeedback.resourceVersionId,
          feedbackType: resourceFeedback.feedbackType,
          status: resourceFeedback.status,
          createdAt: resourceFeedback.createdAt,
        });

      return {
        id: inserted.id,
        resourceId: inserted.resourceId,
        resourceVersionId: inserted.resourceVersionId,
        feedbackType: inserted.feedbackType as FeedbackType,
        status: inserted.status as FeedbackStatus,
        createdAt: inserted.createdAt,
      };
    });
  }

  /**
   * Public feedback aggregate summary for a resource.
   * Returns ONLY totalFeedback and helpfulCount.
   * Defensively never exposes raw feedback rows, triage status, notes, or category breakdowns.
   */
  async getPublicSummary(resourceId: string): Promise<PublicFeedbackSummary> {
    // Verify resource is PUBLISHED
    const [res] = await this.db
      .select({ id: resources.id, status: resources.status })
      .from(resources)
      .where(eq(resources.id, resourceId))
      .limit(1);

    if (!res || res.status !== 'PUBLISHED') {
      throw new ResourceNotFoundError(resourceId);
    }

    const [totalRow] = await this.db
      .select({ count: count() })
      .from(resourceFeedback)
      .where(
        and(
          eq(resourceFeedback.resourceId, resourceId),
          ne(resourceFeedback.status, 'REJECTED'),
        ),
      );

    const [helpfulRow] = await this.db
      .select({ count: count() })
      .from(resourceFeedback)
      .where(
        and(
          eq(resourceFeedback.resourceId, resourceId),
          eq(resourceFeedback.feedbackType, 'HELPFUL'),
          ne(resourceFeedback.status, 'REJECTED'),
        ),
      );

    return {
      resourceId,
      totalFeedback: Number(totalRow?.count ?? 0),
      helpfulCount: Number(helpfulRow?.count ?? 0),
    };
  }

  /**
   * Staff Queue: List feedback items with filtering and pagination.
   */
  async listFeedbackQueue(query: ListFeedbackQuery): Promise<{
    items: ResourceFeedback[];
    pagination: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  }> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const offset = (page - 1) * limit;

    const conditions = [];

    if (query.status) {
      conditions.push(eq(resourceFeedback.status, query.status));
    }
    if (query.resourceId) {
      conditions.push(eq(resourceFeedback.resourceId, query.resourceId));
    }
    if (query.resourceVersionId) {
      conditions.push(eq(resourceFeedback.resourceVersionId, query.resourceVersionId));
    }
    if (query.feedbackType) {
      conditions.push(eq(resourceFeedback.feedbackType, query.feedbackType));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [countRow] = await this.db
      .select({ count: count() })
      .from(resourceFeedback)
      .where(whereClause);

    const total = Number(countRow?.count ?? 0);

    const items = await this.db
      .select()
      .from(resourceFeedback)
      .where(whereClause)
      .orderBy(desc(resourceFeedback.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      items,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Staff Detail: Get feedback item with complete audit event history.
   */
  async getFeedbackById(id: string): Promise<{
    feedback: ResourceFeedback;
    events: (ResourceFeedbackEvent & { actorName?: string | null })[];
  }> {
    const [item] = await this.db
      .select()
      .from(resourceFeedback)
      .where(eq(resourceFeedback.id, id))
      .limit(1);

    if (!item) {
      throw new FeedbackNotFoundError(id);
    }

    const eventRows = await this.db
      .select({
        event: resourceFeedbackEvents,
        actor: {
          id: users.id,
          displayName: users.displayName,
          email: users.email,
        },
      })
      .from(resourceFeedbackEvents)
      .leftJoin(users, eq(resourceFeedbackEvents.actorUserId, users.id))
      .where(eq(resourceFeedbackEvents.feedbackId, id))
      .orderBy(resourceFeedbackEvents.createdAt);

    const events = eventRows.map((r) => ({
      ...r.event,
      actorName: r.actor?.displayName ?? r.actor?.email ?? null,
    }));

    return {
      feedback: item,
      events,
    };
  }

  /**
   * Staff Triage: Transition feedback status with mandatory audit ledger record.
   */
  async triageFeedback(input: TriageFeedbackInput): Promise<{
    feedback: ResourceFeedback;
    event: ResourceFeedbackEvent;
  }> {
    const { feedbackId, toStatus, actorUserId, internalNote } = input;

    return await this.db.transaction(async (tx) => {
      // 1. Fetch current feedback record
      const [current] = await tx
        .select()
        .from(resourceFeedback)
        .where(eq(resourceFeedback.id, feedbackId))
        .limit(1);

      if (!current) {
        throw new FeedbackNotFoundError(feedbackId);
      }

      const fromStatus = current.status as FeedbackStatus;

      // 2. Validate state machine transition
      const allowed = ALLOWED_TRANSITIONS[fromStatus] ?? [];
      if (!allowed.includes(toStatus)) {
        throw new InvalidFeedbackTransitionError(fromStatus, toStatus);
      }

      const now = new Date();

      // 3. Update feedback record
      const [updatedFeedback] = await tx
        .update(resourceFeedback)
        .set({
          status: toStatus,
          reviewedBy: actorUserId,
          reviewedAt: now,
          updatedAt: now,
        })
        .where(eq(resourceFeedback.id, feedbackId))
        .returning();

      // 4. Record transition in append-only audit ledger
      const [event] = await tx
        .insert(resourceFeedbackEvents)
        .values({
          feedbackId,
          fromStatus,
          toStatus,
          actorUserId,
          internalNote: internalNote?.trim() || null,
          createdAt: now,
        })
        .returning();

      return {
        feedback: updatedFeedback,
        event,
      };
    });
  }
}

export const defaultFeedbackService = new FeedbackService();
