import { describe, it, expect, afterAll } from 'vitest';
import { envSchema } from '../../src/config/env.js';
import * as schemas from '../../src/db/schemas.js';
import { checkDatabaseHealth, closeDatabase } from '../../src/db/index.js';

const validProdSecurityBaseline = {
  CANONICAL_DOMAIN: 'https://elimupin.co.ke',
  CORS_ALLOWED_ORIGINS: 'https://elimupin.co.ke,https://app.elimupin.co.ke',
  CSRF_SECRET: 'prod-csrf-secret-value-at-least-32-chars-long-0001',
  RATE_LIMIT_HMAC_SECRET: 'prod-rate-limit-hmac-secret-at-least-32-chars-01',
  TRUST_PROXY_HOPS: 1,
  ALLOW_PAYMENT_SIMULATION: 'false',
  R2_ACCOUNT_ID: 'prod-r2-account',
  R2_ACCESS_KEY_ID: 'prod-r2-key',
  R2_SECRET_ACCESS_KEY: 'prod-r2-secret',
  R2_BUCKET_NAME: 'kenya-education-prod-files',
  MALWARE_SCANNER_MODE: 'CLAMD',
  CLAMD_HOST: 'clamav.internal',
};

describe('PostgreSQL Foundation Configuration & Schemas', () => {
  afterAll(async () => {
    await closeDatabase();
  });

  describe('Environment Validation (envSchema)', () => {
    it('allows DATABASE_URL to be optional in development', () => {
      const result = envSchema.safeParse({
        NODE_ENV: 'development',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.DATABASE_URL).toBeUndefined();
        expect(result.data.DATABASE_POOL_MIN).toBe(2);
        expect(result.data.DATABASE_POOL_MAX).toBe(10);
        expect(result.data.ALLOW_PAYMENT_SIMULATION).toBe(false);
        expect(result.data.MPESA_ENABLE_LEGACY_CALLBACK_ALIAS).toBe(false);
      }
    });

    it('allows DATABASE_URL to be optional in test environment', () => {
      const result = envSchema.safeParse({
        NODE_ENV: 'test',
      });
      expect(result.success).toBe(true);
    });

    it('requires DATABASE_URL in production', () => {
      const result = envSchema.safeParse({
        NODE_ENV: 'production',
        ...validProdSecurityBaseline,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issues = result.error.issues;
        expect(issues.some((i) => i.message.includes('DATABASE_URL is strictly required'))).toBe(true);
      }
    });

    it('rejects production DATABASE_URL without sslmode parameter', () => {
      const result = envSchema.safeParse({
        NODE_ENV: 'production',
        ...validProdSecurityBaseline,
        DATABASE_URL: 'postgresql://postgres:secret@db.production.internal:5432/education_platform',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issues = result.error.issues;
        expect(issues.some((i) => i.message.includes('must explicitly specify an sslmode parameter'))).toBe(true);
      }
    });

    it('rejects production DATABASE_URL with insecure sslmode=disable', () => {
      const result = envSchema.safeParse({
        NODE_ENV: 'production',
        ...validProdSecurityBaseline,
        DATABASE_URL: 'postgresql://postgres:secret@db.production.internal:5432/education_platform?sslmode=disable',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issues = result.error.issues;
        expect(issues.some((i) => i.message.includes('unencrypted or insecure sslmode'))).toBe(true);
      }
    });

    it('accepts production DATABASE_URL with sslmode=require and complete security baseline', () => {
      const result = envSchema.safeParse({
        NODE_ENV: 'production',
        ...validProdSecurityBaseline,
        DATABASE_URL: 'postgresql://postgres:secret@db.production.internal:5432/education_platform?sslmode=require',
      });
      expect(result.success).toBe(true);
    });

    it('accepts production DATABASE_URL with sslmode=verify-full and complete security baseline', () => {
      const result = envSchema.safeParse({
        NODE_ENV: 'production',
        ...validProdSecurityBaseline,
        DATABASE_URL: 'postgresql://postgres:secret@db.production.internal:5432/education_platform?sslmode=verify-full',
      });
      expect(result.success).toBe(true);
    });

    it('accepts production DATABASE_URL with sslmode=verify-ca and complete security baseline', () => {
      const result = envSchema.safeParse({
        NODE_ENV: 'production',
        ...validProdSecurityBaseline,
        DATABASE_URL: 'postgresql://postgres:secret@db.production.internal:5432/education_platform?sslmode=verify-ca',
      });
      expect(result.success).toBe(true);
    });

    it('fails fast in production if ALLOW_PAYMENT_SIMULATION=true (W1-AC-03)', () => {
      const result = envSchema.safeParse({
        NODE_ENV: 'production',
        ...validProdSecurityBaseline,
        ALLOW_PAYMENT_SIMULATION: 'true',
        DATABASE_URL: 'postgresql://postgres:secret@db.production.internal:5432/education_platform?sslmode=require',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) => i.path.includes('ALLOW_PAYMENT_SIMULATION')),
        ).toBe(true);
      }
    });

    it('fails fast in production when TRUST_PROXY_HOPS, R2 credentials, or CLAMD scanner are missing (W1-AC-08 / W1-AC-09)', () => {
      const result = envSchema.safeParse({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://postgres:secret@db.production.internal:5432/education_platform?sslmode=require',
        MALWARE_SCANNER_MODE: 'STUB_CLEAN',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.flatMap((i) => i.path.map(String));
        expect(paths).toContain('TRUST_PROXY_HOPS');
        expect(paths).toContain('R2_ACCOUNT_ID');
        expect(paths).toContain('MALWARE_SCANNER_MODE');
        expect(paths).toContain('CORS_ALLOWED_ORIGINS');
        expect(paths).toContain('CSRF_SECRET');
        expect(paths).toContain('RATE_LIMIT_HMAC_SECRET');
      }
    });

    it('fails fast in production when CORS_ALLOWED_ORIGINS contains wildcard or http:// or dev placeholder secrets are reused (Wave 3 WP3/WP4)', () => {
      const badProd = envSchema.safeParse({
        NODE_ENV: 'production',
        ...validProdSecurityBaseline,
        CORS_ALLOWED_ORIGINS: '*,http://insecure.elimupin.co.ke',
        CSRF_SECRET: 'dev-only-csrf-secret-key-at-least-32-bytes-long-0000',
        RATE_LIMIT_HMAC_SECRET: 'dev-only-rate-limit-hmac-key-at-least-32-bytes-0000',
        DATABASE_URL: 'postgresql://postgres:secret@db.production.internal:5432/education_platform?sslmode=require',
      });
      expect(badProd.success).toBe(false);
      if (!badProd.success) {
        const paths = badProd.error.issues.flatMap((i) => i.path.map(String));
        expect(paths).toContain('CORS_ALLOWED_ORIGINS');
        expect(paths).toContain('CSRF_SECRET');
        expect(paths).toContain('RATE_LIMIT_HMAC_SECRET');
      }
    });

    it('enforces cross-field validation: DATABASE_POOL_MIN <= DATABASE_POOL_MAX', () => {
      const result = envSchema.safeParse({
        NODE_ENV: 'development',
        DATABASE_POOL_MIN: 20,
        DATABASE_POOL_MAX: 5,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issues = result.error.issues;
        expect(issues.some((i) => i.message.includes('DATABASE_POOL_MIN must be less than or equal to DATABASE_POOL_MAX'))).toBe(true);
      }
    });
  });

  describe('Logical PostgreSQL Schemas Export', () => {
    it('exports all 11 logical PostgreSQL schemas defined in DATABASE_SPEC.md', () => {
      const expectedSchemas = [
        'platform',
        'taxonomy',
        'content',
        'files',
        'commerce',
        'identity',
        'community',
        'calendar',
        'analytics',
        'governance',
        'system',
      ];

      for (const schemaName of expectedSchemas) {
        const schemaKey = `${schemaName}Schema` as keyof typeof schemas;
        const schemaObj = schemas[schemaKey] as { schemaName: string };
        expect(schemaObj).toBeDefined();
        expect(schemaObj.schemaName).toBe(schemaName);
      }
    });
  });

  describe('Database Health Check (checkDatabaseHealth)', () => {
    it('returns an unhealthy status without throwing if DATABASE_URL is not configured', async () => {
      const health = await checkDatabaseHealth();
      if (!process.env.DATABASE_URL) {
        expect(health.status).toBe('unhealthy');
        expect(health.error).toBeDefined();
      } else {
        expect(['healthy', 'unhealthy']).toContain(health.status);
      }
    });
  });
});
