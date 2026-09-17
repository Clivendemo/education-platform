import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from '../helpers/build-test-app.js';

describe('Fastify Project Foundation & Health Route', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('initializes Fastify application successfully', () => {
    expect(app).toBeDefined();
    expect(typeof app.inject).toBe('function');
  });

  describe('GET /api/v1/health', () => {
    it('returns HTTP 200 with standard data envelope and dynamic ISO-8601 timestamp', async () => {
      const beforeRequest = Date.now();
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/health',
      });
      const afterRequest = Date.now();

      expect(response.statusCode).toBe(200);

      const json = response.json();
      expect(json).toHaveProperty('data');
      expect(json.data).toHaveProperty('status', 'ok');
      expect(json.data).toHaveProperty('timestamp');
      expect(typeof json.data.timestamp).toBe('string');

      // Verify ISO-8601 validity
      const parsedTime = Date.parse(json.data.timestamp);
      expect(Number.isNaN(parsedTime)).toBe(false);

      // Verify dynamic generation at request time
      expect(parsedTime).toBeGreaterThanOrEqual(beforeRequest - 1000);
      expect(parsedTime).toBeLessThanOrEqual(afterRequest + 1000);
    });

    it('propagates a valid supplied x-request-id in response headers', async () => {
      const validCustomId = 'custom-trace-id-abc_123';
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/health',
        headers: {
          'x-request-id': validCustomId,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['x-request-id']).toBe(validCustomId);
    });

    it('generates a cryptographically secure UUID when no x-request-id is supplied', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/health',
      });

      expect(response.statusCode).toBe(200);
      const generatedId = response.headers['x-request-id'];
      expect(typeof generatedId).toBe('string');
      // UUID format validation: 8-4-4-4-12 hex characters
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(uuidRegex.test(generatedId as string)).toBe(true);
    });

    it('ignores malformed x-request-id and generates a new safe UUID without rejecting request', async () => {
      const malformedId = 'invalid#id$with%disallowed*chars!';
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/health',
        headers: {
          'x-request-id': malformedId,
        },
      });

      expect(response.statusCode).toBe(200);
      const generatedId = response.headers['x-request-id'];
      expect(generatedId).not.toBe(malformedId);
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(uuidRegex.test(generatedId as string)).toBe(true);
    });

    it('ignores excessively long (>64 chars) x-request-id and generates a new safe UUID', async () => {
      const longId = 'a'.repeat(65);
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/health',
        headers: {
          'x-request-id': longId,
        },
      });

      expect(response.statusCode).toBe(200);
      const generatedId = response.headers['x-request-id'];
      expect(generatedId).not.toBe(longId);
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(uuidRegex.test(generatedId as string)).toBe(true);
    });
  });

  describe('Standardized Error Handling & 404', () => {
    it('returns standardized 404 error envelope without leaking stack traces or internal paths', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/nonexistent-route-for-testing',
      });

      expect(response.statusCode).toBe(404);
      const json = response.json();

      expect(json).toHaveProperty('error');
      expect(json.error).toHaveProperty('code', 'NOT_FOUND');
      expect(json.error).toHaveProperty('message');
      expect(json.error).toHaveProperty('requestId');
      expect(typeof json.error.requestId).toBe('string');

      // Security check: strictly no stack traces or filesystem paths
      expect(json).not.toHaveProperty('stack');
      expect(json.error).not.toHaveProperty('stack');
      expect(JSON.stringify(json)).not.toContain('/app/applet');
      expect(JSON.stringify(json)).not.toContain('node_modules');
    });
  });
});
