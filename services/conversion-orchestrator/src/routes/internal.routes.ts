/**
 * Internal-only routes for the conversion orchestrator.
 *
 * These are called by Python workers to report job completion/failure.
 * They are NOT exposed through the Nginx gateway.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getEnv } from '../config/env';

const statusUpdateSchema = z.object({
  status: z.enum(['processing', 'completed', 'failed']),
  progress: z.coerce.number().int().min(0).max(100).optional(),
  resultFileId: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  workerId: z.string().optional(),
});

export async function internalConversionRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /internal/conversions/:jobId/status
   *
   * Called by Python workers to update job status.
   * On terminal state (completed | failed) the orchestrator triggers webhook
   * delivery via the notification-service if the job has a webhookUrl.
   */
  fastify.post<{ Params: { jobId: string } }>(
    '/internal/conversions/:jobId/status',
    async (request, reply) => {
      const { jobId } = request.params;

      const parsed = statusUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: parsed.error.errors.map((e) => e.message).join(', ') },
        });
      }

      const { status, progress, resultFileId, errorMessage, workerId } = parsed.data;

      try {
        const updateData: Record<string, unknown> = { status };
        if (progress !== undefined) updateData.progress = progress;
        if (resultFileId !== undefined) updateData.resultFileId = resultFileId;
        if (errorMessage !== undefined) updateData.errorMessage = errorMessage;
        if (workerId) updateData.workerId = workerId;
        if (status === 'processing') updateData.startedAt = new Date();
        if (status === 'completed' || status === 'failed') {
          updateData.completedAt = new Date();
          updateData.progress = 100;
        }

        const job = await (fastify.prisma as any).conversionJob.update({
          where: { id: jobId },
          data: updateData,
        });

        // ── Trigger webhook delivery on terminal state ────────────────────────
        if (status === 'completed' || status === 'failed') {
          const env = getEnv();
          const eventName = status === 'completed' ? 'conversion.completed' : 'conversion.failed';
          const targetUrls = new Set<string>();

          if (job.webhookUrl) {
            targetUrls.add(job.webhookUrl);
          }

          // Query user-registered webhook endpoints subscribed to this event
          if (job.userId && !job.userId.startsWith('guest_') && (fastify.prisma as any).webhookEndpoint) {
            try {
              const endpoints = await (fastify.prisma as any).webhookEndpoint.findMany({
                where: {
                  userId: job.userId,
                  active: true,
                },
              });
              for (const ep of endpoints) {
                if (
                  !ep.events ||
                  ep.events.length === 0 ||
                  ep.events.includes('*') ||
                  ep.events.includes(eventName)
                ) {
                  if (ep.url) {
                    targetUrls.add(ep.url);
                  }
                }
              }
            } catch (err) {
              fastify.log.error({ err, userId: job.userId }, 'failed to query user webhook endpoints');
            }
          }

          const payload = {
            event: eventName,
            jobId: job.id,
            status: job.status,
            resultFileId: job.resultFileId ?? null,
            errorMessage: job.errorMessage ?? null,
            userId: job.userId,
            timestamp: new Date().toISOString(),
          };

          for (const targetUrl of targetUrls) {
            // Fire-and-forget — the notification-service handles retries
            fetch(`${env.NOTIFICATION_SERVICE_URL}/internal/notifications/webhooks/send`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                webhookUrl: targetUrl,
                payload,
              }),
            }).catch((err) => fastify.log.error({ err, jobId, webhookUrl: targetUrl }, 'webhook delivery trigger failed'));
          }
        }

        return reply.status(200).send({ ok: true, jobId, status });
      } catch (err: any) {
        if (err?.code === 'P2025') {
          // Prisma record not found
          return reply.status(404).send({ error: { code: 'NOT_FOUND', message: `Job ${jobId} not found` } });
        }
        fastify.log.error({ err, jobId }, 'internal status update failed');
        throw err;
      }
    },
  );
}
