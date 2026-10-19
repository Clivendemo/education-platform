import { db } from '../src/db/index.js';
import { sql } from 'drizzle-orm';

async function checkDb() {
  const types = await db.execute(sql`SELECT id, name, event_code, status FROM analytics.analytics_event_types ORDER BY event_code;`);
  console.log('Event types count:', types.rows.length);
  console.log('Event types:', types.rows.map(r => `${r.event_code} (${r.status})`));

  const perms = await db.execute(sql`SELECT name, description FROM identity.permissions WHERE name LIKE 'analytics.%';`);
  console.log('Analytics permissions:', perms.rows);

  const constraints = await db.execute(sql`
    SELECT conname, pg_get_constraintdef(c.oid)
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'analytics';
  `);
  console.log('Analytics constraints count:', constraints.rows.length);
  constraints.rows.forEach(c => console.log(' -', c.conname, ':', c.pg_get_constraintdef));

  const indices = await db.execute(sql`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'analytics';
  `);
  console.log('Analytics indices count:', indices.rows.length);
  indices.rows.forEach(i => console.log(' -', i.indexname, ':', i.indexdef));
}

checkDb().catch(console.error).finally(() => process.exit(0));
