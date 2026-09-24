import Stripe from 'stripe';
import { buildApp } from './app';
import { getEnv } from './config/env';

const env = getEnv();

const stripeClient = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16' as any,
  typescript: true,
});

const start = async () => {
  const app = await buildApp({ logger: true, stripe: stripeClient as any });
  await app.listen({ port: env.PORT, host: '0.0.0.0' });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Received shutdown signal, closing server gracefully...');
    try {
      await app.close();
      app.log.info('Billing service closed cleanly');
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

