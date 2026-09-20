import type { FastifyRequest, FastifyReply } from 'fastify';

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user) {
    return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
  }
  if (request.user.tier !== 'admin') {
    return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Admin access required' } });
  }
}
