import { pgSchema } from 'drizzle-orm/pg-core';

/**
 * 11 Logical PostgreSQL Schemas defined in DATABASE_SPEC.md Section 4
 */
export const platformSchema = pgSchema('platform');
export const taxonomySchema = pgSchema('taxonomy');
export const contentSchema = pgSchema('content');
export const filesSchema = pgSchema('files');
export const commerceSchema = pgSchema('commerce');
export const identitySchema = pgSchema('identity');
export const communitySchema = pgSchema('community');
export const calendarSchema = pgSchema('calendar');
export const analyticsSchema = pgSchema('analytics');
export const governanceSchema = pgSchema('governance');
export const systemSchema = pgSchema('system');
