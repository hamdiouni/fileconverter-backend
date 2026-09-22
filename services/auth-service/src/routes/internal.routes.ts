import type { FastifyInstance, RouteHandlerMethod } from 'fastify';
import { z } from 'zod';
import { AuthService } from '../services/auth.service';

const googleLoginSchema = z.object({
  googleId: z.string().min(1, 'googleId is required'),
  email: z.string().email('Valid email is required'),
  name: z.string().nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
});

/**
 * Internal routes — exposed only on the internal Docker network.
 * NOT proxied through the Nginx gateway; called service-to-service only.
 */
export async function internalRoutes(fastify: FastifyInstance): Promise<void> {
  const authService = new AuthService(fastify.prisma, fastify.redis);

  /**
   * POST /internal/auth/google
   *
   * Called by the Next.js OAuth callback route after it has already:
   *  1. Exchanged the Google authorization code for an access_token
   *  2. Fetched the Google user-info profile
   *
   * Returns FileConverter-signed JWT pair (accessToken + refreshToken).
   * The caller MUST store only these tokens — never the raw Google access_token.
   */
  fastify.post(
    '/internal/auth/google',
    async (request, reply) => {
      const parsed = googleLoginSchema.safeParse(request.body);
      if (!parsed.success) {
        const messages = parsed.error.errors.map((e) => e.message).join(', ');
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: messages },
        });
      }

      try {
        const result = await authService.handleGoogleLogin(
          parsed.data.googleId,
          parsed.data.email,
          parsed.data.name ?? null,
          parsed.data.avatarUrl ?? null,
        );
        return reply.status(200).send(result);
      } catch (err: any) {
        fastify.log.error({ err }, 'handleGoogleLogin failed');
        return reply.status(500).send({
          error: { code: 'INTERNAL_ERROR', message: 'Failed to process Google login' },
        });
      }
    },
  );
}
