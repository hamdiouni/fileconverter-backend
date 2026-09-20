import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  ConversionService,
  type JobFilters,
  type JobStatus,
} from '../services/conversion.service';

const submitJobSchema = z.object({
  sourceFileId: z.string().min(1, 'sourceFileId is required'),
  targetFormat: z.string().min(1, 'targetFormat is required'),
  options: z.record(z.any()).optional(),
  idempotencyKey: z.string().optional(),
  webhookUrl: z.string().url().optional(),
});

const listJobsSchema = z.object({
  status: z.enum(['queued', 'processing', 'completed', 'failed', 'cancelled']).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export class ConversionController {
  constructor(private conversionService: ConversionService) {}

  submitJob = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply
        .status(401)
        .send({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
    }

    const parsed = submitJobSchema.safeParse(request.body);
    if (!parsed.success) {
      const messages = parsed.error.errors.map((e) => e.message).join(', ');
      return reply
        .status(400)
        .send({ error: { code: 'VALIDATION_ERROR', message: messages } });
    }

    const { sourceFileId, targetFormat, options, idempotencyKey } = parsed.data;

    try {
      const result = await this.conversionService.submitJob(
        request.user.userId,
        sourceFileId,
        targetFormat,
        options,
        idempotencyKey,
      );

      return reply.status(202).send({
        jobId: result.job.id,
        status: result.job.status,
        fromCache: result.fromCache ?? false,
        fromIdempotency: result.fromIdempotency ?? false,
        resultFileId: result.job.resultFileId ?? undefined,
        job: result.job,
      });
    } catch (err: any) {
      if (err.statusCode === 400) {
        return reply.status(400).send({ error: { code: err.code ?? 'INVALID_FORMAT_PAIR', message: err.message } });
      }
      if (err.statusCode === 402) {
        return reply.status(402).send({ error: { code: err.code ?? 'QUOTA_EXCEEDED', message: err.message } });
      }
      throw err;
    }
  };

  getJob = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply
        .status(401)
        .send({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
    }

    const params = request.params as { id: string };

    try {
      const job = await this.conversionService.getJob(params.id, request.user.userId);
      return reply.status(200).send(job);
    } catch (err: any) {
      if (err.statusCode === 404) {
        return reply
          .status(404)
          .send({ error: { code: 'NOT_FOUND', message: err.message } });
      }
      if (err.statusCode === 403) {
        return reply
          .status(403)
          .send({ error: { code: 'FORBIDDEN', message: err.message } });
      }
      throw err;
    }
  };

  listJobs = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply
        .status(401)
        .send({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
    }

    const parsed = listJobsSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid query params' } });
    }

    const filters: JobFilters = {
      status: parsed.data.status as JobStatus | undefined,
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
    };

    const result = await this.conversionService.listJobs(request.user.userId, filters);
    return reply.status(200).send(result);
  };

  cancelJob = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply
        .status(401)
        .send({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
    }

    const params = request.params as { id: string };

    try {
      const job = await this.conversionService.cancelJob(params.id, request.user.userId);
      return reply.status(200).send(job);
    } catch (err: any) {
      if (err.statusCode === 404) {
        return reply
          .status(404)
          .send({ error: { code: 'NOT_FOUND', message: err.message } });
      }
      if (err.statusCode === 403) {
        return reply
          .status(403)
          .send({ error: { code: 'FORBIDDEN', message: err.message } });
      }
      if (err.statusCode === 409) {
        return reply
          .status(409)
          .send({ error: { code: err.code ?? 'JOB_NOT_CANCELLABLE', message: err.message } });
      }
      throw err;
    }
  };
}
