import type { FastifyInstance, RouteHandlerMethod } from 'fastify';
import { AuthService } from '../services/auth.service';
import { createAuthController } from '../controllers/auth.controller';
import { authenticate } from '../middleware/authenticate';

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  const authService = new AuthService(fastify.prisma, fastify.redis);
  const ctrl = createAuthController(authService);

  fastify.post('/api/v1/auth/register', ctrl.register.bind(ctrl) as RouteHandlerMethod);
  fastify.post('/api/v1/auth/login', ctrl.login.bind(ctrl) as RouteHandlerMethod);
  fastify.post('/api/v1/auth/refresh', ctrl.refresh.bind(ctrl) as RouteHandlerMethod);

  // OAuth flows
  fastify.get('/api/v1/auth/oauth/:provider', ctrl.oauthInitiate.bind(ctrl) as RouteHandlerMethod);
  fastify.get('/api/v1/auth/oauth/:provider/callback', ctrl.oauthCallback.bind(ctrl) as RouteHandlerMethod);

  // API key management (requires auth)
  fastify.post('/api/v1/auth/api-keys', { preHandler: authenticate }, ctrl.generateApiKey.bind(ctrl) as RouteHandlerMethod);
  fastify.get('/api/v1/auth/api-keys', { preHandler: authenticate }, ctrl.listApiKeys.bind(ctrl) as RouteHandlerMethod);
  fastify.delete('/api/v1/auth/api-keys/:id', { preHandler: authenticate }, ctrl.revokeApiKey.bind(ctrl) as RouteHandlerMethod);
}
