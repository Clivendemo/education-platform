import crypto from 'node:crypto';
import { eq, and, desc, sql, count } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { db, getDatabasePool } from '../db/index.js';
import * as schemas from '../db/schemas.js';
import {
  retentionPolicies,
  retentionPolicyVersions,
  dataRetentionActions,
  type RetentionPolicy,
  type RetentionPolicyVersion,
  type DataRetentionAction,
} from '../db/schema/governance.js';
import { defaultAuditService, type AuditService } from './audit.service.js';

export class RetentionError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400,
    public code: string = 'RETENTION_ERROR',
  ) {
    super(message);
    this.name = 'RetentionError';
  }
}

export interface TargetRegistryEntry {
  table: string;
  idColumn: string;
  referenceColumn: string;
  timestampColumn: string;
  mutation: 'DELETE';
  isExecutable: boolean;
  requiredIndex: string;
  buildPredicateSql: (cutoffParam: string) => string;
  blockedReason?: string;
}

export const RETENTION_TARGET_REGISTRY: Record<string, TargetRegistryEntry> = {
  USER_SESSIONS: {
    table: 'identity.user_sessions',
    idColumn: 'id',
    referenceColumn: 'expires_at',
    timestampColumn: 'expires_at',
    mutation: 'DELETE',
    isExecutable: true,
    requiredIndex: 'idx_user_sessions_expires_at',
    buildPredicateSql: (param) => `expires_at < ${param} AND expires_at < now()`,
  },
  ANALYTICS_EVENTS: {
    table: 'analytics.analytics_events',
    idColumn: 'id',
    referenceColumn: 'occurred_at',
    timestampColumn: 'occurred_at',
    mutation: 'DELETE',
    isExecutable: true,
    requiredIndex: 'idx_analytics_events_occurred_at',
    buildPredicateSql: (param) => `occurred_at < ${param}`,
  },
  NOTIFICATION_DELIVERIES: {
    table: 'identity.notification_deliveries',
    idColumn: 'id',
    referenceColumn: 'created_at',
    timestampColumn: 'created_at',
    mutation: 'DELETE',
    isExecutable: true,
    requiredIndex: 'idx_notification_deliveries_status_created_at',
    buildPredicateSql: (param) => `status IN ('DELIVERED', 'FAILED') AND created_at < ${param}`,
  },
  FEEDBACK_REPORTS: {
    table: 'content.resource_feedback',
    idColumn: 'id',
    referenceColumn: 'created_at',
    timestampColumn: 'created_at',
    mutation: 'DELETE',
    isExecutable: false,
    requiredIndex: 'idx_resource_feedback_created_at',
    blockedReason: 'chk_feedback_exactly_one_identity constraint prevents anonymization without synthetic sessions',
    buildPredicateSql: () => {
      throw new RetentionError('FEEDBACK_REPORTS execution blocked by governance constraint', 400, 'UNSUPPORTED_TARGET');
    },
  },
  AUDIT_LOGS: {
    table: 'governance.audit_logs',
    idColumn: 'id',
    referenceColumn: 'occurred_at',
    timestampColumn: 'occurred_at',
    mutation: 'DELETE',
    isExecutable: false,
    requiredIndex: 'idx_audit_logs_occurred_action',
    blockedReason: 'ARCHIVE disposition is unsupported; off-cluster cold storage not implemented',
    buildPredicateSql: () => {
      throw new RetentionError('AUDIT_LOGS archiving unsupported in this milestone', 400, 'UNSUPPORTED_TARGET');
    },
  },
};

export interface CreatePolicyInput {
  policyCode: string;
  name: string;
  description?: string;
  dataCategory: string;
  targetIdentifier: string;
  referencePoint: string;
  retentionDurationDays: number;
  disposition: 'DELETE' | 'ANONYMIZE' | 'ARCHIVE';
  legalBasis?: string;
}

export interface UpdatePolicyInput {
  name?: string;
  description?: string;
  retentionDurationDays?: number;
  status?: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'SUPERSEDED';
  changeReason: string;
}

