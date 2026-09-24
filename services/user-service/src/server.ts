import { buildApp } from './app';
import { getEnv } from './config/env';

async function start() {
  const env = getEnv();
  const app = await buildApp({ logger: true });
  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });

    const shutdown = async (signal: string) => {
      app.log.info({ signal }, 'Received shutdown signal, closing server gracefully...');
      try {
        await app.close();
        app.log.info('User service closed cleanly');
        process.exit(0);
      } catch (err) {
        app.log.error({ err }, 'Error during shutdown');
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
