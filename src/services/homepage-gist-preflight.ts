import { sql } from 'drizzle-orm';
import type { AppDatabase } from '../db/index.js';

/**
 * Supported PostgreSQL server_version_num range (PostgreSQL 14.0 through 18.x).
 */
export const MIN_SUPPORTED_PG_VERSION_NUM = 140000;
export const MAX_SUPPORTED_PG_VERSION_NUM = 189999;

export type GistPreflightStatus =
  | 'INSTALLED_READY'
  | 'AVAILABLE_INSTALLABLE_BY_MIGRATION_ROLE'
  | 'UNSUPPORTED_PG_VERSION'
  | 'CORE_TSTZRANGE_OVERLAP_MISSING'
  | 'INSTALLED_BROKEN_OPCLASS'
  | 'EXTENSION_NOT_AVAILABLE'
  | 'INSUFFICIENT_PRIVILEGES_SUPERUSER_REQUIRED'
  | 'INSUFFICIENT_PRIVILEGES_DB_CREATE_MISSING'
  | 'INSUFFICIENT_PRIVILEGES_SCHEMA_CREATE_MISSING'
  | 'INSUFFICIENT_PRIVILEGES_SCHEMA_USAGE_MISSING';

export interface GistPreflightSnapshot {
  serverVersionNum: number;
  coreTstzrangeOverlapReady: boolean;
  extInstalled: boolean;
  extSchema: string | null;
  btreeGistUuidEqReady: boolean;
  extAvailable: boolean;
  aveSuperuser: boolean | null;
  aveTrusted: boolean | null;
  roleIsSuperuser: boolean;
  hasDbCreate: boolean;
  hasPublicCreate: boolean;
  hasPublicUsage: boolean;
}

export interface GistPreflightEvaluation {
  readyForMigration: boolean;
  status: GistPreflightStatus;
  reason: string;
}

/**
 * Authoritative read-only catalog query verifying:
 * 1. PostgreSQL server_version_num (14..18)
 * 2. Core GiST tstzrange / polymorphic anyrange overlap (&&, strategy 3, default opclass)
 * 3. Installed btree_gist UUID equality (=, strategy 3, default opclass, schema USAGE)
 * 4. Exact PostgreSQL CreateExtensionInternal / extension_is_trusted / LookupCreationNamespace("public")
 *    installability privileges for btree_gist (C language untrusted PL: requires superuser OR
 *    [ave.superuser = true AND ave.trusted = true AND DB CREATE AND public CREATE AND public USAGE]).
 */
export const GIST_PREFLIGHT_SQL = sql`
  SELECT
    current_setting('server_version_num')::int AS server_version_num,
    (
      EXISTS (SELECT 1 FROM pg_range WHERE rngtypid = 'tstzrange'::regtype)
      AND EXISTS (
        SELECT 1
        FROM pg_opclass oc
        JOIN pg_am am ON am.oid = oc.opcmethod
        JOIN pg_amop amop ON amop.amopfamily = oc.opcfamily
        JOIN pg_operator op ON op.oid = amop.amopopr
        WHERE am.amname = 'gist'
          AND oc.opcintype IN ('tstzrange'::regtype, 'anyrange'::regtype)
          AND oc.opcdefault = true
          AND op.oprname = '&&'
          AND amop.amoplefttype IN ('tstzrange'::regtype, 'anyrange'::regtype)
          AND amop.amoprighttype IN ('tstzrange'::regtype, 'anyrange'::regtype)
          AND amop.amopstrategy = 3
      )
    ) AS core_tstzrange_overlap_ready,
    EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') AS ext_installed,
    (
      SELECT n.nspname
      FROM pg_extension e
      JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE e.extname = 'btree_gist'
    ) AS ext_schema,
    EXISTS (
      SELECT 1
      FROM pg_opclass oc
      JOIN pg_am am ON am.oid = oc.opcmethod
      JOIN pg_namespace n ON n.oid = oc.opcnamespace
      JOIN pg_amop amop ON amop.amopfamily = oc.opcfamily
      JOIN pg_operator op ON op.oid = amop.amopopr
      WHERE am.amname = 'gist'
        AND oc.opcintype = 'uuid'::regtype
        AND oc.opcdefault = true
        AND op.oprname = '='
        AND amop.amoplefttype = 'uuid'::regtype
        AND amop.amoprighttype = 'uuid'::regtype
        AND amop.amopstrategy = 3
        AND has_schema_privilege(current_user, n.oid, 'USAGE')
    ) AS btree_gist_uuid_eq_ready,
    EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'btree_gist') AS ext_available,
    (
      SELECT ave.superuser
      FROM pg_available_extension_versions ave
      JOIN pg_available_extensions ae
        ON ae.name = ave.name
       AND ae.default_version = ave.version
      WHERE ave.name = 'btree_gist'
    ) AS ave_superuser,
    (
      SELECT ave.trusted
      FROM pg_available_extension_versions ave
      JOIN pg_available_extensions ae
        ON ae.name = ave.name
       AND ae.default_version = ave.version
      WHERE ave.name = 'btree_gist'
    ) AS ave_trusted,
    (SELECT rolsuper FROM pg_roles WHERE oid = current_user::regrole) AS role_is_superuser,
    has_database_privilege(current_user, current_database(), 'CREATE') AS has_db_create,
    has_schema_privilege(current_user, 'public', 'CREATE') AS has_public_create,
    has_schema_privilege(current_user, 'public', 'USAGE') AS has_public_usage
`;

/**
 * Pure deterministic evaluator for GiST + btree_gist readiness (C56 / C57 / C62 / C66 / CA-02).
 */
