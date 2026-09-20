import type { PrismaClient } from '@prisma/client';
import type IORedis from 'ioredis';
import { quotaChecksTotal } from '../plugins/metrics';

export type SubscriptionTier = 'free' | 'pro' | 'business' | 'enterprise';
export type QuotaType = 'conversions' | 'api_calls' | 'storage';

export interface SubscriptionQuotas {
  conversionsPerMonth: number;
  maxFileSize: number;
  apiCallsPerMonth: number;
  storageRetentionDays: number;
  priorityProcessing: boolean;
  whiteLabel: boolean;
}

export const QUOTA_LIMITS: Record<SubscriptionTier, SubscriptionQuotas> = {
  free: {
    conversionsPerMonth: 100,
    maxFileSize: 100 * 1024 * 1024,
    apiCallsPerMonth: 1000,
    storageRetentionDays: 7,
    priorityProcessing: false,
    whiteLabel: false,
  },
  pro: {
    conversionsPerMonth: 10000,
    maxFileSize: 1024 * 1024 * 1024,
    apiCallsPerMonth: 100000,
    storageRetentionDays: 14,
    priorityProcessing: true,
    whiteLabel: false,
  },
  business: {
    conversionsPerMonth: 100000,
    maxFileSize: 10 * 1024 * 1024 * 1024,
    apiCallsPerMonth: 1000000,
    storageRetentionDays: 30,
    priorityProcessing: true,
    whiteLabel: true,
  },
  enterprise: {
    conversionsPerMonth: -1,
    maxFileSize: -1,
    apiCallsPerMonth: -1,
    storageRetentionDays: 90,
    priorityProcessing: true,
    whiteLabel: true,
  },
};

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  avatarUrl: string | null;
  tier: SubscriptionTier;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuotaCheck {
  allowed: boolean;
  remaining: number;
  resetDate: Date;
  reason?: string;
}

export interface UsageStats {
  conversionsThisMonth: number;
  apiCallsThisMonth: number;
  storageUsed: number;
  quotas: SubscriptionQuotas;
  resetDate: Date;
}

export class UserService {
  constructor(
    private prisma: PrismaClient,
    private redis: IORedis,
  ) {}

