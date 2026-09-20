import type { FastifyInstance } from 'fastify';
import { UserService } from '../services/user.service';
import { UserController } from '../controllers/user.controller';
import { authenticate } from '../middleware/authenticate';

export async function userRoutes(fastify: FastifyInstance): Promise<void> {
  const userService = new UserService(fastify.prisma, fastify.redis);
  const ctrl = new UserController(userService);

  // Authenticated user routes
  fastify.get('/api/v1/users/me', { preHandler: authenticate }, ctrl.getProfile);
  fastify.patch('/api/v1/users/me', { preHandler: authenticate }, ctrl.updateProfile);
  fastify.delete('/api/v1/users/me', { preHandler: authenticate }, ctrl.deleteAccount);
  fastify.get('/api/v1/users/me/subscription', { preHandler: authenticate }, ctrl.getSubscription);
  fastify.get('/api/v1/users/me/usage', { preHandler: authenticate }, ctrl.getUsage);

  // Internal routes (no auth — called by other services)
  fastify.put('/internal/users/:userId/subscription', ctrl.updateSubscriptionInternal);
  fastify.post('/internal/users/:userId/quota/check', ctrl.checkQuotaInternal);
  fastify.post('/internal/users/:userId/quota/increment', ctrl.incrementUsageInternal);
}
