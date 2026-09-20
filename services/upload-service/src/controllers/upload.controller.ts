import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { UploadService } from '../services/upload.service';

const createUploadSchema = z.object({
  filename: z.string().min(1).max(500),
  contentType: z.string().min(1),
  fileSize: z.number().int().positive(),
});

const multipartInitSchema = z.object({
  filename: z.string().min(1).max(500),
  contentType: z.string().min(1),
});

export class UploadController {
  constructor(private uploadService: UploadService) {}

  createUpload = async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = createUploadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.errors } });
    }
    try {
      const result = await this.uploadService.createUpload({
        userId: request.user!.userId,
        userTier: request.user!.tier,
        ...parsed.data,
      });
      return reply.status(201).send(result);
    } catch (err: any) {
      if (err.statusCode === 413) return reply.status(413).send({ error: { code: err.code ?? 'FILE_TOO_LARGE', message: err.message } });
      if (err.statusCode === 400) return reply.status(400).send({ error: { code: err.code ?? 'BAD_REQUEST', message: err.message } });
      throw err;
    }
  };

  completeUpload = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    try {
      const file = await this.uploadService.completeUpload(id, request.user!.userId);
      return reply.status(200).send(file);
    } catch (err: any) {
      if (err.statusCode === 404) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: err.message } });
      throw err;
    }
  };

  getFile = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    try {
      const file = await this.uploadService.getFile(id, request.user!.userId);
      return reply.status(200).send(file);
    } catch (err: any) {
      if (err.statusCode === 404) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: err.message } });
      throw err;
    }
  };

  deleteFile = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    try {
      await this.uploadService.deleteFile(id, request.user!.userId);
      return reply.status(204).send();
    } catch (err: any) {
      if (err.statusCode === 404) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: err.message } });
      throw err;
    }
  };

  getDownloadUrl = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    try {
      const url = await this.uploadService.getDownloadUrl(id, request.user!.userId);
      return reply.status(200).send({ downloadUrl: url, expiresIn: 3600 });
    } catch (err: any) {
      if (err.statusCode === 404) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: err.message } });
      if (err.statusCode === 403) return reply.status(403).send({ error: { code: 'FORBIDDEN', message: err.message } });
      throw err;
    }
  };

  initiateMultipart = async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = multipartInitSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input' } });
    }
    const result = await this.uploadService.initiateMultipartUpload(
      request.user!.userId,
      request.user!.tier,
      parsed.data.filename,
      parsed.data.contentType,
    );
    return reply.status(201).send(result);
  };

  completeMultipart = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { totalSize } = request.body as { totalSize?: number };
    try {
      const file = await this.uploadService.completeMultipartUpload(
        id,
        request.user!.userId,
        totalSize ?? 0,
      );
      return reply.status(200).send(file);
    } catch (err: any) {
      if (err.statusCode === 404) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: err.message } });
      throw err;
    }
  };
}
