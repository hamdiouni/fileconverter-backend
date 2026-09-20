import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AuthService } from '../services/auth.service';

const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

const apiKeyCreateSchema = z.object({
  name: z.string().optional(),
  permissions: z.array(z.string()).default([]),
  expiresAt: z.string().datetime().optional(),
});

export function createAuthController(authService: AuthService) {
  return {
    async register(request: FastifyRequest, reply: FastifyReply) {
      const parseResult = registerSchema.safeParse(request.body);
      if (!parseResult.success) {
        const messages = parseResult.error.errors.map((e) => e.message).join(', ');
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: messages },
        });
      }

      try {
        const result = await authService.register(parseResult.data);
        return reply.status(201).send(result);
      } catch (err: any) {
        if (err.statusCode === 409) {
          return reply.status(409).send({
            error: { code: 'EMAIL_CONFLICT', message: err.message },
          });
        }
        throw err;
      }
    },

    async login(request: FastifyRequest, reply: FastifyReply) {
      const parseResult = loginSchema.safeParse(request.body);
      if (!parseResult.success) {
        const messages = parseResult.error.errors.map((e) => e.message).join(', ');
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: messages },
        });
      }

      try {
        const result = await authService.login(parseResult.data);
        return reply.status(200).send(result);
      } catch (err: any) {
        if (err.statusCode === 401) {
          return reply.status(401).send({
            error: { code: 'INVALID_CREDENTIALS', message: err.message },
          });
        }
        throw err;
      }
    },

    async refresh(request: FastifyRequest, reply: FastifyReply) {
      const parseResult = refreshSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'refreshToken is required' },
        });
      }

      try {
        const tokens = await authService.refreshTokens(parseResult.data.refreshToken);
        return reply.status(200).send(tokens);
      } catch (err: any) {
        if (err.statusCode === 401) {
          return reply.status(401).send({
            error: { code: 'INVALID_REFRESH_TOKEN', message: err.message },
          });
        }
        throw err;
      }
    },

    async oauthInitiate(request: FastifyRequest<{ Params: { provider: string } }>, reply: FastifyReply) {
      const { provider } = request.params;
      if (provider !== 'google' && provider !== 'github') {
        return reply.status(400).send({
          error: { code: 'INVALID_PROVIDER', message: 'Supported providers: google, github' },
        });
      }

      const redirectUrl = await authService.initiateOAuth(provider);
      return reply.redirect(redirectUrl);
    },

    async oauthCallback(
      request: FastifyRequest<{ Params: { provider: string }; Querystring: { code?: string; state?: string } }>,
      reply: FastifyReply,
    ) {
      const { provider } = request.params;
      const { code, state } = request.query;

      if (!code || !state) {
        return reply.status(400).send({
          error: { code: 'OAUTH_ERROR', message: 'Missing code or state parameter' },
        });
      }

      try {
        const result = await authService.handleOAuthCallback(provider, code, state);
        // In a real scenario redirect to frontend with tokens
        return reply.status(200).send(result);
      } catch (err: any) {
        if (err.statusCode === 400) {
          return reply.status(400).send({
            error: { code: 'OAUTH_ERROR', message: err.message },
          });
        }
        throw err;
      }
    },

    async generateApiKey(request: FastifyRequest, reply: FastifyReply) {
      if (!request.user) {
        return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
      }

      const parseResult = apiKeyCreateSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: parseResult.error.message },
        });
      }

      const { name, permissions, expiresAt } = parseResult.data;
      const result = await authService.generateApiKey(
        request.user.userId,
        name ?? null,
        permissions,
        expiresAt ? new Date(expiresAt) : undefined,
      );

      return reply.status(201).send(result);
    },

    async listApiKeys(request: FastifyRequest, reply: FastifyReply) {
      if (!request.user) {
        return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
      }

      const keys = await authService.listApiKeys(request.user.userId);
      return reply.status(200).send({ data: keys });
    },

    async revokeApiKey(
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) {
      if (!request.user) {
        return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
      }

      try {
        await authService.revokeApiKey(request.params.id, request.user.userId);
        return reply.status(204).send();
      } catch (err: any) {
        if (err.statusCode === 404) {
          return reply.status(404).send({
            error: { code: 'NOT_FOUND', message: err.message },
          });
        }
        throw err;
      }
    },
  };
}