export interface DryRunResult {
  isDryRun: true;
  pointInTimeEstimatedCount: number;
  cutoffTime: string;
  previewBatches: number;
}

export interface ExecutionStartResult {
  executionId: string;
  status: 'RUNNING';
  pollUrl: string;
}

export interface RetentionService {
  createPolicy(input: CreatePolicyInput, userId?: string): Promise<RetentionPolicy>;
  getPolicies(filters?: { status?: string; dataCategory?: string }): Promise<RetentionPolicy[]>;
  getPolicyById(id: string): Promise<{ policy: RetentionPolicy; versions: RetentionPolicyVersion[] } | null>;
  updatePolicy(id: string, input: UpdatePolicyInput, userId?: string): Promise<RetentionPolicy>;
  dryRun(policyId: string, userId?: string): Promise<DryRunResult>;
  execute(policyId: string, userId?: string): Promise<ExecutionStartResult>;
  recover(executionId: string, userId?: string): Promise<ExecutionStartResult>;
  getExecutionById(id: string): Promise<DataRetentionAction | null>;
  getExecutions(params: { policyId?: string; status?: string; page?: number; pageSize?: number }): Promise<{
    executions: DataRetentionAction[];
    pagination: { page: number; pageSize: number; totalCount: number; totalPages: number };
  }>;
  initiateGracefulShutdown(): void;
  seedInitialPolicies(): Promise<void>;
}

export class DefaultRetentionService implements RetentionService {
  private isShuttingDown: boolean = false;

  constructor(
    private readonly dbInstance: NodePgDatabase<typeof schemas> = db,
    private readonly auditService: AuditService = defaultAuditService,
  ) {}

  initiateGracefulShutdown(): void {
    this.isShuttingDown = true;
  }

  async createPolicy(input: CreatePolicyInput, userId?: string): Promise<RetentionPolicy> {
    const registryEntry = RETENTION_TARGET_REGISTRY[input.dataCategory];
    if (!registryEntry) {
      throw new RetentionError(`Data category '${input.dataCategory}' is not recognized in server registry.`, 400, 'INVALID_DATA_CATEGORY');
    }

    if (input.retentionDurationDays <= 0) {
      throw new RetentionError('Retention duration must be greater than 0 days.', 400, 'INVALID_DURATION');
    }

    if (input.dataCategory === 'AUDIT_LOGS' && input.retentionDurationDays < 2555) {
      throw new RetentionError('AUDIT_LOGS retention must be at least 2,555 days (7 years platform default).', 400, 'AUDIT_DURATION_TOO_SHORT');
    }

    return await this.dbInstance.transaction(async (tx) => {
      const [policy] = await tx
        .insert(retentionPolicies)
        .values({
          policyCode: input.policyCode,
          name: input.name,
          description: input.description || null,
          dataCategory: input.dataCategory,
          targetIdentifier: input.targetIdentifier,
          referencePoint: input.referencePoint,
          retentionDurationDays: input.retentionDurationDays,
          disposition: input.disposition,
          status: 'DRAFT',
          version: 1,
          legalBasis: input.legalBasis || null,
          createdBy: userId || null,
          updatedBy: userId || null,
        })
        .returning();

      await tx.insert(retentionPolicyVersions).values({
        policyId: policy.id,
        version: 1,
        policySnapshot: policy,
        changeReason: 'Initial policy creation',
        changedBy: userId || null,
      });

      await this.auditService.logEvent(
        {
          action: 'retention.policy.create',
          entityType: 'retention_policy',
          entityId: policy.id,
          actorType: userId ? 'AUTHENTICATED' : 'SYSTEM',
          actorUserId: userId || null,
          outcome: 'SUCCESS',
          afterState: policy as unknown as Record<string, unknown>,
          context: { policyCode: policy.policyCode },
        },
        tx,
      );

      return policy;
    });
  }

