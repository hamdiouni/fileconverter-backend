import { buildApp } from './app';
import { getEnv } from './config/env';
import { AuthService } from './services/auth.service';

async function main(): Promise<void> {
  const env = getEnv();
  const app = await buildApp({ logger: true });

  try {
    if (env.ADMIN_EMAIL && env.ADMIN_PASSWORD) {
      const authService = new AuthService(app.prisma, app.redis);
      await authService.bootstrapAdmin(env.ADMIN_EMAIL, env.ADMIN_PASSWORD);
      console.log(`Admin user bootstrap checked for ${env.ADMIN_EMAIL}`);
    }

    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    console.log(`Auth service running on port ${env.PORT}`);

    const shutdown = async (signal: string) => {
      app.log.info({ signal }, 'Received shutdown signal, closing server gracefully...');
      try {
        await app.close();
        app.log.info('Auth service closed cleanly');
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

main().catch(console.error);
