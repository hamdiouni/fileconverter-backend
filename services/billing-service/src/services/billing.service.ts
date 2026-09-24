import type { PrismaClient } from '@prisma/client';
import type IORedis from 'ioredis';
import { getEnv } from '../config/env';

export interface StripeClient {
  checkout: {
    sessions: {
      create(params: any): Promise<any>;
    };
  };
  billingPortal: {
    sessions: {
      create(params: any): Promise<any>;
    };
  };
  webhooks: {
    constructEvent(body: string, signature: string, secret: string): any;
  };
}

export class BillingService {
  constructor(
    private prisma: PrismaClient,
    private redis: IORedis,
    private stripe: StripeClient,
  ) {}

  async createCheckoutSession(
    userId: string,
    priceId: string,
    successUrl: string,
    cancelUrl: string,
  ): Promise<{ sessionId: string; url: string }> {
    const env = getEnv();
    const validPrices = [
      env.STRIPE_PRICE_PRO,
      env.STRIPE_PRICE_PRO_MONTHLY,
      env.STRIPE_PRICE_PRO_YEARLY,
      env.STRIPE_PRICE_BUSINESS,
      env.STRIPE_PRICE_BUSINESS_MONTHLY,
      env.STRIPE_PRICE_BUSINESS_YEARLY,
    ].filter(Boolean);
    if (!validPrices.includes(priceId)) {
      const err = new Error(`Invalid price ID: ${priceId}`) as any;
      err.statusCode = 400;
      err.code = 'INVALID_PRICE_ID';
      throw err;
    }
    const existingCustomerId = await this.redis.get(`stripe:customer:${userId}`);
    const sessionParams: any = {
      ui_mode: 'hosted_page',
      mode: 'subscription',
      billing_address_collection: 'auto',
      phone_number_collection: {
        enabled: false,
      },
      automatic_tax: {
        enabled: false,
      },
      allow_promotion_codes: true,
      payment_method_collection: 'always',
      submit_type: 'auto',
      saved_payment_method_options: {
        payment_method_save: 'enabled',
      },
      integration_identifier: 'hosted_web_0001',
      origin_context: 'web',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: userId,
      metadata: {
        userId,
      },
      subscription_data: {
        metadata: {
          userId,
        },
      },
    };

    if (existingCustomerId) {
      sessionParams.customer = existingCustomerId;
    }

    const session = await this.stripe.checkout.sessions.create(sessionParams);
    return { sessionId: session.id, url: session.url };
  }

  async createPortalSession(
    userId: string,
    returnUrl: string,
  ): Promise<{ url: string }> {
    const customerId = await this.getStripeCustomerId(userId);
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return { url: session.url };
  }

