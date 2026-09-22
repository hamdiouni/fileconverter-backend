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
};

start().catch(console.error);

