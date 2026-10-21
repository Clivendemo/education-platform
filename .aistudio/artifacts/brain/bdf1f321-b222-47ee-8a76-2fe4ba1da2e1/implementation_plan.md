# Prompt 28 — Audit & Data Retention Subsystem

## Complete Technical Implementation Plan (Read-Only Planning Revision 10)

**Milestone:** Prompt 28 — Audit & Data Retention  
**Governance Phase:** PLAN ONLY · Read-Only Revision 10  
**Implementation Authorization:** STRICTLY WITHHELD / PENDING HUMAN APPROVAL  
**Repository State:** Read-only inspected · Zero code files, migrations, dependencies, or database records modified  

---

## 1. Executive Summary & Governance Posture

> [!IMPORTANT]
> **Implementation Authorization Status: WITHHELD / PENDING HUMAN APPROVAL.**  
> In accordance with the mandatory governance sequence (`PLAN → HUMAN APPROVAL → IMPLEMENT → TEST → REPORT → STOP`), this deliverable is strictly read-only. No files have been created or modified in the application source tree, no migrations have run, no packages have been installed, and no database records have been mutated.

Revision 10 provides a complete, consolidated specification resolving all critical and high-priority findings raised in the Revision 9 review:
1. **Transaction-Duration & Timeout Disambiguation:** Distinguishes PostgreSQL statement timeouts from application-level transaction deadlines using `AbortController`, cancellation tokens, and bounded retryable row-lock acquisition.
2. **Formal Recovery & Ownership State Machine:** Details the transition matrix for `RUNNING`, `PARTIAL`, `COMPLETED`, and `FAILED` states, formalizes linked execution lineage with `resumed_from_execution_id` (`ON DELETE RESTRICT`), and handles repeated recovery requests without ambiguity.
3. **Transactional Batch Counter Accounting:** Solves counter persistence across rollbacks by separating in-transaction batch metrics from worker-level failure recording, preventing fenced-out workers from altering execution state.
4. **Execution Worker Lifecycle & Shutdown Semantics:** Specifies asynchronous execution (`HTTP 202 Accepted` with polling), cooperative batch processing, `SIGTERM`/`SIGINT` graceful shutdown, and heartbeat lease renewal.
5. **Deterministic Migration & Seed Drift Failure Protocols:** Establishes strict abort/correction behaviors for incompatible schemas, missing version-1 snapshots, and unauthorized RBAC drift within atomic transactions.
6. **Strict Server-Controlled Target Registry Allowlist:** Completely eliminates dynamic SQL string concatenation for tables/columns, binding every executable target to a compile-time allowlist with concrete index requirements, and enforces hard barriers against feedback anonymization and audit archiving.
7. **Point-in-Time Completion Boundary:** Defines completion as point-in-time verification of zero eligible records under cutoff, with bounded retry backoff for concurrent lock contention.
8. **Comprehensive Privacy & Payload Sanitization:** Expands byte limits and field sanitization across `context` (4,096 B), `actor_snapshot` (2,048 B), `diagnostic_data` (8,192 B), and `error_message` (1,024 B).
9. **Expanded Acceptance Test Suite:** Adds all 10 recommended edge-case tests, bringing total planned Prompt 28 tests to 26.

---

## 2. Categorical Evidence & Project Baseline

To prevent ambiguity, repository data is strictly segregated into three distinct categories:

### A. Verified Facts from Repository Inspection
- **Migration Journal:** `drizzle/meta/_journal.json` contains 17 entries (indices 0 through 16). Index 16 is `0016_analytics_architecture`. Index 17 is unallocated and reserved for Prompt 28.
- **Logical Schemas:** `src/db/logical-schemas.ts` defines `governanceSchema = pgSchema('governance')`.
- **Existing Governance Tables:** `src/db/schema/governance.ts` defines `qualityCheckTypes`, `resourceQualityChecks`, and `resourceVerifications`.
- **Geography & Country Reference:** `platform.countries` is defined in `src/db/schema/geography.ts` with primary key `id` (UUID).
- **Session Architecture:** `identity.user_sessions` has columns `id`, `user_id`, `token_hash`, `expires_at`, `revoked_at`, `created_at`.
- **Analytics Architecture:** `analytics.analytics_events` has columns `id`, `event_type_id`, `actor_type`, `user_id`, `occurred_at`.
- **Notification Deliveries Architecture:** `identity.notification_deliveries` has columns `id`, `notification_id`, `channel`, `status`, `created_at`. Terminal statuses include `'DELIVERED'` and `'FAILED'`.
- **Feedback Architecture Constraint:** `content.resource_feedback` contains check constraint `chk_feedback_exactly_one_identity` enforcing `(user_id IS NOT NULL AND session_id IS NULL) OR (user_id IS NULL AND session_id IS NOT NULL)`.
- **RBAC Seed Baseline:** `src/db/seeds/roles-permissions.ts` configures 6 canonical roles and 38 permissions.
- **Prior Milestone Evidence:** Prompt 27 analytics test suite has **46 passing tests** across 3 test files (`analytics.service.test.ts` [27], `analytics.integration.test.ts` [6], and `routes/analytics.integration.test.ts` [13]).