export function evaluateGistPreflightSnapshot(
  snapshot: GistPreflightSnapshot,
): GistPreflightEvaluation {
  if (
    !Number.isInteger(snapshot.serverVersionNum) ||
    snapshot.serverVersionNum < MIN_SUPPORTED_PG_VERSION_NUM ||
    snapshot.serverVersionNum > MAX_SUPPORTED_PG_VERSION_NUM
  ) {
    return {
      readyForMigration: false,
      status: 'UNSUPPORTED_PG_VERSION',
      reason: `PostgreSQL server_version_num ${snapshot.serverVersionNum} is outside supported range [${MIN_SUPPORTED_PG_VERSION_NUM}, ${MAX_SUPPORTED_PG_VERSION_NUM}].`,
    };
  }

  if (snapshot.coreTstzrangeOverlapReady !== true) {
    return {
      readyForMigration: false,
      status: 'CORE_TSTZRANGE_OVERLAP_MISSING',
      reason:
        'Core PostgreSQL GiST tstzrange overlap operator (&&, strategy 3, default opclass) is missing.',
    };
  }

  // Case 1: Extension is already installed in pg_extension
  if (snapshot.extInstalled === true) {
    if (snapshot.btreeGistUuidEqReady === true) {
      return {
        readyForMigration: true,
        status: 'INSTALLED_READY',
        reason:
          'btree_gist is installed with default GiST uuid equality operator (=, strategy 3) and schema USAGE.',
      };
    }

    // CREATE EXTENSION IF NOT EXISTS is a no-op when ext_installed = true; broken opclass or missing USAGE is a hard stop.
    return {
      readyForMigration: false,
      status: 'INSTALLED_BROKEN_OPCLASS',
      reason:
        'btree_gist is installed in pg_extension, but default GiST uuid equality operator (=, strategy 3) or schema USAGE is unavailable.',
    };
  }

  // Case 2: Extension is not yet installed; verify availability and exact installability for CREATE EXTENSION ... WITH SCHEMA "public"
  if (snapshot.extAvailable !== true) {
    return {
      readyForMigration: false,
      status: 'EXTENSION_NOT_AVAILABLE',
      reason: 'btree_gist is not present in pg_available_extensions.',
    };
  }

  if (snapshot.roleIsSuperuser === true) {
    return {
      readyForMigration: true,
      status: 'AVAILABLE_INSTALLABLE_BY_MIGRATION_ROLE',
      reason: 'Migration role is superuser and btree_gist is available for installation.',
    };
  }

  // btree_gist uses untrusted LANGUAGE C support functions: non-superuser requires switch_to_superuser
  // which only activates when ave.superuser = true AND ave.trusted = true.
  if (snapshot.aveSuperuser !== true || snapshot.aveTrusted !== true) {
    return {
      readyForMigration: false,
      status: 'INSUFFICIENT_PRIVILEGES_SUPERUSER_REQUIRED',
      reason:
        'Non-superuser role cannot install btree_gist unless control metadata has both superuser = true and trusted = true.',
    };
  }

  // extension_is_trusted() requires database CREATE privilege on current_database().
  // Schema privileges on public NEVER substitute for missing database CREATE (C66 / GF-04).
  if (snapshot.hasDbCreate !== true) {
    return {
      readyForMigration: false,
      status: 'INSUFFICIENT_PRIVILEGES_DB_CREATE_MISSING',
      reason:
        'Trusted extension installation requires CREATE privilege on current_database(), which is missing.',
    };
  }

  // LookupCreationNamespace("public") executes BEFORE switch_to_superuser in CreateExtensionInternal.
  if (snapshot.hasPublicCreate !== true) {
    return {
      readyForMigration: false,
      status: 'INSUFFICIENT_PRIVILEGES_SCHEMA_CREATE_MISSING',
      reason:
        'CREATE EXTENSION btree_gist WITH SCHEMA public requires CREATE privilege on schema public before superuser switch.',
    };
  }

  if (snapshot.hasPublicUsage !== true) {
    return {
      readyForMigration: false,
      status: 'INSUFFICIENT_PRIVILEGES_SCHEMA_USAGE_MISSING',
      reason:
        'Post-install GiST exclusion constraint resolution requires USAGE privilege on schema public.',
    };
  }

  return {
    readyForMigration: true,
    status: 'AVAILABLE_INSTALLABLE_BY_MIGRATION_ROLE',
    reason:
      'btree_gist is available as a trusted extension and migration role holds database CREATE plus public CREATE/USAGE.',
  };
}

export async function runLiveGistPreflight(
  dbInstance: AppDatabase,
): Promise<{ snapshot: GistPreflightSnapshot; evaluation: GistPreflightEvaluation }> {
  const result = await dbInstance.execute(GIST_PREFLIGHT_SQL);
  const row = (result.rows[0] ?? {}) as Record<string, unknown>;

  const snapshot: GistPreflightSnapshot = {
    serverVersionNum: Number(row.server_version_num ?? 0),
    coreTstzrangeOverlapReady: Boolean(row.core_tstzrange_overlap_ready),
    extInstalled: Boolean(row.ext_installed),
    extSchema: typeof row.ext_schema === 'string' ? row.ext_schema : null,
    btreeGistUuidEqReady: Boolean(row.btree_gist_uuid_eq_ready),
    extAvailable: Boolean(row.ext_available),
    aveSuperuser: typeof row.ave_superuser === 'boolean' ? row.ave_superuser : null,
    aveTrusted: typeof row.ave_trusted === 'boolean' ? row.ave_trusted : null,
    roleIsSuperuser: Boolean(row.role_is_superuser),
    hasDbCreate: Boolean(row.has_db_create),
    hasPublicCreate: Boolean(row.has_public_create),
    hasPublicUsage: Boolean(row.has_public_usage),
  };

  return {
    snapshot,
    evaluation: evaluateGistPreflightSnapshot(snapshot),
  };
}
