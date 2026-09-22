import supertest from 'supertest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { buildTestApp } from '../helpers/app.helper';
import type { InMemoryPrismaClient } from '../mocks/prisma.mock';
import type { InMemoryRedis } from '../mocks/redis.mock';
import { resetEnvCache, getEnv } from '../../config/env';

describe('Google OAuth Internal Route Tests (POST /internal/auth/google)', () => {
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

  it('creates a new user and returns FileConverter JWTs for valid Google profile', async () => {
    const response = await supertest(app.server)
      .post('/internal/auth/google')
      .send({
        googleId: '10987654321',
        email: 'googler@example.com',
        name: 'Google User',
        avatarUrl: 'https://example.com/photo.jpg',
      });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('accessToken');
    expect(response.body).toHaveProperty('refreshToken');
    expect(response.body).toHaveProperty('expiresIn');
    expect(response.body.user).toEqual({
      id: expect.any(String),
      email: 'googler@example.com',
    });

    // Verify the JWT was signed with the FileConverter JWT secret, NOT a raw Google token
    const env = getEnv();
    const decoded = jwt.verify(response.body.accessToken, env.JWT_ACCESS_SECRET) as any;
    expect(decoded.userId).toBe(response.body.user.id);
    expect(decoded.email).toBe('googler@example.com');
  });

  it('links to existing user account if email matches', async () => {
    // Pre-create user with password
    const existing = await prisma.user.create({
      data: { email: 'existing@example.com', passwordHash: 'hash123' },
    });

    const response = await supertest(app.server)
      .post('/internal/auth/google')
      .send({
        googleId: 'google-uid-999',
        email: 'existing@example.com',
        name: 'Existing Account',
      });

    expect(response.status).toBe(200);
    expect(response.body.user.id).toBe(existing.id);

    // Verify user in DB now has oauth Provider set
    const updated = await prisma.user.findUnique({ where: { id: existing.id } });
    expect(updated?.oauthProvider).toBe('google');
    expect(updated?.oauthId).toBe('google-uid-999');
  });

  it('returns 400 when missing required fields', async () => {
    const response = await supertest(app.server)
      .post('/internal/auth/google')
      .send({
        name: 'Missing Id and Email',
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
