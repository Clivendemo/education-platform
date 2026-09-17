import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';

export function buildTestApp(): FastifyInstance {
  return buildApp({
    logger: false,
  });
}
