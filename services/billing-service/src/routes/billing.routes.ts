import type { FastifyInstance } from 'fastify';
import { BillingController } from '../controllers/billing.controller';
import { BillingService } from '../services/billing.service';
import { authenticate } from '../middleware/authenticate';

export async function billingRoutes(fastify: FastifyInstance) {
  const stripe = (fastify as any).stripe;
  if (!stripe) {
    throw new Error('Stripe client not registered. Use fastify.decorate("stripe", ...) before registering billingRoutes.');
  }
  const service = new BillingService(fastify.prisma, fastify.redis, stripe);
  const controller = new BillingController(service);

  fastify.post(
    '/api/v1/billing/checkout-session',
    { preHandler: authenticate },
    controller.createCheckoutSession,
  );
  fastify.post(
    '/api/v1/billing/portal-session',
    { preHandler: authenticate },
    controller.createPortalSession,
  );
  fastify.post(
    '/api/v1/billing/portal',
    { preHandler: authenticate },
    controller.createPortalSession,
  );
  fastify.post('/api/v1/billing/webhook', controller.handleWebhook);
  fastify.get(
    '/api/v1/billing/usage',
    { preHandler: authenticate },
    controller.getUsageSummary,
  );
}
