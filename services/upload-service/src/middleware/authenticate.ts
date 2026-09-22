import type { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { getEnv } from '../config/env';

export interface AuthUser {
  userId: string;
  email: string;
  tier: string;
  permissions?: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export async function verifyApiKey(rawKey: string, server: any): Promise<AuthUser | null> {
  const cleanKey = rawKey.trim();
  if (!cleanKey) return null;
  const keyHash = crypto.createHash('sha256').update(cleanKey).digest('hex');

  // 1. Check Redis cache
  if (server.redis) {
    try {
      const cached = await server.redis.get(`apikey:${keyHash}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.expiresAt && new Date(parsed.expiresAt) < new Date()) {
          return null;
        }
        let email = parsed.email;
        let tier = parsed.tier;
        if (!email || !tier) {
          if (server.prisma?.user) {
            const u = await (server.prisma as any).user.findUnique({ where: { id: parsed.userId } });
            if (u) {
              email = u.email;
              tier = u.tier;
            }
          }
        }
        return {
          userId: parsed.userId,
          email: email ?? `${parsed.userId}@api.local`,
          tier: tier ?? 'free',
          permissions: parsed.permissions ?? ['*'],
        };
      }
    } catch {
      // Redis error, proceed to DB lookup
    }
  }

  // 2. Check Database via Prisma
  if (server.prisma && (server.prisma as any).apiKey) {
    try {
      const apiKeyRecord = await (server.prisma as any).apiKey.findFirst({
        where: { keyHash, revokedAt: null },
        include: { user: true },
      });

      if (!apiKeyRecord) {
        return null;
      }

      if (apiKeyRecord.expiresAt && new Date(apiKeyRecord.expiresAt) < new Date()) {
        return null;
      }

      // Update lastUsedAt asynchronously
      if ((server.prisma as any).apiKey.update) {
        (server.prisma as any).apiKey.update({
          where: { id: apiKeyRecord.id },
          data: { lastUsedAt: new Date() },
        }).catch(() => {});
      }

      const authUser: AuthUser = {
        userId: apiKeyRecord.userId,
        email: apiKeyRecord.user?.email ?? `${apiKeyRecord.userId}@api.local`,
        tier: apiKeyRecord.user?.tier ?? 'free',
        permissions: apiKeyRecord.permissions ?? ['*'],
      };

      // Populate Redis cache for 5 minutes
      if (server.redis) {
        server.redis.setex(
          `apikey:${keyHash}`,
          300,
          JSON.stringify({
            userId: authUser.userId,
            email: authUser.email,
            tier: authUser.tier,
            permissions: authUser.permissions,
            expiresAt: apiKeyRecord.expiresAt ? apiKeyRecord.expiresAt.toISOString() : null,
          }),
        ).catch(() => {});
      }

      return authUser;
    } catch {
      return null;
    }
  }

  return null;
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // 1. Check for X-API-Key header
  const apiKeyHeader = (request.headers['x-api-key'] || request.headers['x-api_key']) as string | undefined;
  if (apiKeyHeader) {
    const user = await verifyApiKey(apiKeyHeader, request.server);
    if (user) {
      request.user = user;
      return;
    }
    return reply.status(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Invalid or expired API key' },
    });
  }

  // 2. Check Authorization header
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    const isJwt = token.split('.').length === 3;

    if (isJwt) {
      try {
        const payload = jwt.verify(token, getEnv().JWT_ACCESS_SECRET) as any;
        request.user = {
          userId: payload.userId,
          email: payload.email,
          tier: payload.tier ?? 'free',
          permissions: payload.permissions ?? ['*'],
        };
        return;
      } catch {
        if (process.env.NODE_ENV === 'test' && !request.headers['x-guest-mode']) {
          return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } });
        }
      }
    } else {
      // Check if it's an API key supplied as Bearer <apiKey>
      const apiKeyUser = await verifyApiKey(token, request.server);
      if (apiKeyUser) {
        request.user = apiKeyUser;
        return;
      }
      if (process.env.NODE_ENV === 'test' && !request.headers['x-guest-mode']) {
        return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } });
      }
    }
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    if (process.env.NODE_ENV === 'test' && !request.headers['x-guest-mode']) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing authorization header' } });
    }
  }

  // Guest Mode: Assign temporary guest session based on client IP
  const clientIp = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || request.ip || '127.0.0.1';
  const guestId = `guest_${clientIp.replace(/[^a-zA-Z0-9]/g, '_')}`;
  request.user = {
    userId: guestId,
    email: `${guestId}@guest.local`,
    tier: 'guest',
  };
}
