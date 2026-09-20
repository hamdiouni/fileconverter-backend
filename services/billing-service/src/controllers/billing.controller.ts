import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { BillingService } from '../services/billing.service';

const checkoutSchema = z.object({
  priceId: z.string().min(1),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

const portalSchema = z.object({
  returnUrl: z.string().url(),
});

export class BillingController {
  constructor(private service: BillingService) {}

  createCheckoutSession = async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = checkoutSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message },
      });
    }
    try {
      const result = await this.service.createCheckoutSession(
        request.user!.userId,
        parsed.data.priceId,
        parsed.data.successUrl,
        parsed.data.cancelUrl,
      );
      return reply.status(200).send(result);
    } catch (err: any) {
      if (err.statusCode === 400) {
        return reply.status(400).send({ error: { code: err.code, message: err.message } });
      }
      throw err;
    }
  };

  createPortalSession = async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = portalSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'returnUrl is required and must be a valid URL' },
      });
    }
    const result = await this.service.createPortalSession(
      request.user!.userId,
      parsed.data.returnUrl,
    );
    return reply.status(200).send(result);
  };

  handleWebhook = async (request: FastifyRequest, reply: FastifyReply) => {
    const sig = (request.headers['stripe-signature'] as string) ?? '';
    try {
      await this.service.handleWebhook(JSON.stringify(request.body), sig);
      return reply.status(200).send({ received: true });
    } catch (err: any) {
      if (err.statusCode === 400) {
        return reply.status(400).send({ error: { code: err.code, message: err.message } });
      }
      throw err;
    }
  };

  getUsageSummary = async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await this.service.getUsageSummary(request.user!.userId);
    return reply.status(200).send(result);
  };
}
