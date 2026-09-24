import type { FastifyInstance } from 'fastify';
import { UploadService } from '../services/upload.service';
import { UploadController } from '../controllers/upload.controller';
import { authenticate } from '../middleware/authenticate';

export async function uploadRoutes(fastify: FastifyInstance): Promise<void> {
  // Storage service is injected via fastify.storage
  const uploadService = new UploadService(fastify.prisma, fastify.redis, (fastify as any).storage);
  const ctrl = new UploadController(uploadService);

  fastify.post('/api/v1/uploads', { preHandler: authenticate }, ctrl.createUpload);
  fastify.post('/api/v1/uploads/:id/complete', { preHandler: authenticate }, ctrl.completeUpload);
  fastify.get('/api/v1/uploads/:id', { preHandler: authenticate }, ctrl.getFile);
  fastify.delete('/api/v1/uploads/:id', { preHandler: authenticate }, ctrl.deleteFile);
  fastify.get('/api/v1/uploads/download', { preHandler: authenticate }, ctrl.getDownloadUrl);
  fastify.get('/api/v1/uploads/:id/download', { preHandler: authenticate }, ctrl.getDownloadUrl);
  fastify.post('/api/v1/uploads/multipart', { preHandler: authenticate }, ctrl.initiateMultipart);
  fastify.post('/api/v1/uploads/multipart/:id/complete', { preHandler: authenticate }, ctrl.completeMultipart);
}
