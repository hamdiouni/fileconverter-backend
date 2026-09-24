import { buildApp } from './app';
import { getEnv } from './config/env';

const start = async () => {
  const app = await buildApp({ logger: true });
  const env = getEnv();
  await app.listen({ port: env.PORT, host: '0.0.0.0' });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Received shutdown signal, closing server gracefully...');
    try {
      await app.close();
      app.log.info('Conversion orchestrator closed cleanly');
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

start().catch(console.error);
