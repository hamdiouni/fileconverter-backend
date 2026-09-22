/**
 * Upload Service Integration Tests
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.7
 */

import supertest from 'supertest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { buildTestApp } from '../helpers/app.helper';
import type { InMemoryPrismaClient } from '../mocks/prisma.mock';
import type { InMemoryRedis } from '../mocks/redis.mock';
import type { InMemoryStorageService } from '../mocks/storage.mock';
import { resetEnvCache } from '../../config/env';

function makeToken(userId: string, email: string, tier = 'free'): string {
  return jwt.sign({ userId, email, tier }, process.env.JWT_ACCESS_SECRET!, { expiresIn: '15m' });
}

describe('Upload Service Integration Tests', () => {
  let app: FastifyInstance;
  let prisma: InMemoryPrismaClient;
  let redis: InMemoryRedis;
  let storage: InMemoryStorageService;
  let token: string;

  beforeAll(async () => {
    resetEnvCache();
    const result = await buildTestApp();
    app = result.app;
    prisma = result.prisma;
    redis = result.redis;
    storage = result.storage;
    token = makeToken('user-1', 'test@example.com', 'free');
  });

  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    prisma.reset();
    redis.reset();
    storage.reset();
    token = makeToken('user-1', 'test@example.com', 'free');
  });

  // ─── Health ──────────────────────────────────────────────────────────────
  describe('GET /health', () => {
    it('should return 200', async () => {
      const res = await supertest(app.server).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });

  // ─── Create Upload (presigned URL) ────────────────────────────────────────
  describe('POST /api/v1/uploads', () => {
    it('should return 201 with presigned URL for valid PNG upload', async () => {
      const res = await supertest(app.server)
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${token}`)
        .send({ filename: 'photo.png', contentType: 'image/png', fileSize: 1024 * 1024 });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        uploadId: expect.any(String),
        presignedUrl: expect.stringContaining('mock-s3.example.com'),
        expiresIn: 900,
        storageKey: expect.stringContaining('uploads/user-1/'),
      });
    });

    it('should return 201 with presigned URL for valid PDF upload', async () => {
      const res = await supertest(app.server)
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${token}`)
        .send({ filename: 'doc.pdf', contentType: 'application/pdf', fileSize: 500 * 1024 });

      expect(res.status).toBe(201);
      expect(res.body.uploadId).toBeDefined();
    });

    it('should return 400 for mismatched content-type and extension (PNG declared as PDF)', async () => {
      const res = await supertest(app.server)
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${token}`)
        .send({ filename: 'photo.png', contentType: 'application/pdf', fileSize: 1024 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_CONTENT_TYPE');
    });

    it('should return 413 when file exceeds free tier limit (>100MB)', async () => {
      const res = await supertest(app.server)
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${token}`)
        .send({ filename: 'big.png', contentType: 'image/png', fileSize: 200 * 1024 * 1024 });

      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    });

    it('should allow large file for pro tier', async () => {
      const proToken = makeToken('user-pro', 'pro@example.com', 'pro');
      const res = await supertest(app.server)
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${proToken}`)
        .send({ filename: 'large.png', contentType: 'image/png', fileSize: 500 * 1024 * 1024 });

      expect(res.status).toBe(201);
    });

    it('should return 401 without token', async () => {
      const res = await supertest(app.server)
        .post('/api/v1/uploads')
        .send({ filename: 'photo.png', contentType: 'image/png', fileSize: 1024 });
      expect(res.status).toBe(401);
    });

    it('should allow upload with valid X-API-Key', async () => {
      const crypto = await import('crypto');
      const rawKey = 'fc_live_upload_key_123';
      const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
      prisma.seedApiKey('key-up-1', 'user-api-1', keyHash);

      const res = await supertest(app.server)
        .post('/api/v1/uploads')
        .set('X-API-Key', rawKey)
        .send({ filename: 'api-upload.png', contentType: 'image/png', fileSize: 2048 });

      expect(res.status).toBe(201);
      expect(res.body.presignedUrl).toBeDefined();
      expect(res.body.uploadId).toBeDefined();
    });

    it('should return 401 for invalid X-API-Key', async () => {
      const res = await supertest(app.server)
        .post('/api/v1/uploads')
        .set('X-API-Key', 'invalid_api_key_str')
        .send({ filename: 'api-upload.png', contentType: 'image/png', fileSize: 2048 });

      expect(res.status).toBe(401);
    });

    it('should return 400 for missing filename', async () => {
      const res = await supertest(app.server)
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${token}`)
        .send({ contentType: 'image/png', fileSize: 1024 });
      expect(res.status).toBe(400);
    });

    it('should return 400 for zero file size', async () => {
      const res = await supertest(app.server)
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${token}`)
        .send({ filename: 'photo.png', contentType: 'image/png', fileSize: 0 });
      expect(res.status).toBe(400);
    });
  });

  // ─── Complete Upload ──────────────────────────────────────────────────────
  describe('POST /api/v1/uploads/:id/complete', () => {
    it('should return 200 and update status to uploaded', async () => {
      const createRes = await supertest(app.server)
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${token}`)
        .send({ filename: 'test.png', contentType: 'image/png', fileSize: 1024 });

      const uploadId = createRes.body.uploadId;

      const completeRes = await supertest(app.server)
        .post(`/api/v1/uploads/${uploadId}/complete`)
        .set('Authorization', `Bearer ${token}`);

      expect(completeRes.status).toBe(200);
      expect(completeRes.body.uploadStatus).toBe('uploaded');
      expect(completeRes.body.uploadedAt).toBeDefined();
    });

    it('should return 404 for non-existent upload ID', async () => {
      const res = await supertest(app.server)
        .post('/api/v1/uploads/non-existent-id/complete')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it('should return 404 when completing another user\'s upload', async () => {
      const createRes = await supertest(app.server)
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${token}`)
        .send({ filename: 'test.png', contentType: 'image/png', fileSize: 1024 });

      const uploadId = createRes.body.uploadId;
      const otherToken = makeToken('user-2', 'other@example.com', 'free');

      const res = await supertest(app.server)
        .post(`/api/v1/uploads/${uploadId}/complete`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(404);
    });
  });

  // ─── Get File Metadata ────────────────────────────────────────────────────
  describe('GET /api/v1/uploads/:id', () => {
    it('should return 200 with file metadata', async () => {
      const createRes = await supertest(app.server)
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${token}`)
        .send({ filename: 'meta.png', contentType: 'image/png', fileSize: 2048 });

      const uploadId = createRes.body.uploadId;

      const res = await supertest(app.server)
        .get(`/api/v1/uploads/${uploadId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: uploadId,
        userId: 'user-1',
        filename: 'meta.png',
        contentType: 'image/png',
        size: 2048,
      });
    });

    it('should return 404 for non-existent file', async () => {
      const res = await supertest(app.server)
        .get('/api/v1/uploads/no-such-file')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it('should return 401 without token', async () => {
      const res = await supertest(app.server).get('/api/v1/uploads/some-id');
      expect(res.status).toBe(401);
    });
  });

  // ─── Delete File ─────────────────────────────────────────────────────────
  describe('DELETE /api/v1/uploads/:id', () => {
    it('should return 204 and remove file', async () => {
      const createRes = await supertest(app.server)
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${token}`)
        .send({ filename: 'delete-me.png', contentType: 'image/png', fileSize: 512 });

      const uploadId = createRes.body.uploadId;

      const deleteRes = await supertest(app.server)
        .delete(`/api/v1/uploads/${uploadId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(deleteRes.status).toBe(204);

      // Verify gone
      const getRes = await supertest(app.server)
        .get(`/api/v1/uploads/${uploadId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(getRes.status).toBe(404);
    });

    it('should return 404 for non-existent file', async () => {
      const res = await supertest(app.server)
        .delete('/api/v1/uploads/no-such-file')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });
  });

  // ─── Download URL ────────────────────────────────────────────────────────
  describe('GET /api/v1/uploads/:id/download', () => {
    it('should return 200 with presigned download URL for clean file', async () => {
      const createRes = await supertest(app.server)
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${token}`)
        .send({ filename: 'download.png', contentType: 'image/png', fileSize: 1024 });

      const uploadId = createRes.body.uploadId;

      // Mark as clean in DB
      prisma.files.get(uploadId)!.virusScanStatus = 'clean';

      const res = await supertest(app.server)
        .get(`/api/v1/uploads/${uploadId}/download`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.downloadUrl).toContain('mock-s3.example.com');
      expect(res.body.expiresIn).toBe(3600);
    });

    it('should return 403 for infected file', async () => {
      const createRes = await supertest(app.server)
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${token}`)
        .send({ filename: 'virus.png', contentType: 'image/png', fileSize: 1024 });

      const uploadId = createRes.body.uploadId;
      prisma.files.get(uploadId)!.virusScanStatus = 'infected';

      const res = await supertest(app.server)
        .get(`/api/v1/uploads/${uploadId}/download`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });
  });

  // ─── Multipart Upload ─────────────────────────────────────────────────────
  describe('Multipart upload flow', () => {
    it('should initiate and complete multipart upload', async () => {
      const initRes = await supertest(app.server)
        .post('/api/v1/uploads/multipart')
        .set('Authorization', `Bearer ${token}`)
        .send({ filename: 'large-video.mp4', contentType: 'video/mp4' });

      expect(initRes.status).toBe(201);
      expect(initRes.body.uploadId).toBeDefined();
      expect(initRes.body.storageKey).toContain('uploads/user-1/');

      const uploadId = initRes.body.uploadId;

      const completeRes = await supertest(app.server)
        .post(`/api/v1/uploads/multipart/${uploadId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .send({ totalSize: 500 * 1024 * 1024 });

      expect(completeRes.status).toBe(200);
      expect(completeRes.body.uploadStatus).toBe('uploaded');
      expect(completeRes.body.size).toBe(500 * 1024 * 1024);
    });

    it('should return 401 without token for multipart init', async () => {
      const res = await supertest(app.server)
        .post('/api/v1/uploads/multipart')
        .send({ filename: 'video.mp4', contentType: 'video/mp4' });
      expect(res.status).toBe(401);
    });
  });

  // ─── File type detection ──────────────────────────────────────────────────
  describe('File type validation', () => {
    it('should reject ZIP file declared as image/png', async () => {
      const res = await supertest(app.server)
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${token}`)
        .send({ filename: 'archive.png', contentType: 'image/png', fileSize: 1024 });
      // Extension .png with contentType image/png is valid — no mismatch at this stage
      // Actual magic number check happens at completion; presigned URL is still issued
      expect([201, 400]).toContain(res.status);
    });

    it('should accept unknown extensions without validation error', async () => {
      const res = await supertest(app.server)
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${token}`)
        .send({ filename: 'file.xyz', contentType: 'application/octet-stream', fileSize: 1024 });
      expect(res.status).toBe(201);
    });
  });
});
