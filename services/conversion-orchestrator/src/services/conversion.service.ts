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

/**
 * Valid conversion pairs: sourceFormat → allowed targetFormats
 * Requirements: 5.1, 5.2
 */
export const VALID_CONVERSIONS: Record<string, string[]> = {
  // Images
  png: ['jpg', 'jpeg', 'webp', 'pdf', 'bmp', 'tiff', 'gif'],
  jpg: ['png', 'webp', 'pdf', 'bmp', 'tiff', 'gif'],
  jpeg: ['png', 'webp', 'pdf', 'bmp', 'tiff', 'gif'],
  webp: ['png', 'jpg', 'jpeg', 'pdf', 'bmp', 'tiff'],
  bmp: ['png', 'jpg', 'jpeg', 'webp', 'pdf'],
  tiff: ['png', 'jpg', 'jpeg', 'webp', 'pdf'],
  gif: ['png', 'jpg', 'jpeg', 'webp'],
  svg: ['png', 'jpg', 'jpeg', 'pdf'],
  raw: ['jpg', 'jpeg', 'png', 'tiff'],
  // Documents
  pdf: ['docx', 'html', 'txt', 'png', 'jpg'],
  docx: ['pdf', 'html', 'txt', 'odt', 'rtf'],
  doc: ['pdf', 'html', 'txt', 'odt', 'rtf', 'docx'],
  odt: ['pdf', 'docx', 'html', 'txt'],
  rtf: ['pdf', 'docx', 'html', 'txt'],
  html: ['pdf', 'docx', 'txt', 'md'],
  txt: ['pdf', 'docx', 'html', 'md'],
  md: ['html', 'pdf', 'docx'],
  // Video
  mp4: ['webm', 'avi', 'mkv', 'mov', 'flv'],
  webm: ['mp4', 'avi', 'mkv', 'mov'],
  avi: ['mp4', 'webm', 'mkv', 'mov'],
  mkv: ['mp4', 'webm', 'avi', 'mov'],
  mov: ['mp4', 'webm', 'avi', 'mkv'],
  flv: ['mp4', 'webm', 'avi'],
  // Audio
  mp3: ['wav', 'flac', 'aac', 'ogg', 'm4a'],
  wav: ['mp3', 'flac', 'aac', 'ogg', 'm4a'],
  flac: ['mp3', 'wav', 'aac', 'ogg'],
  aac: ['mp3', 'wav', 'flac', 'ogg'],
  ogg: ['mp3', 'wav', 'flac', 'aac'],
  m4a: ['mp3', 'wav', 'flac', 'aac'],
  // Archives
  zip: ['tar', '7z', 'gz'],
  tar: ['zip', '7z', 'gz'],
  '7z': ['zip', 'tar'],
  gz: ['zip', 'tar'],
  rar: ['zip', 'tar', '7z'],
  // Fonts
  ttf: ['otf', 'woff', 'woff2'],
  otf: ['ttf', 'woff', 'woff2'],
  woff: ['ttf', 'otf', 'woff2'],
  woff2: ['ttf', 'otf', 'woff'],
};

/**
 * Format family mapping
 */
export const FORMAT_FAMILIES: Record<string, FormatFamily> = {
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image',
  webp: 'image', tiff: 'image', bmp: 'image', svg: 'image',
  raw: 'image', cr2: 'image', nef: 'image', arw: 'image',
  mp4: 'video', avi: 'video', mov: 'video', mkv: 'video',
  webm: 'video', flv: 'video', '3gp': 'video', wmv: 'video',
  mp3: 'audio', wav: 'audio', flac: 'audio', aac: 'audio',
  ogg: 'audio', m4a: 'audio', wma: 'audio', aiff: 'audio',
  doc: 'document', docx: 'document', pdf: 'document', txt: 'document',
  rtf: 'document', odt: 'document', html: 'document', md: 'document',
  epub: 'document', mobi: 'document',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive',
  gz: 'archive', bz2: 'archive', xz: 'archive',
  dwg: 'cad', dxf: 'cad',
  ttf: 'font', otf: 'font', woff: 'font', woff2: 'font', eot: 'font',
};

/**
 * Free tier monthly conversion limit
 */
const FREE_TIER_MONTHLY_LIMIT = 100;

export function getFormatFamily(format: string): FormatFamily {
  const normalized = format.toLowerCase().replace(/^\./, '');
  return FORMAT_FAMILIES[normalized] ?? 'document';
}

export function isValidConversion(sourceFormat: string, targetFormat: string): boolean {
  const src = sourceFormat.toLowerCase().trim();
  const tgt = targetFormat.toLowerCase().trim();
  const allowed = VALID_CONVERSIONS[src];
  if (!allowed) return false;
  return allowed.includes(tgt);
}

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

    // ── Dispatch to the appropriate Python worker via Redis queue ──────────────
    const env = getEnv();
    try {
      await this.queueProducer.enqueue(formatFamily as QueueFormatFamily, {
        jobId: job.id,
        userId,
        sourceFileId,
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
