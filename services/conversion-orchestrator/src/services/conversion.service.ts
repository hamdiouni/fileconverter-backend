import type { PrismaClient } from '@prisma/client';
import type IORedis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { QueueProducer, type FormatFamily as QueueFormatFamily } from '../queue/producer';
import { getEnv } from '../config/env';

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type FormatFamily = 'image' | 'video' | 'audio' | 'document' | 'archive' | 'cad' | 'font';

export interface ConversionOptions {
  quality?: number;
  width?: number;
  height?: number;
  preserveMetadata?: boolean;
  codec?: string;
  bitrate?: string;
  pages?: string;
  [key: string]: any;
}

export interface ConversionJob {
  id: string;
  userId: string;
  sourceFileId: string;
  sourceFormat: string;
  targetFormat: string;
  status: JobStatus;
  options: ConversionOptions;
  formatFamily: FormatFamily;
  resultFileId: string | null;
  errorMessage: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface QuotaCheckResult {
  allowed: boolean;
  remaining: number;
}

export interface PaginatedJobs {
  data: ConversionJob[];
  total: number;
  page: number;
  pageSize: number;
}

export interface JobFilters {
  status?: JobStatus;
  page?: number;
  pageSize?: number;
}

export {
  VALID_CONVERSIONS,
  FORMAT_FAMILIES,
  isValidConversion,
  getFormatFamily,
} from '../config/format-registry';

import {
  VALID_CONVERSIONS,
  FORMAT_FAMILIES,
  isValidConversion,
  getFormatFamily,
} from '../config/format-registry';

/**
 * Free tier monthly conversion limit
 */
const FREE_TIER_MONTHLY_LIMIT = 100;

export class ConversionService {
  private queueProducer: QueueProducer;

  constructor(
    private prisma: PrismaClient,
    private redis: IORedis,
  ) {
    this.queueProducer = new QueueProducer(redis);
  }