### B. Proposed Design Specifications (Pending Implementation Approval)
- Four new tables in `governance` schema: `audit_logs`, `retention_policies`, `retention_policy_versions`, and `data_retention_actions`.
- Four new permissions: `audit.read`, `retention.read`, `retention.manage`, `retention.execute`.
- PostgreSQL append-only triggers on `audit_logs` and `retention_policy_versions`.
- Asynchronous retention worker service with cooperative batching and advisory lease fencing.

### C. Test Accounting Discipline
- **Planned Tests (Prompt 28):** 26 tests designed (0 executed).
- **Executed & Verified Tests:** 0 tests executed for Prompt 28. No tests will be claimed as executed until post-authorization test run logs are captured.

---

## 3. Detailed Resolution of Core Review Blockers

### 3.1 Critical 1: Transaction Duration vs. Statement Timeout & Application Batch Deadlines

#### Problem Analysis
PostgreSQL's `statement_timeout` applies to single SQL statements, not the cumulative duration of a multi-statement transaction. If a worker hangs during a batch or holds row locks (`FOR UPDATE`) indefinitely, recovery attempts will block or timeout.

#### Technical Resolution
1. **Multi-Layer Timeout Architecture:**
   - **PostgreSQL Statement Timeout:** Set per-connection/session to `statement_timeout = '10s'`. No individual `SELECT`, `DELETE`, or `UPDATE` statement may exceed 10 seconds.
   - **PostgreSQL Lock Timeout:** Set per-connection/session to `lock_timeout = '3s'`. Lock acquisition attempts (`FOR UPDATE SKIP LOCKED` or advisory locks) fail fast after 3 seconds instead of blocking the pool.
   - **PostgreSQL Idle In Transaction Timeout:** Set to `idle_in_transaction_session_timeout = '5s'`. Sessions lingering in uncommitted transactions are terminated by the server.
   - **Application Batch Deadline (`AbortController`):** The application encapsulates each batch execution within an `AbortController` with a hard deadline of **25 seconds** (5 seconds shorter than the 30-second worker heartbeat lease).
2. **Safe Cancellation & Rollback:**
   - If the application batch timer expires, `abortController.abort()` triggers `client.query('ROLLBACK')` and immediately terminates the client connection from the pool.
   - The transaction rolls back cleanly, releasing all row locks on target tables and the execution record.
3. **Recovery Retries on Locked Predecessor Row:**
   - When a recovery worker attempts takeover of a stale execution via `SELECT ... FROM governance.data_retention_actions WHERE id = $1 FOR UPDATE`, it uses a retry loop:
     * Maximum 3 attempts with exponential jittered backoff (100ms, 300ms, 900ms).
     * Query uses `lock_timeout = '2s'` to prevent indefinite stalls.
     * If the predecessor row remains locked after 3 attempts, the recovery worker does not corrupt state; it logs a diagnostic warning and returns `409 Conflict` ("Predecessor execution lock held by another process; retry scheduled").

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Batch Execution Time Budget                     │
│                                                                        │
│ 0s                      10s                    25s          30s        │
│ ├────────────────────────┼──────────────────────┼────────────┤         │
│ │ Single Query Timeout   │ Cumulative Statement │ Batch      │ Lease   │
│ │ (statement_timeout)    │ Budget               │ Hard Abort │ Expiry  │
│ └────────────────────────┴──────────────────────┴────────────┴─────────┘
```

---

### 3.2 Critical 2: Formal Recovery & Ownership State Machine

#### Permitted Execution States & Transition Matrix

The `governance.data_retention_actions` table maintains execution lifecycle state with strong fencing.

```
                    ┌──────────────┐
                    │  (Initial)   │
                    └──────┬───────┘
                           │ POST /execute (Advisory lock acquired)
                           ▼
                    ┌──────────────┐
       ┌───────────►│   RUNNING    │◄──────────┐
       │            └──────┬───────┘           │
       │                   │                   │
       │ Lease expired     │ All batches done  │ Recovery of PARTIAL
       │ & takeover        │ & verified        │ (Resumed execution)
       ▼                   ▼                   │
