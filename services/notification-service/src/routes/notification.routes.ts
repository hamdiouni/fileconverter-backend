import type { FastifyInstance } from 'fastify';
import { NotificationController } from '../controllers/notification.controller';
import { NotificationService } from '../services/notification.service';
import { authenticate } from '../middleware/authenticate';

export async function notificationRoutes(fastify: FastifyInstance) {
  const service = new NotificationService(fastify.prisma, fastify.redis);
  const controller = new NotificationController(service);

  fastify.post(
    '/api/v1/notifications/webhooks/send',
    { preHandler: authenticate },
    controller.sendWebhook,
  );

  // Internal service-to-service route (called by orchestrator on job completion)
  fastify.post(
    '/internal/notifications/webhooks/send',
    controller.sendWebhook,
  );

  fastify.post(
    '/api/v1/notifications/emails/send',
    { preHandler: authenticate },
    controller.sendEmail,
  );

  fastify.get(
    '/api/v1/notifications/webhooks/:jobId',
    { preHandler: authenticate },
    controller.getWebhookDeliveries,
  );

  fastify.post(
    '/api/v1/notifications/batch',
    { preHandler: authenticate },
    controller.addToBatch,
  );

  fastify.post(
    '/api/v1/notifications/batch/flush',
    { preHandler: authenticate },
    controller.flushBatch,
  );
}
