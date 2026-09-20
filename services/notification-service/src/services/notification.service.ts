import crypto from 'crypto';
import type { PrismaClient } from '@prisma/client';
import type IORedis from 'ioredis';
import { getEnv } from '../config/env';

// HTTP client factory — injected for testability
let httpClient: any = null;
export function setHttpClient(client: any) { httpClient = client; }
export function getHttpClient(): any {
  if (httpClient) return httpClient;
  const axios = require('axios');
  httpClient = axios;
  return httpClient;
}

// Email client factory — injected for testability
let emailClient: any = null;
export function setEmailClient(client: any) { emailClient = client; }
export function getEmailClient(): any {
  if (emailClient) return emailClient;
  return { send: async () => {} };
}

export interface WebhookPayload {
  jobId: string;
  status: string;
  resultFileId?: string;
  errorMessage?: string;
  userId: string;
}

export function generateHmacSignature(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export class NotificationService {
  constructor(private prisma: PrismaClient, private redis: IORedis) {}

  async sendWebhook(
    webhookUrl: string,
    payload: WebhookPayload,
    maxRetries = 3,
  ): Promise<{ success: boolean; attempts: number; statusCode?: number }> {
    const env = getEnv();
    const body = JSON.stringify(payload);
    const signature = generateHmacSignature(body, env.WEBHOOK_HMAC_SECRET);
    const http = getHttpClient();

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await http.post(webhookUrl, body, {
          headers: { 'Content-Type': 'application/json', 'X-Signature': `sha256=${signature}` },
          timeout: 10000,
        });
        await this.recordDelivery(payload.jobId, webhookUrl, attempt, response.status, 'delivered');
        return { success: true, attempts: attempt, statusCode: response.status };
      } catch (err: any) {
        const statusCode = err.response?.status;
        if (attempt === maxRetries) {
          await this.recordDelivery(payload.jobId, webhookUrl, attempt, statusCode, 'failed');
          return { success: false, attempts: attempt, statusCode };
        }
        // Exponential backoff (mocked in tests via jest.useFakeTimers)
        await new Promise((r) => setTimeout(r, Math.pow(4, attempt - 1) * 100));
      }
    }
    return { success: false, attempts: maxRetries };
  }

  async sendEmail(
    to: string,
    subject: string,
    body: string,
    type: 'completion' | 'failure',
  ): Promise<void> {
    const emailSvc = getEmailClient();
    await emailSvc.send({ to, subject, html: body, from: 'noreply@fileconverter.pro' });
    await (this.prisma as any).emailDelivery.create({
      data: { to, subject, type, status: 'sent', sentAt: new Date() },
    });
  }

  async getWebhookDeliveries(jobId: string): Promise<any[]> {
    return (this.prisma as any).webhookDelivery.findMany({
      where: { jobId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async batchNotifications(
    userId: string,
    notification: { jobId: string; type: string; message: string },
  ): Promise<void> {
    const batchKey = `notification:batch:${userId}`;
    const existing = await this.redis.get(batchKey);
    const batch = existing ? JSON.parse(existing) : [];
    batch.push({ ...notification, timestamp: Date.now() });
    await this.redis.setex(batchKey, 300, JSON.stringify(batch)); // 5 min TTL
  }

  async flushBatch(userId: string): Promise<any[]> {
    const batchKey = `notification:batch:${userId}`;
    const existing = await this.redis.get(batchKey);
    if (!existing) return [];
    const batch = JSON.parse(existing);
    await this.redis.del(batchKey);
    return batch;
  }

  private async recordDelivery(
    jobId: string,
    url: string,
    attempt: number,
    statusCode: number | undefined,
    status: string,
  ): Promise<void> {
    await (this.prisma as any).webhookDelivery.create({
      data: { jobId, url, attempt, statusCode: statusCode ?? 0, status, createdAt: new Date() },
    });
  }
}
