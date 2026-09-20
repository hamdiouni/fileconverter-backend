import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { UserService, type QuotaType, type SubscriptionTier } from '../services/user.service';

function isValidUrl(str: string): boolean {
  try { new URL(str); return true; } catch { return false; }
}

const updateProfileSchema = z.object({
  name: z.string().max(255).optional(),
  company: z.string().max(255).optional(),
  avatarUrl: z.string().optional().refine((v) => !v || isValidUrl(v), {
    message: 'avatarUrl must be a valid URL',
  }),
});

const quotaCheckSchema = z.object({
  quotaType: z.enum(['conversions', 'api_calls', 'storage']),
  amount: z.number().int().positive().default(1),
});

const incrementUsageSchema = z.object({
  quotaType: z.enum(['conversions', 'api_calls', 'storage']),
  amount: z.number().int().positive().default(1),
});

const updateSubscriptionSchema = z.object({
  tier: z.enum(['free', 'pro', 'business', 'enterprise']),
});

export class UserController {
  constructor(private userService: UserService) {}

  getProfile = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const profile = await this.userService.getProfile(request.user!.userId);
      return reply.status(200).send(profile);
    } catch (err: any) {
      if (err.statusCode === 404) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: err.message } });
      throw err;
    }
  };

  updateProfile = async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = updateProfileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.errors },
      });
    }
    try {
      const profile = await this.userService.updateProfile(request.user!.userId, parsed.data);
      return reply.status(200).send(profile);
    } catch (err: any) {
      if (err.statusCode === 404) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: err.message } });
      throw err;
    }
  };

  deleteAccount = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await this.userService.deleteAccount(request.user!.userId);
      return reply.status(204).send();
    } catch (err: any) {
      if (err.statusCode === 404) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: err.message } });
      throw err;
    }
  };

  getSubscription = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const sub = await this.userService.getSubscription(request.user!.userId);
      return reply.status(200).send(sub);
    } catch (err: any) {
      if (err.statusCode === 404) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: err.message } });
      throw err;
    }
  };

  getUsage = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const usage = await this.userService.getUsage(request.user!.userId);
      return reply.status(200).send(usage);
    } catch (err: any) {
      if (err.statusCode === 404) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: err.message } });
      throw err;
    }
  };

  updateSubscriptionInternal = async (
    request: FastifyRequest<{ Params: { userId: string } }>,
    reply: FastifyReply,
  ) => {
    const parsed = updateSubscriptionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid tier' } });
    }
    try {
      await this.userService.updateSubscription(request.params.userId, parsed.data.tier as SubscriptionTier);
      const sub = await this.userService.getSubscription(request.params.userId);
      return reply.status(200).send(sub);
    } catch (err: any) {
      if (err.statusCode === 404) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: err.message } });
      throw err;
    }
  };

  checkQuotaInternal = async (
    request: FastifyRequest<{ Params: { userId: string } }>,
    reply: FastifyReply,
  ) => {
    const parsed = quotaCheckSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input' } });
    }
    const result = await this.userService.checkQuota(
      request.params.userId,
      parsed.data.quotaType as QuotaType,
      parsed.data.amount,
    );
    return reply.status(200).send(result);
  };

  incrementUsageInternal = async (
    request: FastifyRequest<{ Params: { userId: string } }>,
    reply: FastifyReply,
  ) => {
    const parsed = incrementUsageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input' } });
    }
    await this.userService.incrementUsage(
      request.params.userId,
      parsed.data.quotaType as QuotaType,
      parsed.data.amount,
    );
    return reply.status(204).send();
  };
}