  /**
   * Submit a new conversion job.
   * Handles idempotency key deduplication and quota checking.
   * Requirements: 5.1, 5.2, 5.4, 5.5, 5.6
   */
  async submitJob(
    userId: string,
    sourceFileId: string,
    targetFormat: string,
    options?: ConversionOptions,
    idempotencyKey?: string,
  ): Promise<{ job: ConversionJob; fromCache?: boolean; fromIdempotency?: boolean }> {
    const normalizedTarget = targetFormat.toLowerCase().trim();

    // Determine source format from a pseudo file lookup (sourceFileId encodes format in tests)
    // In production this would look up the file record; for the integration layer
    // we derive source format from a Redis/DB lookup or accept it via options.
    const sourceFormat = await this.resolveSourceFormat(sourceFileId);

    // Validate conversion pair
    if (!isValidConversion(sourceFormat, normalizedTarget)) {
      const err = new Error(
        `Unsupported conversion: ${sourceFormat} → ${normalizedTarget}`,
      ) as Error & { statusCode: number; code: string };
      err.statusCode = 400;
      err.code = 'INVALID_FORMAT_PAIR';
      throw err;
    }

    // Check idempotency key
    if (idempotencyKey) {
      const existing = await (this.prisma as any).conversionJob.findFirst({
        where: { userId, idempotencyKey },
      });
      if (existing) {
        return { job: existing as ConversionJob, fromIdempotency: true };
      }
    }

    // Check cache hit
    const cacheKey = this.buildCacheKey(sourceFileId, normalizedTarget, options);
    const cachedResultId = await this.redis.get(`cache:hit:${cacheKey}`);
    if (cachedResultId) {
      // Return a synthetic completed job from cache
      const cachedJob: ConversionJob = {
        id: uuidv4(),
        userId,
        sourceFileId,
        sourceFormat,
        targetFormat: normalizedTarget,
        status: 'completed',
        options: options ?? {},
        formatFamily: getFormatFamily(sourceFormat),
        resultFileId: cachedResultId,
        errorMessage: null,
        idempotencyKey: idempotencyKey ?? null,
        createdAt: new Date(),
        startedAt: new Date(),
        completedAt: new Date(),
      };
      return { job: cachedJob, fromCache: true };
    }

    // Check quota
    const quota = await this.checkQuota(userId);
    if (!quota.allowed) {
      const err = new Error('Conversion quota exceeded') as Error & {
        statusCode: number;
        code: string;
      };
      err.statusCode = 402;
      err.code = 'QUOTA_EXCEEDED';
      throw err;
    }

    // Ensure DB user record exists (creates guest user if unauthenticated)
    await (this.prisma as any).user.upsert({
      where: { id: userId },
      update: {},
      create: {
        id: userId,
        email: `${userId}@guest.local`,
        passwordHash: 'guest_account',
        tier: 'guest',
      },
    });

    const formatFamily = getFormatFamily(sourceFormat);

    // Create job record
    const job = await (this.prisma as any).conversionJob.create({
      data: {
        id: uuidv4(),
        userId,
        sourceFileId,
        sourceFormat,
        targetFormat: normalizedTarget,
        status: 'queued',
        options: options ?? {},
        formatFamily,
        resultFileId: null,
        errorMessage: null,
        idempotencyKey: idempotencyKey ?? null,
        createdAt: new Date(),
        startedAt: null,
        completedAt: null,
      },
    });

    // Resolve source storage key from file_uploads if available
    let sourceStorageKey = sourceFileId;
    try {
      const fileUpload = await (this.prisma as any).fileUpload.findUnique({
        where: { id: sourceFileId },
      });
      if (fileUpload?.storageKey) {
        sourceStorageKey = fileUpload.storageKey;
      }
    } catch {}

    // ── Dispatch to the appropriate Python worker via Redis queue ──────────────
    const env = getEnv();
    try {
      await this.queueProducer.enqueue(formatFamily as QueueFormatFamily, {
        jobId: job.id,
        userId,
        sourceFileId: sourceStorageKey,
        sourceFormat,
        targetFormat: normalizedTarget,
        options: options ?? {},
        sourceBucket: env.S3_BUCKET_UPLOADS,
        resultBucket: env.S3_BUCKET_RESULTS,
        callbackUrl: `${env.ORCHESTRATOR_INTERNAL_URL}/internal/conversions/${job.id}/status`,
        enqueuedAt: new Date().toISOString(),
      });
    } catch (queueErr) {
      // If we fail to enqueue, mark the job failed immediately so the user gets
      // an accurate status rather than a job stuck in 'queued' forever.
      await (this.prisma as any).conversionJob.update({
        where: { id: job.id },
        data: { status: 'failed', errorMessage: 'Failed to dispatch job to worker queue' },
      });
      throw queueErr;
    }

    return { job: job as ConversionJob };
  }

  /**
   * Resolve source format from file ID.
   * In tests, the sourceFileId may encode the format (e.g. "file-png-xxx").
   * In production this would look up file_uploads table.
   */
  private async resolveSourceFormat(sourceFileId: string): Promise<string> {
    // 1. Try Redis lookup first (fastest)
    const cached = await this.redis.get(`file:format:${sourceFileId}`);
    if (cached) return cached;

    // 2. Try fileUploads DB table lookup
    try {
      const fileUpload = await (this.prisma as any).fileUpload.findUnique({
        where: { id: sourceFileId },
      });
      if (fileUpload?.filename) {
        const ext = fileUpload.filename.split('.').pop()?.toLowerCase();
        if (ext) return ext;
      }
    } catch {
      // fallback
    }

    // 3. Try conversionJob DB table lookup
    const fileRecord = await (this.prisma as any).conversionJob.findFirst({
      where: { sourceFileId },
    });
    if (fileRecord?.sourceFormat) {
      return fileRecord.sourceFormat;
    }

    // 4. Derive from sourceFileId encoding (e.g. "file-png-abc123")
    const parts = sourceFileId.toLowerCase().split('-');
    for (const part of parts) {
      if (FORMAT_FAMILIES[part]) return part;
    }

    // Default fallback
    return 'unknown';
  }

