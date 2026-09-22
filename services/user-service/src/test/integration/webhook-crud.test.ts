import supertest from 'supertest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { buildTestApp } from '../helpers/app.helper';
import type { InMemoryPrismaClient } from '../mocks/prisma.mock';
import type { InMemoryRedis } from '../mocks/redis.mock';
import { resetEnvCache } from '../../config/env';

function makeToken(userId: string, email: string, tier = 'free'): string {
  return jwt.sign(
    { userId, email, tier },
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: '15m' },
  );
}

describe('Webhook CRUD Integration Tests (/api/v1/webhooks)', () => {
  let app: FastifyInstance;
  let prisma: InMemoryPrismaClient;
  let redis: InMemoryRedis;
  let tokenUser1: string;
  let tokenUser2: string;

  beforeAll(async () => {
    resetEnvCache();
    const result = await buildTestApp();
    app = result.app;
    prisma = result.prisma;
    redis = result.redis;
    tokenUser1 = makeToken('user-1', 'user1@example.com', 'pro');
    tokenUser2 = makeToken('user-2', 'user2@example.com', 'pro');
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    prisma.reset();
    redis.reset();
    prisma.seedUser('user-1', 'user1@example.com', 'pro');
    prisma.seedUser('user-2', 'user2@example.com', 'pro');
  });

  it('creates, lists, and deletes a webhook endpoint', async () => {
    // 1. Create
    const createRes = await supertest(app.server)
      .post('/api/v1/webhooks')
      .set('Authorization', `Bearer ${tokenUser1}`)
      .send({
        url: 'https://example.com/webhooks/conversion',
        events: ['conversion.completed', 'conversion.failed'],
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body).toHaveProperty('id');
    expect(createRes.body.url).toBe('https://example.com/webhooks/conversion');
    expect(createRes.body.events).toEqual(['conversion.completed', 'conversion.failed']);
    expect(createRes.body.secret).toMatch(/^whsec_/);

    const hookId = createRes.body.id;

    // 2. List
    const listRes = await supertest(app.server)
      .get('/api/v1/webhooks')
      .set('Authorization', `Bearer ${tokenUser1}`);

    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body)).toBe(true);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].id).toBe(hookId);

    // 3. User 2 cannot see User 1's webhook
    const user2List = await supertest(app.server)
      .get('/api/v1/webhooks')
      .set('Authorization', `Bearer ${tokenUser2}`);

    expect(user2List.status).toBe(200);
    expect(user2List.body).toHaveLength(0);

    // 4. User 2 cannot delete User 1's webhook
    const unauthorizedDelete = await supertest(app.server)
      .delete(`/api/v1/webhooks/${hookId}`)
      .set('Authorization', `Bearer ${tokenUser2}`);

    expect(unauthorizedDelete.status).toBe(404);

    // 5. Delete by owner
    const deleteRes = await supertest(app.server)
      .delete(`/api/v1/webhooks/${hookId}`)
      .set('Authorization', `Bearer ${tokenUser1}`);

    expect(deleteRes.status).toBe(204);

    // 6. Verify deleted
    const finalList = await supertest(app.server)
      .get('/api/v1/webhooks')
      .set('Authorization', `Bearer ${tokenUser1}`);

    expect(finalList.body).toHaveLength(0);
  });

  it('rejects invalid webhook URLs or empty events', async () => {
    const res1 = await supertest(app.server)
      .post('/api/v1/webhooks')
      .set('Authorization', `Bearer ${tokenUser1}`)
      .send({
        url: 'not-a-url',
        events: ['conversion.completed'],
      });

    expect(res1.status).toBe(400);

    const res2 = await supertest(app.server)
      .post('/api/v1/webhooks')
      .set('Authorization', `Bearer ${tokenUser1}`)
      .send({
        url: 'https://valid.com/hook',
        events: [],
      });

    expect(res2.status).toBe(400);
  });
});