┌──────────────┐    ┌──────────────┐           │
│   PARTIAL    │    │  COMPLETED   │           │
└──────┬───────┘    └──────────────┘           │
       │                                       │
       └───────────────────────────────────────┘
                           │
                           │ Unrecoverable error /
                           │ terminal failure
                           ▼
                    ┌──────────────┐
                    │    FAILED    │
                    └──────────────┘
```

#### Event-Driven Transition Specification

| Current State & Lease Condition | Trigger Event | Guard / Preconditions | Transition & Outcome |
|---|---|---|---|
| `RUNNING` (lease valid, `now() < lease_expires_at`) | Duplicate `execute` request | Same `policy_id` | **Reject with HTTP 409 Conflict.** Active execution in progress. |
| `RUNNING` (lease valid) | Recovery request | Same `execution_id` | **Reject with HTTP 409 Conflict.** Worker lease has not expired. |
| `RUNNING` (lease expired, `now() >= lease_expires_at`) | Authorized recovery request | Caller has `retention.execute` | **Mark predecessor `PARTIAL`.** Create new linked execution with `resumed_from_execution_id = predecessor.id`, increment `fence_token`, set status `RUNNING`. |
| `PARTIAL` | Recovery / Resume request | Caller has `retention.execute` | **Create new linked execution.** Points to `PARTIAL` execution via `resumed_from_execution_id`. Copies `last_cursor_id` and frozen `cutoff_time`. Maximum resume chain depth: 5 runs. |
| `PARTIAL` | Max chain depth exceeded (>= 5) | Resume request | **Reject with HTTP 400 Bad Request.** Maximum recovery attempts reached; requires manual investigation or new baseline run. |
| `COMPLETED` | Recovery / Resume request | Any caller | **Reject with HTTP 400 Bad Request.** Execution is terminal. A new execution must be initiated. |
| `FAILED` | Recovery request | Terminal schema/SQL error | **Reject with HTTP 400 Bad Request.** Terminal errors cannot be resumed. Requires policy/schema fix. |
| `FAILED` | Recovery request | Transient network/timeout error | **Allow linked retry.** Creates new execution referencing failed run if retry flag is explicit. |

#### Foreign Key Lineage Guarantee
- `resumed_from_execution_id` uses `ON DELETE RESTRICT` (NOT `ON DELETE SET NULL`). This guarantees that execution history and audit lineage can never be severed or orphaned by accidental deletions.

---

### 3.3 High 1: Transactional Counter Persistence Across Failures

#### Problem Analysis
If a batch mutates target records and encounters a failure or fence mismatch, the entire transaction rolls back. If `failed_count` is incremented inside that same rolled-back transaction, the count increments are lost.

#### Technical Resolution
1. **Separation of Concerns:**
   - **In-Transaction Counters (Committed Atomically):** `affected_count`, `batch_count`, and `last_cursor_id` are persisted strictly within the batch transaction alongside target row deletions. If the batch rolls back, target mutations and these counters roll back together.
   - **Post-Rollback Diagnostic Accounting:** If a batch transaction throws (e.g. statement timeout, transient lock conflict), the worker catches the error outside the aborted transaction.
2. **Authorized Failure Logging:**
   - The worker initiates an autonomous, separate query:
     ```sql
     UPDATE governance.data_retention_actions
     SET failed_count = failed_count + 1,
         diagnostic_data = jsonb_set(
           diagnostic_data,
           '{last_error}',
           to_jsonb($1::text)
         ),
         updated_at = now()
     WHERE id = $2
       AND fence_token = $3
       AND lease_expires_at > now();
     ```
   - **Fencing Guard:** If the worker was fenced out (its `fence_token` was superseded or lease expired), the `WHERE` condition matches 0 rows. The fenced worker is prevented from mutating the execution record.
3. **Counter Definitions:**
   - `evaluated_count`: Total candidates returned by the cursor query across all successfully executed batches.
   - `skipped_count`: Cumulative count of records meeting timestamp criteria but skipped due to active row locks (`SKIP LOCKED`).
   - `unprocessedEligibleCount`: Point-in-time count determined during final verification check; recorded in diagnostic metadata.

---

### 3.4 High 2: Execution Worker Lifecycle & Graceful Shutdown

#### Dual Execution Contract
- **POST `/api/v1/admin/retention/execute`:**
  - Initiates asynchronous execution.
  - Generates UUID `executionId`, sets status `RUNNING`, acquires initial 30-second lease.
  - Spawns background worker loop.
  - Immediately returns `HTTP 202 Accepted` with:
    ```json
    {
      "success": true,
      "executionId": "b1a2c3d4-...",
      "status": "RUNNING",
      "pollUrl": "/api/v1/admin/retention/executions/b1a2c3d4-..."
    }
    ```
- **GET `/api/v1/admin/retention/executions/:id`:**
  - Returns current status, counters, elapsed time, and diagnostic progress.

#### Worker Loop Architecture
```ts
async function runRetentionWorker(executionId: string, policy: RetentionPolicy, fenceToken: number) {
  let hasMore = true;
  let cursorId: string | null = execution.lastCursorId;

  while (hasMore && !isShuttingDown) {
    // 1. Check & renew lease heartbeat (extends lease_expires_at by 30s)
    const renewed = await renewWorkerLease(executionId, fenceToken, 30);
    if (!renewed) {
      logger.warn('Worker lost lease or was fenced out; aborting loop', { executionId });
      return;
    }

    // 2. Execute single bounded batch (500 rows) with 25s application timeout
    const batchResult = await executeBatchWithDeadline(executionId, policy, cursorId, fenceToken, 25000);
    
    if (batchResult.abortedDueToShutdown) break;
    
    cursorId = batchResult.lastCursorId;
    hasMore = batchResult.batchSize === 500;
  }

  // 3. Finalization verification
  if (!isShuttingDown) {
    await finalizeExecution(executionId, policy, fenceToken);
  }
}
```

#### Graceful Shutdown Protocol (`SIGTERM` / `SIGINT`)
1. Application registers process signal listeners in Fastify lifecycle:
   ```ts
   process.on('SIGTERM', () => retentionService.initiateGracefulShutdown());
   ```
2. Setting `isShuttingDown = true` notifies the worker to stop acquiring new batches.
3. In-flight batch transactions complete naturally (if within their 25s deadline) or abort cleanly on process exit without leaving orphaned locks.
4. The execution row remains in `RUNNING` status with its last committed `last_cursor_id`. When the 30-second lease expires, subsequent recovery can resume seamlessly from that cursor.

---

### 3.5 High 3: Migration & Seed Safety Protocols

#### Failure Protocols

| Scenario | Migration / Seed Behavior | Safety Guarantee |
|---|---|---|
| **Pre-existing Table Conflict:** Governance tables exist with incompatible columns | Migration transaction fails fast on `CREATE TABLE` / constraint mismatch; raises descriptive exception. | Whole migration rolls back cleanly; no partial tables created. |
| **Missing Version-1 Snapshot:** Policy exists in table without version snapshot | Seed script validates version table; detects missing snapshot and inserts canonical v1 snapshot transactionally. | Policy versions remain 100% synchronized with policies. |
| **Permission Metadata Drift:** Permission exists with divergent description | Seed compares and updates metadata fields in place using primary key. | Canonical permissions remain deterministic. |
| **Unauthorized RBAC Mapping:** Unexpected permission assigned to a role | Seed script revokes unauthorized mappings transactionally and emits structured security log. | RBAC role-permission matrix strictly matches specification. |
| **Partial Failure:** Network break or constraint violation during migration | Entire migration runs inside explicit PostgreSQL transaction (`BEGIN ... COMMIT`). | Zero half-applied state; database remains at index 16. |

---

### 3.6 High 4: Dynamic Target Selection & Server Allowlist Registry

#### Strict Allowlist Registry Specification

No table names, column names, or where clauses are EVER constructed from user input or database text columns. All executable metadata is hardcoded in `RETENTION_TARGET_REGISTRY`:

```ts
export interface TargetDefinition {
  table: string;
  idColumn: string;
  referenceColumn: string;
  timestampColumn: string;
  mutation: 'DELETE';
  isExecutable: boolean;
  requiredIndex: string;
  buildPredicateSql: (cutoffTimeParam: string) => string;
}

