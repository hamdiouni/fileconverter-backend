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
    const session = await this.stripe.checkout.sessions.create({
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
    });
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
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        await (this.prisma as any).subscription.upsert({
          where: { stripeSubscriptionId: sub.id },
          create: {
            userId: sub.metadata?.userId ?? 'unknown',
            stripeSubscriptionId: sub.id,
            stripeCustomerId: sub.customer,
            tier: this.tierFromPriceId(sub.items?.data?.[0]?.price?.id),
            status: sub.status,
          },
          update: {
            status: sub.status,
            tier: this.tierFromPriceId(sub.items?.data?.[0]?.price?.id),
          },
        });
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await (this.prisma as any).subscription.updateMany({
          where: { stripeSubscriptionId: sub.id },
          data: { status: 'cancelled' },
        });
        break;
      }
      case 'invoice.payment_succeeded': {
        const inv = event.data.object;
        await (this.prisma as any).invoice.create({
          data: {
            stripeInvoiceId: inv.id,
            userId: inv.metadata?.userId ?? 'unknown',
            amount: inv.amount_paid,
            status: 'paid',
          },
        });
        break;
      }
      case 'invoice.payment_failed': {
        const inv = event.data.object;
        await (this.prisma as any).invoice.create({
          data: {
            stripeInvoiceId: inv.id,
            userId: inv.metadata?.userId ?? 'unknown',
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
    return `cus_mock_${userId}`;
  }
}