  private getResetDate(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 1);
  }

  private getMonthStart(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  async getProfile(userId: string): Promise<UserProfile> {
    // Check cache
    const cached = await this.redis.get(`user:profile:${userId}`);
    if (cached) return JSON.parse(cached);

    const user = await (this.prisma as any).user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) {
      const err = new Error('User not found') as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    }

    const profile = await (this.prisma as any).userProfile.findUnique({ where: { userId } });

    const result: UserProfile = {
      id: user.id,
      email: user.email,
      name: profile?.name ?? null,
      company: profile?.company ?? null,
      avatarUrl: profile?.avatarUrl ?? null,
      tier: user.tier ?? 'free',
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    await this.redis.setex(`user:profile:${userId}`, 15 * 60, JSON.stringify(result));
    return result;
  }

  async updateProfile(
    userId: string,
    updates: { name?: string; company?: string; avatarUrl?: string },
  ): Promise<UserProfile> {
    const user = await (this.prisma as any).user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) {
      const err = new Error('User not found') as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    }

    await (this.prisma as any).userProfile.upsert({
      where: { userId },
      update: { ...updates, updatedAt: new Date() },
      create: { userId, ...updates, createdAt: new Date(), updatedAt: new Date() },
    });

    // Invalidate cache
    await this.redis.del(`user:profile:${userId}`);

    return this.getProfile(userId);
  }

  async deleteAccount(userId: string): Promise<void> {
    const user = await (this.prisma as any).user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) {
      const err = new Error('User not found') as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    }

    await (this.prisma as any).user.update({
      where: { id: userId },
      data: { deletedAt: new Date() },
    });

    await this.redis.del(`user:profile:${userId}`);
  }

  async getSubscription(userId: string) {
    const user = await (this.prisma as any).user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) {
      const err = new Error('User not found') as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    }

    const sub = await (this.prisma as any).subscription.findUnique({ where: { userId } });
    const tier: SubscriptionTier = sub?.tier ?? user.tier ?? 'free';

    return {
      userId,
      tier,
      status: sub?.status ?? 'active',
      currentPeriodStart: sub?.currentPeriodStart ?? new Date(),
      currentPeriodEnd: sub?.currentPeriodEnd ?? this.getResetDate(),
      stripeSubscriptionId: sub?.stripeSubscriptionId ?? null,
      quotas: QUOTA_LIMITS[tier],
    };
  }

  async updateSubscription(userId: string, tier: SubscriptionTier): Promise<void> {
    const now = new Date();
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    await (this.prisma as any).subscription.upsert({
      where: { userId },
      update: { tier, updatedAt: now },
      create: {
        userId,
        tier,
        status: 'active',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        createdAt: now,
        updatedAt: now,
      },
    });

    await (this.prisma as any).user.update({
      where: { id: userId },
      data: { tier },
    });

    // Invalidate caches
    await this.redis.del(`user:profile:${userId}`);
    await this.redis.del(`user:quota:${userId}:conversions`);
    await this.redis.del(`user:quota:${userId}:api_calls`);
    await this.redis.del(`user:quota:${userId}:storage`);
  }

  private async getMonthlyUsage(userId: string, quotaType: QuotaType): Promise<number> {
    const monthStart = this.getMonthStart();
    const result = await (this.prisma as any).usageLog.aggregate({
      where: { userId, quotaType, createdAt: { gte: monthStart } },
      _sum: { amount: true },
    });
    return result._sum?.amount ?? 0;
  }

  async getUsage(userId: string): Promise<UsageStats> {
    const sub = await this.getSubscription(userId);
    const tier = sub.tier as SubscriptionTier;
    const quotas = QUOTA_LIMITS[tier];

    const [conversions, apiCalls] = await Promise.all([
      this.getMonthlyUsage(userId, 'conversions'),
      this.getMonthlyUsage(userId, 'api_calls'),
    ]);

    return {
      conversionsThisMonth: conversions,
      apiCallsThisMonth: apiCalls,
      storageUsed: 0,
      quotas,
      resetDate: this.getResetDate(),
    };
  }

  async checkQuota(userId: string, quotaType: QuotaType, amount: number): Promise<QuotaCheck> {
    const sub = await this.getSubscription(userId);
    const tier = sub.tier as SubscriptionTier;
    const quotas = QUOTA_LIMITS[tier];

    let limit: number;
    if (quotaType === 'conversions') limit = quotas.conversionsPerMonth;
    else if (quotaType === 'api_calls') limit = quotas.apiCallsPerMonth;
    else limit = -1; // storage handled differently

    // Unlimited
    if (limit === -1) {
      quotaChecksTotal.inc({ tier, result: 'allowed' });
      return { allowed: true, remaining: -1, resetDate: this.getResetDate() };
    }

    const used = await this.getMonthlyUsage(userId, quotaType);
    const remaining = Math.max(0, limit - used);
    const allowed = used + amount <= limit;

    quotaChecksTotal.inc({ tier, result: allowed ? 'allowed' : 'exceeded' });

    return {
      allowed,
      remaining,
      resetDate: this.getResetDate(),
      reason: allowed ? undefined : `${quotaType} quota exceeded`,
    };
  }

  async incrementUsage(userId: string, quotaType: QuotaType, amount: number): Promise<void> {
    await (this.prisma as any).usageLog.create({
      data: { userId, quotaType, amount, createdAt: new Date() },
    });

    // Invalidate quota cache
    await this.redis.del(`user:quota:${userId}:${quotaType}`);
  }

  async resetMonthlyQuotas(): Promise<number> {
    // Archive previous month logs by deleting them (simplified)
    const monthStart = this.getMonthStart();
    const result = await (this.prisma as any).usageLog.deleteMany({
      where: { createdAt: { lt: monthStart } },
    });

    return result.count ?? 0;
  }
}
