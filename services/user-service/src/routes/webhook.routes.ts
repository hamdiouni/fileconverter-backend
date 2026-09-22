import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import crypto from 'crypto';
import { authenticate } from '../middleware/authenticate';

const createWebhookSchema = z.object({
  url: z.string().url('Enter a valid URL'),
  events: z.array(z.string()).min(1, 'Select at least one event'),
});

export async function webhookRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/v1/webhooks — list webhooks for current user
  fastify.get('/api/v1/webhooks', { preHandler: authenticate }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.user!.userId;
    const endpoints = await (fastify.prisma as any).webhookEndpoint.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    const result = await Promise.all(
      endpoints.map(async (ep: any) => {
        const lastDelivery = await (fastify.prisma as any).webhookDelivery.findFirst({
          where: { webhookUrl: ep.url },
          orderBy: { createdAt: 'desc' },
        });

        return {
          id: ep.id,
          url: ep.url,
          events: ep.events,
          active: ep.active,
          createdAt: ep.createdAt.toISOString(),
          lastDeliveryAt: lastDelivery?.deliveredAt ? lastDelivery.deliveredAt.toISOString() : (lastDelivery?.createdAt?.toISOString() ?? null),
          lastStatus: lastDelivery ? (lastDelivery.status === 'success' || lastDelivery.status === 'delivered' ? 'success' : 'failed') : null,
        };
      }),
    );

    return reply.status(200).send(result);
  });

  // POST /api/v1/webhooks — create a new webhook endpoint
  fastify.post('/api/v1/webhooks', { preHandler: authenticate }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.user!.userId;
    const parsed = createWebhookSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message ?? 'Invalid input', details: parsed.error.errors },
      });
    }

    const { url, events } = parsed.data;
    const secret = 'whsec_' + crypto.randomBytes(24).toString('hex');

    const endpoint = await (fastify.prisma as any).webhookEndpoint.create({
      data: {
        userId,
        url,
        secret,
        events,
        active: true,
      },
    });

    return reply.status(201).send({
      id: endpoint.id,
      url: endpoint.url,
      events: endpoint.events,
      active: endpoint.active,
      secret: endpoint.secret,
      createdAt: endpoint.createdAt.toISOString(),
      lastDeliveryAt: null,
      lastStatus: null,
    });
  });

  // DELETE /api/v1/webhooks/:id — delete a webhook endpoint
  fastify.delete<{ Params: { id: string } }>(
    '/api/v1/webhooks/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      const userId = request.user!.userId;
      const { id } = request.params;

      const endpoint = await (fastify.prisma as any).webhookEndpoint.findFirst({
        where: { id, userId },
      });

      if (!endpoint) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: `Webhook endpoint ${id} not found` },
        });
      }

      await (fastify.prisma as any).webhookEndpoint.delete({
        where: { id },
      });

      return reply.status(204).send();
    },
  );
}
