import { describe, it, expect } from 'vitest';
import {
  evaluateGistPreflightSnapshot,
  MAX_SUPPORTED_PG_VERSION_NUM,
  MIN_SUPPORTED_PG_VERSION_NUM,
  type GistPreflightSnapshot,
} from '../../src/services/homepage-gist-preflight.js';

function makeBaseInstallableSnapshot(
  overrides: Partial<GistPreflightSnapshot> = {},
): GistPreflightSnapshot {
  return {
    serverVersionNum: 180006,
    coreTstzrangeOverlapReady: true,
    extInstalled: false,
    extSchema: null,
    btreeGistUuidEqReady: false,
    extAvailable: true,
    aveSuperuser: true,
    aveTrusted: true,
    roleIsSuperuser: false,
    hasDbCreate: true,
    hasPublicCreate: true,
    hasPublicUsage: true,
    ...overrides,
  };
}

describe('Homepage GiST & btree_gist Readiness Preflight (C56 / C57 / C62 / C66)', () => {
  it('GF-01: approves INSTALLED_READY when btree_gist and strategy-3 uuid/tstzrange operators are ready', () => {
    const res18 = evaluateGistPreflightSnapshot(
      makeBaseInstallableSnapshot({
        serverVersionNum: 180006,
        extInstalled: true,
        extSchema: 'public',
        btreeGistUuidEqReady: true,
      }),
    );
    expect(res18.readyForMigration).toBe(true);
    expect(res18.status).toBe('INSTALLED_READY');

    const res16 = evaluateGistPreflightSnapshot(
      makeBaseInstallableSnapshot({
        serverVersionNum: 160004,
        extInstalled: true,
        extSchema: 'extensions',
        btreeGistUuidEqReady: true,
      }),
    );
    expect(res16.readyForMigration).toBe(true);
    expect(res16.status).toBe('INSTALLED_READY');
  });

  it('GF-02: approves AVAILABLE_INSTALLABLE_BY_MIGRATION_ROLE for non-superuser with trusted extension + DB CREATE + public CREATE/USAGE', () => {
    const res = evaluateGistPreflightSnapshot(makeBaseInstallableSnapshot());
    expect(res.readyForMigration).toBe(true);
    expect(res.status).toBe('AVAILABLE_INSTALLABLE_BY_MIGRATION_ROLE');
  });

  it('GF-03: approves AVAILABLE_INSTALLABLE_BY_MIGRATION_ROLE for superuser even when aveTrusted is false', () => {
    const res = evaluateGistPreflightSnapshot(
      makeBaseInstallableSnapshot({
        roleIsSuperuser: true,
        aveTrusted: false,
        hasDbCreate: false,
        hasPublicCreate: false,
      }),
    );
    expect(res.readyForMigration).toBe(true);
    expect(res.status).toBe('AVAILABLE_INSTALLABLE_BY_MIGRATION_ROLE');
  });

  it('GF-04 (C66): rejects when schema public CREATE and USAGE are present but database CREATE privilege is missing', () => {
    const res = evaluateGistPreflightSnapshot(
      makeBaseInstallableSnapshot({
        roleIsSuperuser: false,
        aveSuperuser: true,
        aveTrusted: true,
        hasDbCreate: false,
        hasPublicCreate: true,
        hasPublicUsage: true,
      }),
    );
    expect(res.readyForMigration).toBe(false);
    expect(res.status).toBe('INSUFFICIENT_PRIVILEGES_DB_CREATE_MISSING');
  });

  it('GF-05: rejects when database CREATE is present but schema public CREATE is missing', () => {
    const res = evaluateGistPreflightSnapshot(
      makeBaseInstallableSnapshot({
        hasDbCreate: true,
        hasPublicCreate: false,
        hasPublicUsage: true,
      }),
    );
    expect(res.readyForMigration).toBe(false);
    expect(res.status).toBe('INSUFFICIENT_PRIVILEGES_SCHEMA_CREATE_MISSING');
  });

  it('GF-06: rejects when database CREATE and public CREATE are present but public USAGE is missing', () => {
    const res = evaluateGistPreflightSnapshot(
      makeBaseInstallableSnapshot({
        hasDbCreate: true,
        hasPublicCreate: true,
        hasPublicUsage: false,
      }),
    );
    expect(res.readyForMigration).toBe(false);
    expect(res.status).toBe('INSUFFICIENT_PRIVILEGES_SCHEMA_USAGE_MISSING');
  });

  it('GF-07: rejects non-superuser when btree_gist control metadata is not trusted or lacks superuser switch', () => {
    const untrusted = evaluateGistPreflightSnapshot(
      makeBaseInstallableSnapshot({ aveTrusted: false }),
    );
    expect(untrusted.readyForMigration).toBe(false);
    expect(untrusted.status).toBe('INSUFFICIENT_PRIVILEGES_SUPERUSER_REQUIRED');

    const noSuperSwitch = evaluateGistPreflightSnapshot(
      makeBaseInstallableSnapshot({ aveSuperuser: false }),
    );
    expect(noSuperSwitch.readyForMigration).toBe(false);
    expect(noSuperSwitch.status).toBe('INSUFFICIENT_PRIVILEGES_SUPERUSER_REQUIRED');
  });

  it('GF-08: rejects when btree_gist is absent from pg_available_extensions', () => {
    const res = evaluateGistPreflightSnapshot(
      makeBaseInstallableSnapshot({ extAvailable: false }),
    );
    expect(res.readyForMigration).toBe(false);
    expect(res.status).toBe('EXTENSION_NOT_AVAILABLE');
  });

  it('GF-09: rejects INSTALLED_BROKEN_OPCLASS when extInstalled is true but strategy-3 uuid = opclass or schema USAGE is missing', () => {
    const res = evaluateGistPreflightSnapshot(
      makeBaseInstallableSnapshot({
        extInstalled: true,
        extSchema: 'restricted_ext',
        btreeGistUuidEqReady: false,
      }),
    );
    expect(res.readyForMigration).toBe(false);
    expect(res.status).toBe('INSTALLED_BROKEN_OPCLASS');
  });

  it('GF-10 (C62): rejects CORE_TSTZRANGE_OVERLAP_MISSING when core strategy-3 range overlap is absent', () => {
    const res = evaluateGistPreflightSnapshot(
      makeBaseInstallableSnapshot({ coreTstzrangeOverlapReady: false }),
    );
    expect(res.readyForMigration).toBe(false);
    expect(res.status).toBe('CORE_TSTZRANGE_OVERLAP_MISSING');
  });

  it('GF-11 / GF-12: enforces PostgreSQL server_version_num bounds', () => {
    const tooOld = evaluateGistPreflightSnapshot(
      makeBaseInstallableSnapshot({
        serverVersionNum: MIN_SUPPORTED_PG_VERSION_NUM - 1,
      }),
    );
    expect(tooOld.readyForMigration).toBe(false);
    expect(tooOld.status).toBe('UNSUPPORTED_PG_VERSION');

    const tooNew = evaluateGistPreflightSnapshot(
      makeBaseInstallableSnapshot({
        serverVersionNum: MAX_SUPPORTED_PG_VERSION_NUM + 1,
      }),
    );
    expect(tooNew.readyForMigration).toBe(false);
    expect(tooNew.status).toBe('UNSUPPORTED_PG_VERSION');
  });
});