  async handleWebhook(body: string, signature: string): Promise<void> {
    const env = getEnv();
    let event: any;
    try {
      event = this.stripe.webhooks.constructEvent(body, signature, env.STRIPE_WEBHOOK_SECRET);
    } catch (err: any) {
      const e = new Error('Invalid webhook signature') as any;
      e.statusCode = 400;
      e.code = 'INVALID_SIGNATURE';
      throw e;
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.userId || session.client_reference_id;
        if (session.customer && userId) {
          await this.redis.set(`stripe:customer:${userId}`, session.customer);
          await this.redis.set(`stripe:user_by_customer:${session.customer}`, userId);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        let userId = sub.metadata?.userId;
        if (!userId && sub.customer) {
          userId = await this.redis.get(`stripe:user_by_customer:${sub.customer}`);
        }
        if (!userId && sub.customer) {
          const existingSub = await (this.prisma as any).subscription.findFirst({
            where: { stripeCustomerId: sub.customer },
            select: { userId: true },
          });
          userId = existingSub?.userId;
        }

        const tier = this.tierFromPriceId(sub.items?.data?.[0]?.price?.id);
        const periodStart = sub.current_period_start
          ? new Date(sub.current_period_start * 1000)
          : new Date();
        const periodEnd = sub.current_period_end
          ? new Date(sub.current_period_end * 1000)
          : new Date();

        const targetUserId = (userId && userId !== 'unknown') ? userId : (sub.metadata?.userId ?? 'unknown');

        await (this.prisma as any).subscription.upsert({
          where: targetUserId !== 'unknown' ? { userId: targetUserId } : { stripeSubscriptionId: sub.id },
          create: {
            userId: targetUserId,
            stripeSubscriptionId: sub.id,
            stripeCustomerId: sub.customer,
            tier,
            status: sub.status,
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
          },
          update: {
            stripeSubscriptionId: sub.id,
            stripeCustomerId: sub.customer,
            tier,
            status: sub.status,
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
          },
        });

        if (targetUserId !== 'unknown') {
          if (sub.status === 'active' || sub.status === 'trialing') {
            try {
              await (this.prisma as any).user.update({
                where: { id: targetUserId },
                data: { tier },
              });
            } catch {}
          }
          await this.redis.del(`user:profile:${targetUserId}`);
          await this.redis.del(`user:quota:${targetUserId}:conversions`);
          await this.redis.del(`user:quota:${targetUserId}:api_calls`);
          await this.redis.del(`user:quota:${targetUserId}:storage`);
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        let userId = sub.metadata?.userId;
        if (!userId && sub.customer) {
          userId = await this.redis.get(`stripe:user_by_customer:${sub.customer}`);
        }
        if (!userId) {
          const existingSub = await (this.prisma as any).subscription.findFirst({
            where: { stripeSubscriptionId: sub.id },
            select: { userId: true },
          });
          userId = existingSub?.userId;
        }

        await (this.prisma as any).subscription.updateMany({
          where: { stripeSubscriptionId: sub.id },
          data: { status: 'cancelled' },
        });

        if (userId && userId !== 'unknown') {
          try {
            await (this.prisma as any).user.update({
              where: { id: userId },
              data: { tier: 'free' },
            });
          } catch {}
          await this.redis.del(`user:profile:${userId}`);
          await this.redis.del(`user:quota:${userId}:conversions`);
          await this.redis.del(`user:quota:${userId}:api_calls`);
          await this.redis.del(`user:quota:${userId}:storage`);
        }
        break;
      }
      case 'invoice.payment_succeeded': {
        const inv = event.data.object;
        let userId = inv.metadata?.userId;
        if (!userId && inv.customer) {
          userId = await this.redis.get(`stripe:user_by_customer:${inv.customer}`);
        }
        if (!userId) {
          const existingSub = await (this.prisma as any).subscription.findFirst({
            where: { stripeCustomerId: inv.customer },
            select: { userId: true },
          });
          userId = existingSub?.userId ?? 'unknown';
        }
        await (this.prisma as any).invoice.create({
          data: {
            stripeInvoiceId: inv.id,
            userId,
            amount: inv.amount_paid,
            status: 'paid',
          },
        });
        break;
      }
      case 'invoice.payment_failed': {
        const inv = event.data.object;
        let userId = inv.metadata?.userId;
        if (!userId && inv.customer) {
          userId = await this.redis.get(`stripe:user_by_customer:${inv.customer}`);
        }
        if (!userId) {
          const existingSub = await (this.prisma as any).subscription.findFirst({
            where: { stripeCustomerId: inv.customer },
            select: { userId: true },
          });
          userId = existingSub?.userId ?? 'unknown';
        }
        await (this.prisma as any).invoice.create({
          data: {
            stripeInvoiceId: inv.id,
            userId,
            amount: inv.amount_due,
            status: 'failed',
          },
        });
        break;
      }
      // Unknown event types are silently ignored
    }
  }

  async getUsageSummary(userId: string): Promise<any> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const logs = await (this.prisma as any).usageLog.findMany({
      where: { userId, createdAt: { gte: startOfMonth } },
    });
    const conversions = logs
      .filter((l: any) => l.quotaType === 'conversions')
      .reduce((sum: number, l: any) => sum + l.amount, 0);
    return {
      userId,
      period: { start: startOfMonth.toISOString(), end: now.toISOString() },
      conversionsUsed: conversions,
    };
  }

  private tierFromPriceId(priceId: string): string {
    const env = getEnv();
    if (
      priceId === env.STRIPE_PRICE_PRO ||
      priceId === env.STRIPE_PRICE_PRO_MONTHLY ||
      priceId === env.STRIPE_PRICE_PRO_YEARLY
    ) {
      return 'pro';
    }
    if (
      priceId === env.STRIPE_PRICE_BUSINESS ||
      priceId === env.STRIPE_PRICE_BUSINESS_MONTHLY ||
      priceId === env.STRIPE_PRICE_BUSINESS_YEARLY
    ) {
      return 'business';
    }
    return 'free';
  }

  private async getStripeCustomerId(userId: string): Promise<string> {
    const cached = await this.redis.get(`stripe:customer:${userId}`);
    if (cached) return cached;

    try {
      const sub = await (this.prisma as any).subscription.findFirst({
        where: { userId },
      });
      if (sub?.stripeCustomerId) {
        await this.redis.set(`stripe:customer:${userId}`, sub.stripeCustomerId);
        return sub.stripeCustomerId;
      }
    } catch {}

    return `cus_mock_${userId}`;
  }
}