  async getPolicies(filters?: { status?: string; dataCategory?: string }): Promise<RetentionPolicy[]> {
    const conditions = [];
    if (filters?.status) {
      conditions.push(eq(retentionPolicies.status, filters.status));
    }
    if (filters?.dataCategory) {
      conditions.push(eq(retentionPolicies.dataCategory, filters.dataCategory));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    return await this.dbInstance.select().from(retentionPolicies).where(whereClause).orderBy(retentionPolicies.policyCode);
  }

  async getPolicyById(id: string): Promise<{ policy: RetentionPolicy; versions: RetentionPolicyVersion[] } | null> {
    const [policy] = await this.dbInstance
      .select()
      .from(retentionPolicies)
      .where(eq(retentionPolicies.id, id))
      .limit(1);

    if (!policy) return null;

    const versions = await this.dbInstance
      .select()
      .from(retentionPolicyVersions)
      .where(eq(retentionPolicyVersions.policyId, id))
      .orderBy(desc(retentionPolicyVersions.version));

    return { policy, versions };
  }

  async updatePolicy(id: string, input: UpdatePolicyInput, userId?: string): Promise<RetentionPolicy> {
    if (!input.changeReason || input.changeReason.trim().length === 0) {
      throw new RetentionError('A mandatory changeReason is required to update a retention policy.', 400, 'MISSING_CHANGE_REASON');
    }

    return await this.dbInstance.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(retentionPolicies)
        .where(eq(retentionPolicies.id, id))
        .limit(1);

      if (!existing) {
        throw new RetentionError(`Retention policy ${id} not found.`, 404, 'POLICY_NOT_FOUND');
      }

      if (input.retentionDurationDays && input.retentionDurationDays <= 0) {
        throw new RetentionError('Retention duration must be greater than 0 days.', 400, 'INVALID_DURATION');
      }

      if (existing.dataCategory === 'AUDIT_LOGS' && input.retentionDurationDays && input.retentionDurationDays < 2555) {
        throw new RetentionError('AUDIT_LOGS retention must be at least 2,555 days (7 years platform default).', 400, 'AUDIT_DURATION_TOO_SHORT');
      }

      const newVersion = existing.version + 1;
      const updatedFields = {
        name: input.name ?? existing.name,
        description: input.description ?? existing.description,
        retentionDurationDays: input.retentionDurationDays ?? existing.retentionDurationDays,
        status: input.status ?? existing.status,
        version: newVersion,
        updatedBy: userId || null,
        updatedAt: new Date(),
      };

      const [updated] = await tx
        .update(retentionPolicies)
        .set(updatedFields)
        .where(eq(retentionPolicies.id, id))
        .returning();

      await tx.insert(retentionPolicyVersions).values({
        policyId: id,
        version: newVersion,
        policySnapshot: updated,
        changeReason: input.changeReason,
        changedBy: userId || null,
      });

      await this.auditService.logEvent(
        {
          action: 'retention.policy.update',
          entityType: 'retention_policy',
          entityId: id,
          actorType: userId ? 'AUTHENTICATED' : 'SYSTEM',
          actorUserId: userId || null,
          outcome: 'SUCCESS',
          beforeState: existing as unknown as Record<string, unknown>,
          afterState: updated as unknown as Record<string, unknown>,
          context: { changeReason: input.changeReason, version: newVersion },
        },
        tx,
      );

      return updated;
    });
  }

  async dryRun(policyId: string, userId?: string): Promise<DryRunResult> {
    const policyResult = await this.getPolicyById(policyId);
    if (!policyResult) {
      throw new RetentionError(`Retention policy ${policyId} not found.`, 404, 'POLICY_NOT_FOUND');
    }

    const { policy } = policyResult;
    const target = RETENTION_TARGET_REGISTRY[policy.dataCategory];
    if (!target) {
      throw new RetentionError(`Data category '${policy.dataCategory}' is not recognized in server registry.`, 400, 'UNKNOWN_TARGET');
    }

    if (!target.isExecutable) {
      throw new RetentionError(`Policy '${policy.policyCode}' target is not executable: ${target.blockedReason}`, 400, 'UNSUPPORTED_TARGET');
    }

    const cutoffDate = new Date(Date.now() - policy.retentionDurationDays * 24 * 60 * 60 * 1000);
    const pool = getDatabasePool();
    const client = await pool.connect();

    try {
      // Execute strict point-in-time estimated count query using compile-time constants
      const predicateSql = target.buildPredicateSql('$1');
      const query = `SELECT COUNT(*)::bigint AS count FROM ${target.table} WHERE ${predicateSql}`;
      const res = await client.query(query, [cutoffDate]);
      const estimatedCount = Number(res.rows[0]?.count || 0);

      await this.auditService.logEvent({
        action: 'retention.dry_run',
        entityType: 'retention_policy',
        entityId: policyId,
        actorType: userId ? 'AUTHENTICATED' : 'SYSTEM',
        actorUserId: userId || null,
        outcome: 'SUCCESS',
        context: {
          pointInTimeEstimatedCount: estimatedCount,
          cutoffTime: cutoffDate.toISOString(),
        },
      });

      return {
        isDryRun: true,
        pointInTimeEstimatedCount: estimatedCount,
        cutoffTime: cutoffDate.toISOString(),
        previewBatches: Math.ceil(estimatedCount / 500),
      };
    } finally {
      client.release();
    }
  }

  async execute(policyId: string, userId?: string): Promise<ExecutionStartResult> {
    const policyResult = await this.getPolicyById(policyId);
    if (!policyResult) {
      throw new RetentionError(`Retention policy ${policyId} not found.`, 404, 'POLICY_NOT_FOUND');
    }

    const { policy } = policyResult;
    if (policy.status !== 'ACTIVE') {
      throw new RetentionError(`Policy '${policy.policyCode}' is ${policy.status}. Only ACTIVE policies can be executed.`, 400, 'POLICY_NOT_ACTIVE');
    }

    const target = RETENTION_TARGET_REGISTRY[policy.dataCategory];
    if (!target || !target.isExecutable) {
      throw new RetentionError(
        `Policy target '${policy.dataCategory}' is not executable: ${target?.blockedReason || 'Unknown target'}`,
        400,
        'UNSUPPORTED_TARGET',
      );
    }

    const pool = getDatabasePool();
    const client = await pool.connect();

    let executionId: string;
    let cutoffTime: Date;

    try {
      await client.query('BEGIN');
      // Advisory transaction lock to prevent duplicate runs of same policy
      const lockRes = await client.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired', [`retention:${policyId}`]);
      if (!lockRes.rows[0]?.acquired) {
        throw new RetentionError(`Concurrent retention execution lock active for policy ${policyId}.`, 409, 'EXECUTION_IN_PROGRESS');
      }

      // Check if an existing RUNNING execution has a valid lease
      const activeRes = await client.query(
        `SELECT id FROM governance.data_retention_actions 
         WHERE policy_id = $1 AND status = 'RUNNING' AND lease_expires_at > now()`,
        [policyId],
      );

      if (activeRes.rows.length > 0) {
        throw new RetentionError(`An active execution with valid lease is currently running for policy ${policyId}.`, 409, 'ACTIVE_EXECUTION_EXISTS');
      }

      executionId = crypto.randomUUID();
      cutoffTime = new Date(Date.now() - policy.retentionDurationDays * 24 * 60 * 60 * 1000);
      const workerId = crypto.randomUUID();
      const leaseExpiresAt = new Date(Date.now() + 30000); // 30s heartbeat lease

      await client.query(
        `INSERT INTO governance.data_retention_actions (
          execution_id, policy_id, policy_version, data_category, action, is_dry_run,
          status, evaluated_count, affected_count, skipped_count, failed_count, batch_count,
          cutoff_time, fence_token, worker_id, lease_expires_at, executed_by
        ) VALUES (
          $1, $2, $3, $4, $5, false,
          'RUNNING', 0, 0, 0, 0, 0,
          $6, 1, $7, $8, $9
        )`,
        [executionId, policy.id, policy.version, policy.dataCategory, policy.disposition, cutoffTime, workerId, leaseExpiresAt, userId || null],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Spawn background worker loop asynchronously
    setImmediate(() => {
      this.runWorkerLoop(executionId, policy, target, cutoffTime, 1).catch((err) => {
        console.error(`Retention worker failed for execution ${executionId}:`, err);
      });
    });

    return {
      executionId,
      status: 'RUNNING',
      pollUrl: `/api/v1/admin/retention/executions/${executionId}`,
    };
  }

  private async runWorkerLoop(
    executionId: string,
    _policy: RetentionPolicy,
    target: TargetRegistryEntry,
    cutoffTime: Date,
    fenceToken: number,
  ): Promise<void> {
    let hasMore = true;
    let cursorId: string | null = null;

    const pool = getDatabasePool();

    while (hasMore && !this.isShuttingDown) {
      // 1. Extend worker lease heartbeat
      const leaseClient = await pool.connect();
      try {
        const renewRes = await leaseClient.query(
          `UPDATE governance.data_retention_actions
           SET lease_expires_at = now() + interval '30 seconds'
           WHERE execution_id = $1 AND fence_token = $2 AND status = 'RUNNING'
           RETURNING id`,
          [executionId, fenceToken],
        );
        if (renewRes.rowCount === 0) {
          // Lost lease or superseded by another worker
          return;
        }
      } finally {
        leaseClient.release();
      }

      // 2. Execute bounded batch with 25-second deadline
      const batchClient = await pool.connect();
      try {
        await batchClient.query("SET statement_timeout = '10s'");
        await batchClient.query("SET lock_timeout = '3s'");
        await batchClient.query('BEGIN');

        // Bounded cursor-based candidate selection
        const predicateSql: string = target.buildPredicateSql('$1');
        const cursorClause: string = cursorId ? `AND ${target.idColumn} > $2` : '';
        const params: any[] = cursorId ? [cutoffTime, cursorId] : [cutoffTime];

        const selectQuery: string = `
          SELECT ${target.idColumn} 
          FROM ${target.table} 
          WHERE ${predicateSql} ${cursorClause}
          ORDER BY ${target.idColumn} ASC 
          LIMIT 500
          FOR UPDATE SKIP LOCKED
        `;

        const selectRes: any = await batchClient.query(selectQuery, params);
        const rows: any[] = selectRes.rows;

        if (rows.length === 0) {
          await batchClient.query('COMMIT');
          hasMore = false;
          break;
        }

        const idsToDelete: string[] = rows.map((r: any) => r.id);
        const newCursorId: string = idsToDelete[idsToDelete.length - 1];

        // Perform atomic mutation
        await batchClient.query(`DELETE FROM ${target.table} WHERE ${target.idColumn} = ANY($1)`, [idsToDelete]);

        // Persist batch progress in same transaction
        await batchClient.query(
          `UPDATE governance.data_retention_actions
           SET affected_count = affected_count + $1,
               evaluated_count = evaluated_count + $1,
               batch_count = batch_count + 1,
               last_cursor_id = $2
           WHERE execution_id = $3 AND fence_token = $4 AND status = 'RUNNING'`,
          [idsToDelete.length, newCursorId, executionId, fenceToken],
        );

        await batchClient.query('COMMIT');
        cursorId = newCursorId;
        hasMore = idsToDelete.length === 500;
      } catch (batchErr: any) {
        await batchClient.query('ROLLBACK');
        // Outside the aborted transaction, authorized update records failed attempt
        const errClient = await pool.connect();
        try {
          await errClient.query(
            `UPDATE governance.data_retention_actions
             SET failed_count = failed_count + 1,
                 error_message = substr($1, 1, 1024)
             WHERE execution_id = $2 AND fence_token = $3 AND lease_expires_at > now()`,
            [batchErr.message || 'Batch transaction error', executionId, fenceToken],
          );
        } finally {
          errClient.release();
        }
        break;
      } finally {
        batchClient.release();
      }
    }

    // 3. Finalization verification
    if (!this.isShuttingDown) {
      await this.finalizeExecution(executionId, target, cutoffTime, fenceToken);
    }
  }

  private async finalizeExecution(
    executionId: string,
    target: TargetRegistryEntry,
    cutoffTime: Date,
    fenceToken: number,
  ): Promise<void> {
    const pool = getDatabasePool();
    const client = await pool.connect();

    try {
      const predicateSql = target.buildPredicateSql('$1');
      let remainingCount = 0;

      // Point-in-time check with retry backoff for lock contention
      for (let attempt = 0; attempt < 3; attempt++) {
        const countRes = await client.query(
          `SELECT COUNT(*)::bigint AS count FROM ${target.table} WHERE ${predicateSql}`,
          [cutoffTime],
        );
        remainingCount = Number(countRes.rows[0]?.count || 0);
        if (remainingCount === 0) break;
        await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempt)));
      }

      const finalStatus = remainingCount === 0 ? 'COMPLETED' : 'PARTIAL';

      await client.query(
        `UPDATE governance.data_retention_actions
         SET status = $1::varchar,
             completed_at = CASE WHEN $1::text = 'COMPLETED' THEN now() ELSE completed_at END,
             diagnostic_data = jsonb_set(
               diagnostic_data,
               '{unprocessedEligibleCount}',
               to_jsonb($2::bigint)
             )
         WHERE execution_id = $3 AND fence_token = $4`,
        [finalStatus, remainingCount, executionId, fenceToken],
      );

      await this.auditService.logEvent({
        action: finalStatus === 'COMPLETED' ? 'retention.execution_completed' : 'retention.execution_partial',
        entityType: 'retention_execution',
        entityId: null,
        actorType: 'SYSTEM',
        outcome: 'SUCCESS',
        context: {
          executionId,
          finalStatus,
          unprocessedEligibleCount: remainingCount,
        },
      });
    } finally {
      client.release();
    }
  }

  async recover(executionId: string, userId?: string): Promise<ExecutionStartResult> {
    const pool = getDatabasePool();
    const client = await pool.connect();

    let newExecutionId: string;
    let policy: RetentionPolicy;
    let target: TargetRegistryEntry;
    let cutoffTime: Date;
    let newFenceToken: number;

    try {
      await client.query('BEGIN');
      await client.query("SET lock_timeout = '2s'");

      // Row-lock predecessor execution row with retry loop
      let predecessorRow: any = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await client.query(
            `SELECT * FROM governance.data_retention_actions WHERE execution_id = $1 FOR UPDATE`,
            [executionId],
          );
          if (res.rows.length > 0) {
            predecessorRow = res.rows[0];
            break;
          }
        } catch (lockErr) {
          if (attempt === 2) throw lockErr;
          await new Promise((r) => setTimeout(r, 100 * Math.pow(3, attempt)));
        }
      }

      if (!predecessorRow) {
        throw new RetentionError(`Execution '${executionId}' not found.`, 404, 'EXECUTION_NOT_FOUND');
      }

      if (predecessorRow.status === 'COMPLETED') {
        throw new RetentionError(`Execution '${executionId}' is already COMPLETED and cannot be resumed.`, 400, 'CANNOT_RESUME_COMPLETED');
      }

      if (predecessorRow.status === 'RUNNING') {
        const leaseExpired = new Date(predecessorRow.lease_expires_at).getTime() <= Date.now();
        if (!leaseExpired) {
          throw new RetentionError(`Execution '${executionId}' has an active valid worker lease. Recovery rejected.`, 409, 'LEASE_STILL_VALID');
        }
        // Mark predecessor as PARTIAL
        await client.query(
          `UPDATE governance.data_retention_actions
           SET status = 'PARTIAL',
               diagnostic_data = jsonb_set(
                 diagnostic_data,
                 '{recovered_by_worker}',
                 to_jsonb(true)
               )
           WHERE id = $1`,
          [predecessorRow.id],
        );
      }

      // Chain depth limit check (max 5)
      const depthRes = await client.query(
        `WITH RECURSIVE lineage AS (
          SELECT id, resumed_from_execution_id, 1 as depth
          FROM governance.data_retention_actions
          WHERE id = $1
          UNION ALL
          SELECT d.id, d.resumed_from_execution_id, l.depth + 1
          FROM governance.data_retention_actions d
          JOIN lineage l ON d.id = l.resumed_from_execution_id
        ) SELECT MAX(depth) AS max_depth FROM lineage`,
        [predecessorRow.id],
      );

      const chainDepth = Number(depthRes.rows[0]?.max_depth || 1);
      if (chainDepth >= 5) {
        throw new RetentionError(`Maximum recovery chain depth (5) exceeded for execution ${executionId}.`, 400, 'MAX_CHAIN_DEPTH_EXCEEDED');
      }

      const policyResult = await this.getPolicyById(predecessorRow.policy_id);
      if (!policyResult) {
        throw new RetentionError('Associated policy not found.', 404, 'POLICY_NOT_FOUND');
      }
      policy = policyResult.policy;
      target = RETENTION_TARGET_REGISTRY[policy.dataCategory];

      newExecutionId = crypto.randomUUID();
      newFenceToken = predecessorRow.fence_token + 1;
      cutoffTime = new Date(predecessorRow.cutoff_time);
      const workerId = crypto.randomUUID();
      const leaseExpiresAt = new Date(Date.now() + 30000);

      await client.query(
        `INSERT INTO governance.data_retention_actions (
          execution_id, policy_id, policy_version, data_category, action, is_dry_run,
          status, evaluated_count, affected_count, skipped_count, failed_count, batch_count,
          cutoff_time, fence_token, worker_id, lease_expires_at, resumed_from_execution_id,
          last_cursor_id, executed_by
        ) VALUES (
          $1, $2, $3, $4, $5, false,
          'RUNNING', 0, 0, 0, 0, 0,
          $6, $7, $8, $9, $10,
          $11, $12
        )`,
        [
          newExecutionId,
          policy.id,
          policy.version,
          policy.dataCategory,
          policy.disposition,
          cutoffTime,
          newFenceToken,
          workerId,
          leaseExpiresAt,
          predecessorRow.id,
          predecessorRow.last_cursor_id,
          userId || null,
        ],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    setImmediate(() => {
      this.runWorkerLoop(newExecutionId, policy, target, cutoffTime, newFenceToken).catch((err) => {
        console.error(`Recovery worker failed for execution ${newExecutionId}:`, err);
      });
    });

    return {
      executionId: newExecutionId,
      status: 'RUNNING',
      pollUrl: `/api/v1/admin/retention/executions/${newExecutionId}`,
    };
  }

  async getExecutionById(id: string): Promise<DataRetentionAction | null> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const [row] = await this.dbInstance
      .select()
      .from(dataRetentionActions)
      .where(isUuid ? sql`${dataRetentionActions.id} = ${id} OR ${dataRetentionActions.executionId} = ${id}` : eq(dataRetentionActions.executionId, id))
      .limit(1);

    return row || null;
  }

  async getExecutions(params: { policyId?: string; status?: string; page?: number; pageSize?: number }): Promise<{
    executions: DataRetentionAction[];
    pagination: { page: number; pageSize: number; totalCount: number; totalPages: number };
  }> {
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (params.policyId) {
      conditions.push(eq(dataRetentionActions.policyId, params.policyId));
    }
    if (params.status) {
      conditions.push(eq(dataRetentionActions.status, params.status));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalRow] = await this.dbInstance
      .select({ total: count() })
      .from(dataRetentionActions)
      .where(whereClause);

    const totalCount = Number(totalRow?.total || 0);
    const totalPages = Math.ceil(totalCount / pageSize);

    const executions = await this.dbInstance
      .select()
      .from(dataRetentionActions)
      .where(whereClause)
      .orderBy(desc(dataRetentionActions.startedAt))
      .limit(pageSize)
      .offset(offset);

    return {
      executions,
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages,
      },
    };
  }

  async seedInitialPolicies(): Promise<void> {
    const CANONICAL_POLICIES = [
      {
        policyCode: 'RET_USER_SESSIONS_30D',
        name: 'Expired User Sessions 30-Day Purge',
        description: 'Purges user session tokens 30 days after expiration',
        dataCategory: 'USER_SESSIONS',
        targetIdentifier: 'identity.user_sessions',
        referencePoint: 'expires_at',
        retentionDurationDays: 30,
        disposition: 'DELETE' as const,
        status: 'ACTIVE' as const,
        legalBasis: 'Data minimization; session hygiene',
      },
      {
        policyCode: 'RET_ANALYTICS_EVENTS_180D',
        name: 'Analytics Raw Events 180-Day Retention',
        description: 'Retains fine-grained analytics events for 180 days before deletion',
        dataCategory: 'ANALYTICS_EVENTS',
        targetIdentifier: 'analytics.analytics_events',
        referencePoint: 'occurred_at',
        retentionDurationDays: 180,
        disposition: 'DELETE' as const,
        status: 'ACTIVE' as const,
        legalBasis: 'Operational metrics and performance analysis',
      },
      {
        policyCode: 'RET_NOTIF_DELIVERIES_90D',
        name: 'Notification Deliveries 90-Day Retention',
        description: 'Retains delivered/failed notification dispatches for 90 days',
        dataCategory: 'NOTIFICATION_DELIVERIES',
        targetIdentifier: 'identity.notification_deliveries',
        referencePoint: 'created_at',
        retentionDurationDays: 90,
        disposition: 'DELETE' as const,
        status: 'ACTIVE' as const,
        legalBasis: 'Dispatch auditing and delivery troubleshooting',
      },
      {
        policyCode: 'RET_FEEDBACK_ANON_180D',
        name: 'Resource Feedback Anonymization (180 Days)',
        description: 'Anonymizes resource feedback after 180 days',
        dataCategory: 'FEEDBACK_REPORTS',
        targetIdentifier: 'content.resource_feedback',
        referencePoint: 'created_at',
        retentionDurationDays: 180,
        disposition: 'ANONYMIZE' as const,
        status: 'INACTIVE' as const,
        legalBasis: 'User privacy; inactive pending constraint migration',
      },
      {
        policyCode: 'RET_AUDIT_LOGS_7Y',
        name: 'Central Audit Logs 7-Year Retention',
        description: 'Platform baseline audit logs retention pending legal archive implementation',
        dataCategory: 'AUDIT_LOGS',
        targetIdentifier: 'governance.audit_logs',
        referencePoint: 'occurred_at',
        retentionDurationDays: 2555,
        disposition: 'ARCHIVE' as const,
        status: 'INACTIVE' as const,
        legalBasis: 'Platform security policy default',
      },
    ];

    for (const p of CANONICAL_POLICIES) {
      const [existing] = await this.dbInstance
        .select()
        .from(retentionPolicies)
        .where(eq(retentionPolicies.policyCode, p.policyCode))
        .limit(1);

      if (!existing) {
        const [inserted] = await this.dbInstance
          .insert(retentionPolicies)
          .values({
            policyCode: p.policyCode,
            name: p.name,
            description: p.description,
            dataCategory: p.dataCategory,
            targetIdentifier: p.targetIdentifier,
            referencePoint: p.referencePoint,
            retentionDurationDays: p.retentionDurationDays,
            disposition: p.disposition,
            status: p.status,
            version: 1,
            legalBasis: p.legalBasis,
          })
          .returning();

        await this.dbInstance.insert(retentionPolicyVersions).values({
          policyId: inserted.id,
          version: 1,
          policySnapshot: inserted,
          changeReason: 'Canonical policy seeding',
        });
      } else {
        // Ensure version 1 snapshot exists (seed drift protection)
        const [v1] = await this.dbInstance
          .select()
          .from(retentionPolicyVersions)
          .where(and(eq(retentionPolicyVersions.policyId, existing.id), eq(retentionPolicyVersions.version, 1)))
          .limit(1);

        if (!v1) {
          await this.dbInstance.insert(retentionPolicyVersions).values({
            policyId: existing.id,
            version: 1,
            policySnapshot: existing,
            changeReason: 'Restored missing canonical version 1 snapshot',
          });
        }
      }
    }
  }
}

export const defaultRetentionService = new DefaultRetentionService();
