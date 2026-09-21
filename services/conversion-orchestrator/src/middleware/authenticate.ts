import type { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { getEnv } from '../config/env';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      userId: string;
      email: string;
      tier: string;
      permissions: string[];
    };
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const env = getEnv();
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // Guest Mode: Assign guest user session
    const clientIp = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || request.ip || '127.0.0.1';
    const guestId = `guest_${clientIp.replace(/[^a-zA-Z0-9]/g, '_')}`;
    request.user = {
      userId: guestId,
      email: `${guestId}@guest.local`,
      tier: 'guest',
      permissions: [],
    };
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as {
      userId: string;
      email: string;
      tier: string;
      permissions: string[];
    };

    request.user = payload;
  } catch {
    // Fallback to Guest Mode if token expired or invalid
    const clientIp = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || request.ip || '127.0.0.1';
    const guestId = `guest_${clientIp.replace(/[^a-zA-Z0-9]/g, '_')}`;
    request.user = {
      userId: guestId,
      email: `${guestId}@guest.local`,
      tier: 'guest',
      permissions: [],
    };
  }
}