export const RETENTION_TARGET_REGISTRY: Record<string, TargetDefinition> = {
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
    isExecutable: false, // HARD BARRIER: Blocked by chk_feedback_exactly_one_identity
    requiredIndex: 'idx_resource_feedback_created_at',
    buildPredicateSql: () => { throw new Error('FEEDBACK_REPORTS execution blocked by governance constraint'); },
  },
  AUDIT_LOGS: {
    table: 'governance.audit_logs',
    idColumn: 'id',
    referenceColumn: 'occurred_at',
    timestampColumn: 'occurred_at',
    mutation: 'DELETE',
    isExecutable: false, // HARD BARRIER: Blocked until off-cluster cold storage pipeline exists
    requiredIndex: 'idx_audit_logs_occurred_action',
    buildPredicateSql: () => { throw new Error('AUDIT_LOGS archiving unsupported in this milestone'); },
  },
};
```

---

### 3.7 Medium 1: Point-in-Time Completion Boundaries

#### Completion Semantics
1. **Point-in-Time Verification:** Setting status to `COMPLETED` certifies solely that **at the moment of the final verification query**, zero records matching `predicateSql(cutoffTime)` were found.
2. **No Permanent Invariant:** It is explicitly documented that concurrent inserts or subsequent clock ticks may create new eligible records immediately after execution completes.
3. **Contention Backoff:**
   - If the final verification count is > 0 because active concurrent transactions hold rows locked (`FOR UPDATE`), the worker retries up to 3 times with exponential backoff (200ms, 600ms, 1800ms).
   - If rows remain un-deletable after 3 retries, the execution is marked `PARTIAL` with diagnostic field `unprocessedEligibleCount: N`, allowing a subsequent run to finish the work.

---

### 3.8 Medium 2: Comprehensive Privacy & Payload Sanitization

#### Payload Size Constraints & Database Enforcement

| Field | Max Byte Length | Application Zod Validation | DB Check Constraint | Sanitization Rules |
|---|---|---|---|---|
| `audit_logs.context` | 4,096 B | `Buffer.byteLength(JSON.stringify(v)) <= 4096` | `octet_length(context::text) <= 4096` | Strips bearer tokens, passwords, auth headers, and raw session IDs. |
| `audit_logs.actor_snapshot` | 2,048 B | `Buffer.byteLength(JSON.stringify(v)) <= 2048` | `octet_length(actor_snapshot::text) <= 2048` | Contains only `{ actorId, actorType, actorRole, emailDomain }`. No personal contact info. |
| `data_retention_actions.diagnostic_data` | 8,192 B | `Buffer.byteLength(JSON.stringify(v)) <= 8192` | `octet_length(diagnostic_data::text) <= 8192` | Strips raw payloads; records query batch metrics, cursor IDs, and error summaries. |
| `data_retention_actions.error_message` | 1,024 B | `Buffer.byteLength(v, 'utf8') <= 1024` | `octet_length(error_message) <= 1024` | Sanitizes SQL parameter strings and stack traces; preserves error name and code. |

#### Mandatory Audit Events Enumeration
1. `policy.created` — Creation of new draft retention policy.
2. `policy.updated` — Modification of policy duration, legal basis, or rules.
3. `policy.status_changed` — Activation or deactivation of a policy.
4. `retention.dry_run` — Execution of point-in-time preview.
5. `retention.execution_started` — Initiation of live retention run.
6. `retention.batch_committed` — Successful atomic batch mutation and checkpoint.
7. `retention.execution_completed` — Final verified completion of run.
8. `retention.execution_failed` — Terminal failure or unhandled exception.
9. `retention.recovery_initiated` — Takeover of stale run by recovery worker.
10. `authorization.denied` — 401/403 access attempts on audit or retention endpoints.

---

## 4. Database Schema & Migration Specification

### Migration Target: `drizzle/0017_audit_and_retention.sql` (Journal Index 17)

```sql
-- Migration 0017: Audit & Data Retention Architecture
-- Atomic transaction wrapper
BEGIN;

