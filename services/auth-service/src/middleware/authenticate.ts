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
    return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing bearer token' } });
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as {
      userId: string;
      email: string;
      tier: string;
      permissions: string[];
    };

    // Cache result in Redis if available
    if ((request.server as any).redis) {
      const redis = (request.server as any).redis;
      const jwtValidations = (request.server as any).metrics?.jwtValidationsTotal;
      const cached = await (redis as any).get(`session:${payload.userId}`);
      if (cached) {
        const session = JSON.parse(cached as string) as { tier: string; permissions: string[] };
        request.user = { ...payload, tier: session.tier, permissions: session.permissions };
        jwtValidations?.inc({ result: 'valid' });
        return;
      }
      jwtValidations?.inc({ result: 'valid' });
    }

    request.user = payload;
  } catch (err) {
    const jwtValidations = (request.server as any).metrics?.jwtValidationsTotal;
    if (err instanceof jwt.TokenExpiredError) {
      jwtValidations?.inc({ result: 'expired' });
      return reply.status(401).send({ error: { code: 'TOKEN_EXPIRED', message: 'Access token has expired' } });
    }
    jwtValidations?.inc({ result: 'invalid' });
    return reply.status(401).send({ error: { code: 'INVALID_TOKEN', message: 'Invalid access token' } });
  }
}
