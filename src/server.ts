import { buildApp } from './app.js';
import { env } from './config/env.js';
import { checkDatabaseHealth, closeDatabase } from './db/index.js';

const app = buildApp({
  logger: {
    level: env.LOG_LEVEL,
  },
});

async function startServer(): Promise<void> {
  try {
    // Check database connectivity if configured or if in production
    if (env.NODE_ENV === 'production') {
      const dbHealth = await checkDatabaseHealth();
      if (dbHealth.status !== 'healthy') {
        app.log.fatal({ error: dbHealth.error }, 'Database readiness check failed in production');
        process.exit(1);
      }
      app.log.info({ latencyMs: dbHealth.latencyMs }, 'Database connection verified');
    } else if (env.DATABASE_URL) {
      const dbHealth = await checkDatabaseHealth();
      if (dbHealth.status === 'healthy') {
        app.log.info({ latencyMs: dbHealth.latencyMs }, 'Database connection verified');
      } else {
        app.log.warn({ error: dbHealth.error }, 'Database not reachable in development; continuing server start');
      }
    } else {
      app.log.info('DATABASE_URL not configured; running in standalone mode');
    }

    await app.listen({
      port: env.PORT,
      host: env.HOST,
    });
    app.log.info(`Server running at http://${env.HOST}:${env.PORT}`);
  } catch (err) {
    app.log.fatal(err, 'Failed to start server');
    process.exit(1);
  }
}

// Graceful shutdown handling
const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
for (const signal of signals) {
  process.on(signal, async () => {
    app.log.info(`Received ${signal}, shutting down gracefully...`);
    try {
      await app.close();
      await closeDatabase();
      app.log.info('Server and database pool closed successfully.');
      process.exit(0);
    } catch (err) {
      app.log.error(err, 'Error during server shutdown');
      process.exit(1);
    }
  });
}

startServer();
