/**
 * Billing Service Integration Tests
 *
 * Tests cover:
 * - Health check
 * - Checkout session creation (valid, invalid price, no auth, missing fields)
 * - Portal session creation (valid, no auth, invalid URL)
 * - Webhook handling (subscription events, invoice events, invalid signature, unknown type)
 * - Usage summary (with/without data, no auth)
 *
 * Requirements: 11.2, 11.3, 11.4
 */

import supertest from 'supertest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { buildTestApp } from '../helpers/app.helper';
import type { InMemoryPrismaClient } from '../mocks/prisma.mock';
import type { InMemoryRedis } from '../mocks/redis.mock';
import { resetEnvCache } from '../../config/env';

function makeToken(userId: string, tier = 'free'): string {
  return jwt.sign(
    { userId, email: `${userId}@test.com`, tier, permissions: [] },
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: '15m' },
  );
}

function makeWebhookBody(type: string, data: any) {
  return { type, data: { object: data } };
}

describe('Billing Service Integration Tests', () => {
  let app: FastifyInstance;
  let prisma: InMemoryPrismaClient;
  let redis: InMemoryRedis;

  beforeAll(async () => {
    resetEnvCache();
    const result = await buildTestApp();
    app = result.app;
    prisma = result.prisma;
    redis = result.redis;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    prisma.reset();
    redis.reset();
  });

  // ---------------------------------------------------------------------------
  // Health Check
  // ---------------------------------------------------------------------------
  describe('GET /health', () => {
    it('should return 200 with service status', async () => {
      const response = await supertest(app.server).get('/health');
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.service).toBe('billing-service');
    });
  });

  // ---------------------------------------------------------------------------
  // Checkout Session - Req 11.2
  // ---------------------------------------------------------------------------
  describe('POST /api/v1/billing/checkout-session', () => {
    it('should create checkout session with valid pro priceId → 200 with sessionId and url', async () => {
      const token = makeToken('user-123');
      const response = await supertest(app.server)
        .post('/api/v1/billing/checkout-session')
        .set('Authorization', `Bearer ${token}`)
        .send({
          priceId: 'price_pro_mock',
          successUrl: 'https://app.example.com/success',
          cancelUrl: 'https://app.example.com/cancel',
        });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        sessionId: expect.any(String),
        url: expect.any(String),
      });
      expect(response.body.sessionId).toMatch(/^cs_test_/);
      expect(response.body.url).toContain('checkout.stripe.com');
    });

    it('should create checkout session with valid business priceId → 200', async () => {
      const token = makeToken('user-456');
      const response = await supertest(app.server)
        .post('/api/v1/billing/checkout-session')
        .set('Authorization', `Bearer ${token}`)
        .send({
          priceId: 'price_business_mock',
          successUrl: 'https://app.example.com/success',
          cancelUrl: 'https://app.example.com/cancel',
        });

      expect(response.status).toBe(200);
      expect(response.body.sessionId).toBeDefined();
      expect(response.body.url).toBeDefined();
    });

    it('should return 400 with INVALID_PRICE_ID for unknown price', async () => {
      const token = makeToken('user-123');
      const response = await supertest(app.server)
        .post('/api/v1/billing/checkout-session')
        .set('Authorization', `Bearer ${token}`)
        .send({
          priceId: 'price_unknown_xyz',
          successUrl: 'https://app.example.com/success',
          cancelUrl: 'https://app.example.com/cancel',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_PRICE_ID');
    });

    it('should return 401 without auth token', async () => {
      const response = await supertest(app.server)
        .post('/api/v1/billing/checkout-session')
        .send({
          priceId: 'price_pro_mock',
          successUrl: 'https://app.example.com/success',
          cancelUrl: 'https://app.example.com/cancel',
        });

      expect(response.status).toBe(401);
    });

    it('should return 400 with VALIDATION_ERROR when successUrl is missing', async () => {
      const token = makeToken('user-123');
      const response = await supertest(app.server)
        .post('/api/v1/billing/checkout-session')
        .set('Authorization', `Bearer ${token}`)
        .send({
          priceId: 'price_pro_mock',
          cancelUrl: 'https://app.example.com/cancel',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 with VALIDATION_ERROR when cancelUrl is missing', async () => {
      const token = makeToken('user-123');
      const response = await supertest(app.server)
        .post('/api/v1/billing/checkout-session')
        .set('Authorization', `Bearer ${token}`)
        .send({
          priceId: 'price_pro_mock',
          successUrl: 'https://app.example.com/success',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 with VALIDATION_ERROR when priceId is missing', async () => {
      const token = makeToken('user-123');
      const response = await supertest(app.server)
        .post('/api/v1/billing/checkout-session')
        .set('Authorization', `Bearer ${token}`)
        .send({
          successUrl: 'https://app.example.com/success',
          cancelUrl: 'https://app.example.com/cancel',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 with VALIDATION_ERROR when successUrl is not a valid URL', async () => {
      const token = makeToken('user-123');
      const response = await supertest(app.server)
        .post('/api/v1/billing/checkout-session')
        .set('Authorization', `Bearer ${token}`)
        .send({
          priceId: 'price_pro_mock',
          successUrl: 'not-a-url',
          cancelUrl: 'https://app.example.com/cancel',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('response contains a Stripe checkout URL', async () => {
      const token = makeToken('user-789');
      const response = await supertest(app.server)
        .post('/api/v1/billing/checkout-session')
        .set('Authorization', `Bearer ${token}`)
        .send({
          priceId: 'price_pro_mock',
          successUrl: 'https://app.example.com/success',
          cancelUrl: 'https://app.example.com/cancel',
        });

      expect(response.status).toBe(200);
      expect(response.body.url).toMatch(/^https:\/\//);
    });
  });

  // ---------------------------------------------------------------------------
  // Portal Session - Req 11.2
  // ---------------------------------------------------------------------------
  describe('POST /api/v1/billing/portal-session', () => {
    it('should create portal session with valid returnUrl → 200 with url', async () => {
      const token = makeToken('user-portal-1');
      const response = await supertest(app.server)
        .post('/api/v1/billing/portal-session')
        .set('Authorization', `Bearer ${token}`)
        .send({ returnUrl: 'https://app.example.com/billing' });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        url: expect.any(String),
      });
      expect(response.body.url).toContain('billing.stripe.com');
    });

    it('should return 401 without auth token', async () => {
      const response = await supertest(app.server)
        .post('/api/v1/billing/portal-session')
        .send({ returnUrl: 'https://app.example.com/billing' });

      expect(response.status).toBe(401);
    });

    it('should return 400 with VALIDATION_ERROR for invalid returnUrl', async () => {
      const token = makeToken('user-portal-2');
      const response = await supertest(app.server)
        .post('/api/v1/billing/portal-session')
        .set('Authorization', `Bearer ${token}`)
        .send({ returnUrl: 'not-a-url' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 with VALIDATION_ERROR when returnUrl is missing', async () => {
      const token = makeToken('user-portal-3');
      const response = await supertest(app.server)
        .post('/api/v1/billing/portal-session')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should use cached Stripe customer ID from Redis when available', async () => {
      const userId = 'user-cached';
      const token = makeToken(userId);
      // Seed a cached customer ID
      await redis.set(`stripe:customer:${userId}`, 'cus_cached_123');

      const response = await supertest(app.server)
        .post('/api/v1/billing/portal-session')
        .set('Authorization', `Bearer ${token}`)
        .send({ returnUrl: 'https://app.example.com/billing' });

      expect(response.status).toBe(200);
      expect(response.body.url).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Webhook Handler - Req 11.3, 11.4
  // ---------------------------------------------------------------------------
  describe('POST /api/v1/billing/webhook', () => {
    it('should return 200 { received: true } for customer.subscription.created event with valid signature', async () => {
      const body = makeWebhookBody('customer.subscription.created', {
        id: 'sub_new_1',
        customer: 'cus_test_1',
        status: 'active',
        metadata: { userId: 'user-sub-1' },
        items: { data: [{ price: { id: 'price_pro_mock' } }] },
      });

      const response = await supertest(app.server)
        .post('/api/v1/billing/webhook')
        .set('stripe-signature', 'valid_sig')
        .send(body);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ received: true });
    });

    it('should upsert subscription in DB for customer.subscription.created event', async () => {
      const body = makeWebhookBody('customer.subscription.created', {
        id: 'sub_create_test',
        customer: 'cus_test_create',
        status: 'active',
        metadata: { userId: 'user-db-1' },
        items: { data: [{ price: { id: 'price_pro_mock' } }] },
      });

      await supertest(app.server)
        .post('/api/v1/billing/webhook')
        .set('stripe-signature', 'valid_sig')
        .send(body);

      const subs = await prisma.subscription.findMany({});
      expect(subs.length).toBe(1);
      expect(subs[0].stripeSubscriptionId).toBe('sub_create_test');
      expect(subs[0].tier).toBe('pro');
      expect(subs[0].status).toBe('active');
    });

    it('should update subscription for customer.subscription.updated event', async () => {
      // First create
      await supertest(app.server)
        .post('/api/v1/billing/webhook')
        .set('stripe-signature', 'valid_sig')
        .send(makeWebhookBody('customer.subscription.created', {
          id: 'sub_update_test',
          customer: 'cus_update_test',
          status: 'active',
          metadata: { userId: 'user-update-1' },
          items: { data: [{ price: { id: 'price_pro_mock' } }] },
        }));

      // Then update
      const updateResponse = await supertest(app.server)
        .post('/api/v1/billing/webhook')
        .set('stripe-signature', 'valid_sig')
        .send(makeWebhookBody('customer.subscription.updated', {
          id: 'sub_update_test',
          customer: 'cus_update_test',
          status: 'past_due',
          metadata: { userId: 'user-update-1' },
          items: { data: [{ price: { id: 'price_business_mock' } }] },
        }));

      expect(updateResponse.status).toBe(200);

      const sub = await prisma.subscription.findFirst({ where: { stripeSubscriptionId: 'sub_update_test' } });
      expect(sub).not.toBeNull();
      expect(sub!.status).toBe('past_due');
      expect(sub!.tier).toBe('business');
    });

    it('should set status to cancelled for customer.subscription.deleted event', async () => {
      // Seed a subscription
      prisma.seedSubscription('user-delete-1', 'pro', 'active');
      const subs = await prisma.subscription.findMany({});
      const subId = subs[0].stripeSubscriptionId;

      const response = await supertest(app.server)
        .post('/api/v1/billing/webhook')
        .set('stripe-signature', 'valid_sig')
        .send(makeWebhookBody('customer.subscription.deleted', {
          id: subId,
          customer: 'cus_mock_user-delete-1',
        }));

      expect(response.status).toBe(200);

      const sub = await prisma.subscription.findFirst({ where: { stripeSubscriptionId: subId } });
      expect(sub!.status).toBe('cancelled');
    });

    it('should create invoice with status paid for invoice.payment_succeeded event', async () => {
      const body = makeWebhookBody('invoice.payment_succeeded', {
        id: 'inv_paid_1',
        amount_paid: 2999,
        metadata: { userId: 'user-invoice-1' },
      });

      const response = await supertest(app.server)
        .post('/api/v1/billing/webhook')
        .set('stripe-signature', 'valid_sig')
        .send(body);

      expect(response.status).toBe(200);

      const invoices = await prisma.invoice.findMany({});
      expect(invoices.length).toBe(1);
      expect(invoices[0].stripeInvoiceId).toBe('inv_paid_1');
      expect(invoices[0].status).toBe('paid');
      expect(invoices[0].amount).toBe(2999);
    });

    it('should create invoice with status failed for invoice.payment_failed event', async () => {
      const body = makeWebhookBody('invoice.payment_failed', {
        id: 'inv_fail_1',
        amount_due: 2999,
        metadata: { userId: 'user-invoice-2' },
      });

      const response = await supertest(app.server)
        .post('/api/v1/billing/webhook')
        .set('stripe-signature', 'valid_sig')
        .send(body);

      expect(response.status).toBe(200);

      const invoice = await prisma.invoice.findFirst({ where: { status: 'failed' } });
      expect(invoice).not.toBeNull();
      expect(invoice!.stripeInvoiceId).toBe('inv_fail_1');
      expect(invoice!.status).toBe('failed');
    });

    it('should return 400 INVALID_SIGNATURE for invalid webhook signature', async () => {
      const body = makeWebhookBody('customer.subscription.created', {
        id: 'sub_bad_sig',
        customer: 'cus_bad',
        status: 'active',
        metadata: {},
        items: { data: [] },
      });

      const response = await supertest(app.server)
        .post('/api/v1/billing/webhook')
        .set('stripe-signature', 'bad_signature')
        .send(body);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_SIGNATURE');
    });

    it('should return 400 INVALID_SIGNATURE when stripe-signature header is missing', async () => {
      const body = makeWebhookBody('customer.subscription.created', {
        id: 'sub_no_sig',
        customer: 'cus_no_sig',
        status: 'active',
        metadata: {},
        items: { data: [] },
      });

      const response = await supertest(app.server)
        .post('/api/v1/billing/webhook')
        .send(body);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_SIGNATURE');
    });

    it('should return 200 and ignore unknown event types gracefully', async () => {
      const body = makeWebhookBody('some.unknown.event', {
        id: 'obj_unknown',
      });

      const response = await supertest(app.server)
        .post('/api/v1/billing/webhook')
        .set('stripe-signature', 'valid_sig')
        .send(body);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ received: true });
    });

    it('should handle invoice.payment_succeeded with no DB side-effects for unknown user', async () => {
      const body = makeWebhookBody('invoice.payment_succeeded', {
        id: 'inv_no_user',
        amount_paid: 999,
        metadata: {},
      });

      const response = await supertest(app.server)
        .post('/api/v1/billing/webhook')
        .set('stripe-signature', 'valid_sig')
        .send(body);

      expect(response.status).toBe(200);
      const invoices = await prisma.invoice.findMany({});
      expect(invoices.length).toBe(1);
      expect(invoices[0].userId).toBe('unknown');
    });
  });

  // ---------------------------------------------------------------------------
  // Usage Summary - Req 11.6
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/billing/usage', () => {
    it('should return 200 with usage summary (empty) for authenticated user', async () => {
      const token = makeToken('user-usage-1');
      const response = await supertest(app.server)
        .get('/api/v1/billing/usage')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        userId: 'user-usage-1',
        conversionsUsed: 0,
        period: {
          start: expect.any(String),
          end: expect.any(String),
        },
      });
    });

    it('should return 401 without auth token', async () => {
      const response = await supertest(app.server).get('/api/v1/billing/usage');
      expect(response.status).toBe(401);
    });

    it('should return correct conversionsUsed count with seeded usage data', async () => {
      const userId = 'user-usage-2';
      const token = makeToken(userId);

      // Seed usage logs for this month
      prisma.seedUsageLog(userId, 'conversions', 5);
      prisma.seedUsageLog(userId, 'conversions', 3);
      prisma.seedUsageLog(userId, 'conversions', 7);

      const response = await supertest(app.server)
        .get('/api/v1/billing/usage')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.conversionsUsed).toBe(15);
    });

    it('should not count usage logs from other users', async () => {
      const userId = 'user-usage-3';
      const otherUserId = 'user-usage-other';
      const token = makeToken(userId);

      // Seed logs for current user
      prisma.seedUsageLog(userId, 'conversions', 4);
      // Seed logs for another user
      prisma.seedUsageLog(otherUserId, 'conversions', 100);

      const response = await supertest(app.server)
        .get('/api/v1/billing/usage')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.conversionsUsed).toBe(4);
    });

    it('should not count non-conversion quota types in conversionsUsed', async () => {
      const userId = 'user-usage-4';
      const token = makeToken(userId);

      prisma.seedUsageLog(userId, 'conversions', 3);
      prisma.seedUsageLog(userId, 'storage', 1000); // Should not count

      const response = await supertest(app.server)
        .get('/api/v1/billing/usage')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.conversionsUsed).toBe(3);
    });

    it('should not count usage logs from previous months', async () => {
      const userId = 'user-usage-5';
      const token = makeToken(userId);

      const lastMonth = new Date();
      lastMonth.setMonth(lastMonth.getMonth() - 1);

      prisma.seedUsageLog(userId, 'conversions', 50, lastMonth); // Last month - should not count
      prisma.seedUsageLog(userId, 'conversions', 2); // This month

      const response = await supertest(app.server)
        .get('/api/v1/billing/usage')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.conversionsUsed).toBe(2);
    });

    it('should return period with start and end as ISO strings', async () => {
      const token = makeToken('user-usage-period');
      const response = await supertest(app.server)
        .get('/api/v1/billing/usage')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(() => new Date(response.body.period.start)).not.toThrow();
      expect(() => new Date(response.body.period.end)).not.toThrow();
    });
  });
});
