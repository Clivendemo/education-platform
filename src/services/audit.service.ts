import crypto from 'node:crypto';
import { eq, and, desc, gte, lte, count } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { db } from '../db/index.js';
import * as schemas from '../db/schemas.js';
import { auditLogs, type AuditLog, type NewAuditLog } from '../db/schema/governance.js';
import {
  sanitizeAndBoundAuditState,
  sanitizeAndCompactActorSnapshot,
  sanitizeAndCompactAuditContext,
} from '../utils/log-redactor.js';

export class AuditError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400,
    public code: string = 'AUDIT_ERROR',
  ) {
    super(message);
    this.name = 'AuditError';
  }
}

export interface ActorSnapshot {
  actorId?: string;
  actorType: 'AUTHENTICATED' | 'ANONYMOUS' | 'SYSTEM';
  actorRole?: string;
  emailDomain?: string;
  displayName?: string;
  _truncated?: boolean;
  _originalEstimatedBytes?: number;
}

export interface AuditEventInput {
  eventId?: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  actorType: 'AUTHENTICATED' | 'ANONYMOUS' | 'SYSTEM';
  actorUserId?: string | null;
  actorSnapshot?: ActorSnapshot;
  outcome: 'SUCCESS' | 'DENIED' | 'FAILED';
  requestId?: string | null;
  countryId?: string | null;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  context?: Record<string, unknown>;
  occurredAt?: Date;
}

export interface AuditLogQueryParams {
  page?: number;
  pageSize?: number;
  action?: string;
  entityType?: string;
  entityId?: string;
  actorUserId?: string;
  outcome?: 'SUCCESS' | 'DENIED' | 'FAILED';
  requestId?: string;
  startDate?: string | Date;
  endDate?: string | Date;
}

export interface PaginatedAuditLogs {
  logs: AuditLog[];
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  };
}

export const MAX_AUDIT_CONTEXT_BYTES = 4096;
export const MAX_ACTOR_SNAPSHOT_BYTES = 2048;

/**
 * Recursively masks sensitive keys/values with `[REDACTED]` (preserving false-positive allowlist keys),
 * normalizes Unicode (`toWellFormed` + NUL removal), and deterministically compacts oversized payloads
 * to `<= 3,800` PG JSONB text bytes (`<= 4,096` hard DB CHECK) without throwing `AuditError`.
 */
export function validateAndSanitizeContext(
  context?: Record<string, unknown>,
): Record<string, unknown> {
  return sanitizeAndCompactAuditContext(context);
}

/**
 * Normalizes, scrubs, and deterministically compacts `actorSnapshot` to `<= 1,900` PG JSONB text bytes
 * (`<= 2,048` hard DB CHECK) without throwing `AuditError`.
 */
export function validateAndSanitizeActorSnapshot(snapshot?: ActorSnapshot): ActorSnapshot {
  return sanitizeAndCompactActorSnapshot(snapshot);
}

export interface AuditService {
  logEvent(input: AuditEventInput, tx?: any): Promise<AuditLog>;
  getAuditLogs(params: AuditLogQueryParams): Promise<PaginatedAuditLogs>;
  getAuditLogById(id: string): Promise<AuditLog | null>;
}

export class DefaultAuditService implements AuditService {
  constructor(private readonly dbInstance: NodePgDatabase<typeof schemas> = db) {}

  async logEvent(input: AuditEventInput, tx?: any): Promise<AuditLog> {
    const executor = tx || this.dbInstance;

    const eventId = input.eventId || crypto.randomUUID();
    const sanitizedContext = validateAndSanitizeContext(input.context);
    const sanitizedActor = validateAndSanitizeActorSnapshot(input.actorSnapshot);
    const sanitizedBeforeState = sanitizeAndBoundAuditState(input.beforeState);
    const sanitizedAfterState = sanitizeAndBoundAuditState(input.afterState);

    const rowToInsert: NewAuditLog = {
      eventId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId || null,
      actorType: input.actorType,
      actorUserId: input.actorUserId || null,
      actorSnapshot: sanitizedActor,
      outcome: input.outcome,
      requestId: input.requestId || null,
      countryId: input.countryId || null,
      beforeState: sanitizedBeforeState,
      afterState: sanitizedAfterState,
      context: sanitizedContext,
      occurredAt: input.occurredAt || new Date(),
    };

    const [inserted] = await executor.insert(auditLogs).values(rowToInsert).returning();
    return inserted;
  }

  async getAuditLogs(params: AuditLogQueryParams): Promise<PaginatedAuditLogs> {
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));
    const offset = (page - 1) * pageSize;

    const conditions = [];

    if (params.action) {
      conditions.push(eq(auditLogs.action, params.action));
    }
    if (params.entityType) {
      conditions.push(eq(auditLogs.entityType, params.entityType));
    }
    if (params.entityId) {
      conditions.push(eq(auditLogs.entityId, params.entityId));
    }
    if (params.actorUserId) {
      conditions.push(eq(auditLogs.actorUserId, params.actorUserId));
    }
    if (params.outcome) {
      conditions.push(eq(auditLogs.outcome, params.outcome));
    }
    if (params.requestId) {
      conditions.push(eq(auditLogs.requestId, params.requestId));
    }
    if (params.startDate) {
      const start = new Date(params.startDate);
      if (!isNaN(start.getTime())) {
        conditions.push(gte(auditLogs.occurredAt, start));
      }
    }
    if (params.endDate) {
      const end = new Date(params.endDate);
      if (!isNaN(end.getTime())) {
        conditions.push(lte(auditLogs.occurredAt, end));
      }
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalRow] = await this.dbInstance
      .select({ total: count() })
      .from(auditLogs)
      .where(whereClause);

    const totalCount = Number(totalRow?.total || 0);
    const totalPages = Math.ceil(totalCount / pageSize);

    const logs = await this.dbInstance
      .select()
      .from(auditLogs)
      .where(whereClause)
      .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
      .limit(pageSize)
      .offset(offset);

    return {
      logs,
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages,
      },
    };
  }

  async getAuditLogById(id: string): Promise<AuditLog | null> {
    const [row] = await this.dbInstance
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.id, id))
      .limit(1);

    return row || null;
  }
}

export const defaultAuditService = new DefaultAuditService();
