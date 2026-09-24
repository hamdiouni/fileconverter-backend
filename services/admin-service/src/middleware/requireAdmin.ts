import type { FastifyRequest, FastifyReply } from 'fastify';

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user) {
    return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
  }

  const adminTier = process.env.ADMIN_ROLE || 'admin';
  const isAdmin =
    request.user.tier === adminTier ||
    request.user.tier === 'admin' ||
    request.user.permissions?.includes('admin') ||
    request.user.permissions?.includes('*');

  if (!isAdmin) {
    return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Admin access required' } });
  }
}
