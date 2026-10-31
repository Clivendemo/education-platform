import { buildApp } from './app.js';
import { env } from './config/env.js';
import { checkDatabaseHealth, closeDatabase } from './db/index.js';
import { defaultNotificationService } from './services/notification.service.js';
import { defaultRecommendationCacheService } from './services/recommendations/recommendation-cache.service.js';
import { defaultMpesaReconciliationWorker } from './services/commerce/mpesa/mpesa-reconciliation.worker.js';
import { defaultFileProcessingWorker } from './services/file-processing.worker.js';

const app = buildApp({
  logger: {
    level: env.LOG_LEVEL,
    redact: [
      'req.headers.cookie',
      'req.headers.authorization',
      '*.password',
      '*.currentPassword',
      '*.newPassword',
      '*.token',
      '*.sessionToken',
      '*.token_hash',
      '*.tokenHash',
      '*.checkoutRequestId',
      '*.phoneNumber',
      '*.initiatedPhoneHash',
    ],
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

    // In the container runtime, port 8080 is reserved by nginx / control-plane-api.
    // The dev server and application must run on port 3000.
    const port = env.PORT === 8080 ? 3000 : env.PORT;

    await app.listen({
      port,
      host: env.HOST,
    });
    if (env.NODE_ENV === 'production' || process.env.ENABLE_NOTIFICATION_WORKER === 'true') {
      defaultNotificationService.startWorker();
      app.log.info('Notifications outbox background worker active');
    }
    if (env.DATABASE_URL) {
      await defaultRecommendationCacheService.startListener();
      app.log.info('Recommendation cache LISTEN/NOTIFY subscriber active');

      if (env.MPESA_ENABLED) {
        defaultMpesaReconciliationWorker.start();
        app.log.info('M-Pesa reconciliation background worker active');
      }

      defaultFileProcessingWorker.start();
      app.log.info('File quarantine & malware scan background worker active');
    }
    app.log.info(`Server running at http://${env.HOST}:${port}`);
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
      defaultMpesaReconciliationWorker.stop();
      defaultFileProcessingWorker.stop();
      await defaultRecommendationCacheService.stopListener();
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