-- 1. governance.audit_logs
CREATE TABLE IF NOT EXISTS governance.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id VARCHAR(64) NOT NULL UNIQUE,
    action VARCHAR(64) NOT NULL,
    entity_type VARCHAR(64) NOT NULL,
    entity_id UUID NULL,
    actor_type VARCHAR(20) NOT NULL CHECK (actor_type IN ('AUTHENTICATED', 'ANONYMOUS', 'SYSTEM')),
    actor_user_id UUID NULL REFERENCES identity.users(id) ON DELETE SET NULL,
    actor_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    outcome VARCHAR(20) NOT NULL CHECK (outcome IN ('SUCCESS', 'DENIED', 'FAILED')),
    request_id VARCHAR(64) NULL,
    country_id UUID NULL REFERENCES platform.countries(id) ON DELETE SET NULL,
    before_state JSONB NULL,
    after_state JSONB NULL,
    context JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_audit_logs_context_bytes CHECK (octet_length(context::text) <= 4096),
    CONSTRAINT chk_audit_logs_actor_snapshot_bytes CHECK (octet_length(actor_snapshot::text) <= 2048)
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_occurred_action ON governance.audit_logs (occurred_at DESC, action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON governance.audit_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON governance.audit_logs (actor_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_request_id ON governance.audit_logs (request_id) WHERE request_id IS NOT NULL;

-- 2. governance.retention_policies
CREATE TABLE IF NOT EXISTS governance.retention_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL,
    description TEXT NULL,
    data_category VARCHAR(64) NOT NULL,
    target_identifier VARCHAR(64) NOT NULL,
    reference_point VARCHAR(64) NOT NULL,
    retention_duration_days INTEGER NOT NULL CHECK (retention_duration_days > 0),
    disposition VARCHAR(20) NOT NULL CHECK (disposition IN ('DELETE', 'ANONYMIZE', 'ARCHIVE')),
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'INACTIVE', 'SUPERSEDED')),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    legal_basis TEXT NULL,
    created_by UUID NULL REFERENCES identity.users(id) ON DELETE SET NULL,
    updated_by UUID NULL REFERENCES identity.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_retention_audit_duration CHECK (data_category != 'AUDIT_LOGS' OR retention_duration_days >= 2555)
);

