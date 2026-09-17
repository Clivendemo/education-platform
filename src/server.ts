import { buildApp } from './app.js';
import { env } from './config/env.js';

const app = buildApp({
  logger: {
    level: env.LOG_LEVEL,
  },
});

async function startServer(): Promise<void> {
  try {
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
      app.log.info('Server closed successfully.');
      process.exit(0);
    } catch (err) {
      app.log.error(err, 'Error during server shutdown');
      process.exit(1);
    }
  });
}

startServer();
