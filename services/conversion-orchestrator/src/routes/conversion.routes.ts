import type { FastifyInstance } from 'fastify';
import { ConversionService } from '../services/conversion.service';
import { ConversionController } from '../controllers/conversion.controller';
import { authenticate } from '../middleware/authenticate';

export async function conversionRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new ConversionService(fastify.prisma, fastify.redis);
  const controller = new ConversionController(service);

  fastify.post('/api/v1/conversions', { preHandler: authenticate }, controller.submitJob);
  fastify.get('/api/v1/conversions', { preHandler: authenticate }, controller.listJobs);
  fastify.get('/api/v1/conversions/:id', { preHandler: authenticate }, controller.getJob);
  fastify.delete('/api/v1/conversions/:id', { preHandler: authenticate }, controller.cancelJob);
}
