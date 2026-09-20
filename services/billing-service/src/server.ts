import { buildApp } from './app';
import { getEnv } from './config/env';

// In production, the real Stripe SDK would be imported here
// For now we just provide a stub; replace with real Stripe client in production
const productionStripe = {
  checkout: {
    sessions: {
      create: async (_params: any): Promise<any> => {
        throw new Error('Real Stripe SDK not configured. Set STRIPE_SECRET_KEY and import stripe SDK.');
      },
    },
  },
  billingPortal: {
    sessions: {
      create: async (_params: any): Promise<any> => {
        throw new Error('Real Stripe SDK not configured. Set STRIPE_SECRET_KEY and import stripe SDK.');
      },
    },
  },
  webhooks: {
    constructEvent: (_body: string, _sig: string, _secret: string): any => {
      throw new Error('Real Stripe SDK not configured.');
    },
  },
};

const start = async () => {
  const app = await buildApp({ logger: true, stripe: productionStripe });
  await app.listen({ port: getEnv().PORT, host: '0.0.0.0' });
};

start().catch(console.error);
