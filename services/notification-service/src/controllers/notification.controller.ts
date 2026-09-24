import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { NotificationService } from '../services/notification.service';

const webhookSendSchema = z.object({
  webhookUrl: z.string().url(),
  secret: z.string().optional(),
  payload: z.object({
    jobId: z.string().min(1),
    status: z.string().min(1),
    resultFileId: z.string().optional(),
    errorMessage: z.string().optional(),
    userId: z.string().min(1),
  }),
  maxRetries: z.number().int().min(1).max(10).optional(),
});

const emailSendSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1),
  type: z.enum(['completion', 'failure']),
});

const batchAddSchema = z.object({
  userId: z.string().min(1),
  notification: z.object({
    jobId: z.string().min(1),
    type: z.string().min(1),
    message: z.string().min(1),
  }),
});

const batchFlushSchema = z.object({
  userId: z.string().min(1),
});

export class NotificationController {
  constructor(private service: NotificationService) {}

  sendWebhook = async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = webhookSendSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message },
      });
    }
    const { webhookUrl, payload, maxRetries, secret } = parsed.data;
    const result = await this.service.sendWebhook(webhookUrl, payload, maxRetries ?? 3, secret);
    return reply.status(200).send(result);
  };

  sendEmail = async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = emailSendSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message },
      });
    }
    const { to, subject, body, type } = parsed.data;
    await this.service.sendEmail(to, subject, body, type);
    return reply.status(200).send({ sent: true });
  };

  getWebhookDeliveries = async (request: FastifyRequest, reply: FastifyReply) => {
    const { jobId } = request.params as { jobId: string };
    const deliveries = await this.service.getWebhookDeliveries(jobId);
    return reply.status(200).send({ deliveries });
  };

  addToBatch = async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = batchAddSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message },
      });
    }
    const { userId, notification } = parsed.data;
    await this.service.batchNotifications(userId, notification);
    return reply.status(200).send({ queued: true });
  };

  flushBatch = async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = batchFlushSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message },
      });
    }
    const { userId } = parsed.data;
    const notifications = await this.service.flushBatch(userId);
    return reply.status(200).send({ notifications });
  };
}