-- 3. governance.retention_policy_versions
CREATE TABLE IF NOT EXISTS governance.retention_policy_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id UUID NOT NULL REFERENCES governance.retention_policies(id) ON DELETE RESTRICT,
    version INTEGER NOT NULL,
    policy_snapshot JSONB NOT NULL,
    change_reason TEXT NOT NULL,
    changed_by UUID NULL REFERENCES identity.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_retention_policy_version UNIQUE (policy_id, version)
);

-- 4. governance.data_retention_actions
CREATE TABLE IF NOT EXISTS governance.data_retention_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_id VARCHAR(64) NOT NULL UNIQUE,
    policy_id UUID NOT NULL REFERENCES governance.retention_policies(id) ON DELETE RESTRICT,
    policy_version INTEGER NOT NULL,
    data_category VARCHAR(64) NOT NULL,
    action VARCHAR(20) NOT NULL CHECK (action IN ('DELETE', 'ANONYMIZE', 'ARCHIVE')),
    is_dry_run BOOLEAN NOT NULL DEFAULT false,
    status VARCHAR(20) NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED')),
    evaluated_count BIGINT NOT NULL DEFAULT 0,
    affected_count BIGINT NOT NULL DEFAULT 0,
    skipped_count BIGINT NOT NULL DEFAULT 0,
    failed_count BIGINT NOT NULL DEFAULT 0,
    batch_count INTEGER NOT NULL DEFAULT 0,
    cutoff_time TIMESTAMPTZ NOT NULL,
    fence_token INTEGER NOT NULL DEFAULT 1,
    worker_id VARCHAR(64) NULL,
    lease_expires_at TIMESTAMPTZ NULL,
    resumed_from_execution_id UUID NULL REFERENCES governance.data_retention_actions(id) ON DELETE RESTRICT,
    last_cursor_id UUID NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ NULL,
    executed_by UUID NULL REFERENCES identity.users(id) ON DELETE SET NULL,
    error_message VARCHAR(1024) NULL,
    diagnostic_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_retention_actions_diagnostic_bytes CHECK (octet_length(diagnostic_data::text) <= 8192)
);

