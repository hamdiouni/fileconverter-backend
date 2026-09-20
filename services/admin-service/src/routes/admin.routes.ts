import type { FastifyInstance } from 'fastify';
import { AdminController } from '../controllers/admin.controller';
import { AdminService } from '../services/admin.service';
import { authenticate } from '../middleware/authenticate';
import { requireAdmin } from '../middleware/requireAdmin';

export async function adminRoutes(fastify: FastifyInstance) {
  const service = new AdminService(fastify.prisma, fastify.redis);
  const controller = new AdminController(service);

  fastify.register(async (app) => {
    app.addHook('onRequest', authenticate);
    app.addHook('onRequest', requireAdmin);

    app.get('/api/v1/admin/users', controller.listUsers);
    app.get('/api/v1/admin/users/:id', controller.getUser);
    app.post('/api/v1/admin/users/:id/suspend', controller.suspendUser);
    app.post('/api/v1/admin/users/:id/unsuspend', controller.unsuspendUser);

    app.get('/api/v1/admin/jobs', controller.listJobs);
    app.get('/api/v1/admin/jobs/:id', controller.getJob);
    app.post('/api/v1/admin/jobs/:id/retry', controller.retryJob);
    app.delete('/api/v1/admin/jobs/:id', controller.cancelJob);

    app.get('/api/v1/admin/metrics', controller.getMetrics);
  });
}
