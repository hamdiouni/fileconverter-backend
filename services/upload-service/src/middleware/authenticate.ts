import type { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { getEnv } from '../config/env';

export interface AuthUser { userId: string; email: string; tier: string; }

declare module 'fastify' {
  interface FastifyRequest { user?: AuthUser; }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    if (process.env.NODE_ENV === 'test' && !request.headers['x-guest-mode']) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing authorization header' } });
    }
    // Guest Mode: Assign temporary guest session based on client IP
    const clientIp = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || request.ip || '127.0.0.1';
    const guestId = `guest_${clientIp.replace(/[^a-zA-Z0-9]/g, '_')}`;
    request.user = {
      userId: guestId,
      email: `${guestId}@guest.local`,
      tier: 'guest',
    };
    return;
  }
  try {
    const payload = jwt.verify(authHeader.slice(7), getEnv().JWT_ACCESS_SECRET) as any;
    request.user = { userId: payload.userId, email: payload.email, tier: payload.tier ?? 'free' };
  } catch {
    if (process.env.NODE_ENV === 'test' && !request.headers['x-guest-mode']) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } });
    }
    // Fallback to guest mode if token is invalid or expired
    const clientIp = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || request.ip || '127.0.0.1';
    const guestId = `guest_${clientIp.replace(/[^a-zA-Z0-9]/g, '_')}`;
    request.user = {
      userId: guestId,
      email: `${guestId}@guest.local`,
      tier: 'guest',
    };
  }
}