CREATE INDEX IF NOT EXISTS idx_retention_actions_policy_created ON governance.data_retention_actions (policy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_retention_actions_lease ON governance.data_retention_actions (status, lease_expires_at) WHERE status = 'RUNNING';

-- 5. Immutability Triggers
CREATE OR REPLACE FUNCTION governance.prevent_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'governance.audit_logs is append-only: UPDATE and DELETE operations are forbidden.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_logs_immutable
BEFORE UPDATE OR DELETE ON governance.audit_logs
FOR EACH ROW EXECUTE FUNCTION governance.prevent_audit_mutation();

CREATE TRIGGER trg_retention_policy_versions_immutable
BEFORE UPDATE OR DELETE ON governance.retention_policy_versions
FOR EACH ROW EXECUTE FUNCTION governance.prevent_audit_mutation();

COMMIT;
```

---

## 5. API Contracts & RBAC Matrix

### Endpoints Specification

1. `GET /api/v1/admin/audit-logs` — Requires `audit.read`
   - **Query Parameters:** `page`, `pageSize`, `action`, `entityType`, `entityId`, `actorUserId`, `outcome`, `startDate`, `endDate`.
   - **Response:** `HTTP 200 OK` with paginated audit logs.
2. `GET /api/v1/admin/retention/policies` — Requires `retention.read`
   - **Query Parameters:** `status`, `dataCategory`.
   - **Response:** `HTTP 200 OK` with list of retention policies and their active versions.
3. `POST /api/v1/admin/retention/policies` — Requires `retention.manage`
   - **Body:** `{ policyCode, name, description, dataCategory, targetIdentifier, referencePoint, retentionDurationDays, disposition, legalBasis }`.
   - **Response:** `HTTP 201 Created` with initial Version 1 snapshot.
4. `GET /api/v1/admin/retention/policies/:id` — Requires `retention.read`
   - **Response:** `HTTP 200 OK` with policy and full historical version array.
5. `PATCH /api/v1/admin/retention/policies/:id` — Requires `retention.manage`
   - **Body:** `{ name?, description?, retentionDurationDays?, status?, changeReason }`.
   - **Response:** `HTTP 200 OK`. Atomically creates append-only version snapshot.
6. `POST /api/v1/admin/retention/dry-run` — Requires `retention.read`
   - **Body:** `{ policyId: string }`.
   - **Response:** `HTTP 200 OK` with `{ isDryRun: true, pointInTimeEstimatedCount, cutoffTime, previewBatches }`.
7. `POST /api/v1/admin/retention/execute` — Requires `retention.execute`
   - **Body:** `{ policyId: string }`.
   - **Response:** `HTTP 202 Accepted` with `{ executionId, status: "RUNNING", pollUrl }`.
8. `GET /api/v1/admin/retention/executions/:id` — Requires `retention.read`
   - **Response:** `HTTP 200 OK` with execution status, batch progress, and diagnostic metrics.
9. `POST /api/v1/admin/retention/executions/:id/recover` — Requires `retention.execute`
   - **Response:** `HTTP 202 Accepted` with new linked execution details.

### RBAC Permission Matrix

| Role Slug | `audit.read` | `retention.read` | `retention.manage` | `retention.execute` | Rationale |
|---|---|---|---|---|---|
| `system_admin` | **YES** | **YES** | **YES** | **YES** | Superuser platform governance |
| `content_manager` | NO | **YES** | NO | NO | Read-only compliance auditing |
| `content_reviewer` | NO | NO | NO | NO | Review work only |
| `verified_teacher` | NO | NO | NO | NO | Content creation only |
| `contributor` | NO | NO | NO | NO | Submissions only |
| `standard_user` | NO | NO | NO | NO | Discovery only |

---

## 6. Comprehensive Acceptance Test Suite (26 Tests Planned)

### Core Integration & Regression Suite (16 Tests)
1. **Migration & Immutability:** Verify migration 17 deploys cleanly and append-only trigger rejects `UPDATE`/`DELETE` on `audit_logs`.
2. **Policy Version Immutability:** Verify trigger prevents mutation of historical policy versions.
3. **Payload Byte Validation:** Verify 4,096-byte context limit is enforced at service and database levels.
4. **Actor Snapshot Preservation:** Verify user account deletion nullifies `actor_user_id` while preserving immutable `actor_snapshot`.
5. **Atomic Business Mutation & Audit:** Verify user role update and audit log write share a transaction; role change rolls back if audit fails.
6. **Point-in-Time Dry Run:** Verify dry run performs zero deletions and returns estimated preview.
7. **Bounded Batch Execution:** Verify 1,200 eligible session records are deleted across 3 distinct 500/500/200 batches.
8. **Deterministic Checkpointing:** Verify cursor advances monotonically (`id > last_cursor_id`).
9. **Target Registry Rejection:** Verify execution fails immediately if target or action is unsupported.
10. **Feedback Anonymization Blocked:** Verify execution of `RET_FEEDBACK_ANON_180D` is rejected.
11. **Audit Logs Archival Blocked:** Verify execution of `RET_AUDIT_LOGS_7Y` is rejected.
12. **RBAC Authorization Enforcement:** Verify `system_admin` succeeds (200/202), `content_manager` has read-only access (403 on execute), and unauthenticated returns 401.
13. **Duplicate Concurrency Rejection:** Verify simultaneous execution requests for the same policy return 409 Conflict under advisory lock.
14. **Lease Takeover:** Verify expired lease allows recovery worker to mark predecessor `PARTIAL` and resume work.
15. **Prompt 27 Regression Guard:** Verify all 46 existing analytics tests continue passing.
16. **Six Quality Gates:** Complete typecheck, lint, and build verification.

### Ten Recommended Review-Specific Tests (Tests 17–26)
17. **Predecessor Row Lock Timeout & Retry:** Recovery attempt retries 3 times when predecessor row is locked, then returns 409 without deadlocking.
18. **Repeated Recovery of PARTIAL Run:** Resuming an already `PARTIAL` execution correctly chains lineage via `resumed_from_execution_id` without duplicating work.
19. **Batch Deadline Exceeded:** A worker transaction exceeding the 25-second `AbortController` deadline is aborted and rolled back.
20. **Failed Count Persistence Post-Rollback:** A failed batch attempt logs incremented `failed_count` in a separate authorized update.
21. **Finalization Failure Handling:** A failure during post-batch finalization leaves committed batches intact and status recoverable.
22. **Target Registry Unknown Allowlist Rejection:** Arbitrary table names or malicious SQL identifiers injected into policy parameters are rejected before SQL generation.
23. **Missing Policy Version-1 Snapshot:** Seed detection identifies missing version snapshots and restores them transactionally.
24. **Unauthorized RBAC Seed Drift:** Seed script detects foreign permission assigned to a role, revokes it, and restores canonical matrix.
25. **Graceful Worker Shutdown (`SIGTERM`):** Receiving `SIGTERM` completes in-flight batch, persists cursor checkpoint, and leaves lease to expire safely.
26. **Late-Arriving Eligible Records:** Records created behind the cutoff during or after execution are left intact and processed by subsequent runs.

---

## 7. File Modification Manifest

### Files to Create (9 files)
1. `drizzle/0017_audit_and_retention.sql` — Schema tables, check constraints, indexes, and immutability triggers.
2. `src/services/audit.service.ts` — Context allowlisting, byte validation, event logging, and paginated queries.
3. `src/services/retention.service.ts` — Target registry, state machine, worker lifecycle, and advisory locking.
4. `src/routes/api/v1/audit.ts` — Audit log admin endpoints.
5. `src/routes/api/v1/retention.ts` — Policy and execution management endpoints.
6. `tests/services/audit.service.test.ts` — Audit service unit tests.
7. `tests/services/retention.service.test.ts` — Retention service and registry unit tests.
8. `tests/db/audit-retention.integration.test.ts` — Database triggers, rollback atomicity, and timeout integration tests.
9. `tests/routes/audit-retention.integration.test.ts` — Route authentication, RBAC, and lifecycle tests.

### Files to Modify (6 files)
1. `src/db/schema/governance.ts` — Export table schemas for Drizzle ORM.
2. `drizzle/meta/_journal.json` — Register migration index 17.
3. `src/db/seeds/roles-permissions.ts` — Seed 4 new permissions and canonical role mappings.
4. `src/app.ts` — Register audit and retention routes in Fastify.
5. `docs/ARCHITECTURE.md`, `docs/DATABASE_SPEC.md`, `docs/API_SPEC.md`, `docs/SECURITY_RULES.md` — Synchronize documentation.
6. `docs/IMPLEMENTATION_STATUS.md` — Update milestone tracking once verified.

---

## 8. Governance Stop Point

**Current Status:** PLAN ONLY · Read-Only Revision 10  
**Implementation Authorization:** Strictly Withheld  
No source code, migrations, tests, documentation, package manifests, or database records have been modified. This plan is submitted for human review. Implementation will only begin after explicit written approval.