  /**
   * Build a simple cache key for conversion result lookup.
   */
  buildCacheKey(sourceFileId: string, targetFormat: string, options?: ConversionOptions): string {
    const opts = options ? JSON.stringify(options) : '';
    return `${sourceFileId}:${targetFormat}:${opts}`;
  }

  /**
   * Get a job by ID, enforcing user ownership.
   * Requirements: 5.8
   */
  async getJob(jobId: string, userId: string): Promise<ConversionJob> {
    const job = await (this.prisma as any).conversionJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      const err = new Error('Job not found') as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    }

    if (job.userId !== userId) {
      const err = new Error('Access denied') as Error & { statusCode: number };
      err.statusCode = 403;
      throw err;
    }

    return job as ConversionJob;
  }

  /**
   * List jobs for a user with optional filters.
   * Requirements: 5.8
   */
  async listJobs(userId: string, filters: JobFilters): Promise<PaginatedJobs> {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: any = { userId };
    if (filters.status) {
      where.status = filters.status;
    }

    const [jobs, total] = await Promise.all([
      (this.prisma as any).conversionJob.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      (this.prisma as any).conversionJob.count({ where }),
    ]);

    return {
      data: jobs as ConversionJob[],
      total,
      page,
      pageSize,
    };
  }

  /**
   * Cancel a queued or processing job.
   * Requirements: 6.8
   */
  async cancelJob(jobId: string, userId: string): Promise<ConversionJob> {
    const job = await (this.prisma as any).conversionJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      const err = new Error('Job not found') as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    }

    if (job.userId !== userId) {
      const err = new Error('Access denied') as Error & { statusCode: number };
      err.statusCode = 403;
      throw err;
    }

    if (job.status !== 'queued' && job.status !== 'processing') {
      const err = new Error(
        `Cannot cancel job with status: ${job.status}`,
      ) as Error & { statusCode: number; code: string };
      err.statusCode = 409;
      err.code = 'JOB_NOT_CANCELLABLE';
      throw err;
    }

    const updated = await (this.prisma as any).conversionJob.update({
      where: { id: jobId },
      data: { status: 'cancelled' },
    });

    return updated as ConversionJob;
  }

  /**
   * Check if a cache hit exists for the given cache key.
   * Requirements: 26.1, 26.2, 26.5
   */
  async checkCacheHit(cacheKey: string): Promise<string | null> {
    return this.redis.get(`cache:hit:${cacheKey}`);
  }

  /**
   * Check user's conversion quota.
   * Requirements: 5.5
   */
  async checkQuota(userId: string): Promise<QuotaCheckResult> {
    if (userId.startsWith('guest_')) {
      const today = new Date().toISOString().slice(0, 10);
      const redisKey = `guest_conversions:${userId}:${today}`;
      const usedStr = await this.redis.get(redisKey);
      const used = usedStr ? parseInt(usedStr, 10) : 0;
      const GUEST_DAILY_LIMIT = parseInt(process.env.GUEST_DAILY_LIMIT || '1000', 10);
      const remaining = Math.max(0, GUEST_DAILY_LIMIT - used);
      const allowed = used < GUEST_DAILY_LIMIT;
      return { allowed, remaining };
    }

    const monthStart = this.getMonthStart();

    const result = await (this.prisma as any).usageLog.aggregate({
      where: {
        userId,
        quotaType: 'conversions',
        createdAt: { gte: monthStart },
      },
      _count: true,
    });

    const used = result._count ?? 0;
    const remaining = Math.max(0, FREE_TIER_MONTHLY_LIMIT - used);
    const allowed = used < FREE_TIER_MONTHLY_LIMIT;

    return { allowed, remaining };
  }

  private getMonthStart(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
}
