import { describe, it, expect, afterAll } from 'vitest';
import { envSchema } from '../../src/config/env.js';
import * as schemas from '../../src/db/schemas.js';
import { checkDatabaseHealth, closeDatabase } from '../../src/db/index.js';

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
        DATABASE_URL: 'postgresql://postgres:secret@db.production.internal:5432/education_platform?sslmode=disable',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issues = result.error.issues;
        expect(issues.some((i) => i.message.includes('unencrypted or insecure sslmode'))).toBe(true);
      }
    });

    it('accepts production DATABASE_URL with sslmode=require', () => {
      const result = envSchema.safeParse({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://postgres:secret@db.production.internal:5432/education_platform?sslmode=require',
      });
      expect(result.success).toBe(true);
    });

    it('accepts production DATABASE_URL with sslmode=verify-full', () => {
      const result = envSchema.safeParse({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://postgres:secret@db.production.internal:5432/education_platform?sslmode=verify-full',
      });
      expect(result.success).toBe(true);
    });

    it('accepts production DATABASE_URL with sslmode=verify-ca', () => {
      const result = envSchema.safeParse({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://postgres:secret@db.production.internal:5432/education_platform?sslmode=verify-ca',
      });
      expect(result.success).toBe(true);
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
      // In local dev without DATABASE_URL, this returns cleanly with status unhealthy
      if (!process.env.DATABASE_URL) {
        expect(health.status).toBe('unhealthy');
        expect(health.error).toBeDefined();
      }
    });
  });
});
