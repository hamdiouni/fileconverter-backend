import { v4 as uuidv4 } from 'uuid';
import type { PrismaClient } from '@prisma/client';
import type IORedis from 'ioredis';
import type { StorageService } from './storage.service';
import { uploadRequestsTotal, uploadSizeBytes, virusScansTotal } from '../plugins/metrics';

// Magic number signatures for file type detection
const MAGIC_NUMBERS: Array<{ format: string; bytes: number[]; offset?: number }> = [
  { format: 'png',  bytes: [0x89, 0x50, 0x4E, 0x47] },
  { format: 'jpg',  bytes: [0xFF, 0xD8, 0xFF] },
  { format: 'gif',  bytes: [0x47, 0x49, 0x46, 0x38] },
  { format: 'webp', bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },
  { format: 'pdf',  bytes: [0x25, 0x50, 0x44, 0x46] },
  { format: 'zip',  bytes: [0x50, 0x4B, 0x03, 0x04] },
  { format: 'mp4',  bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 },
  { format: 'mp3',  bytes: [0xFF, 0xFB] },
  { format: 'docx', bytes: [0x50, 0x4B, 0x03, 0x04] }, // same as zip — OOXML
];

const EXTENSION_CONTENT_TYPES: Record<string, string[]> = {
  png:  ['image/png'],
  jpg:  ['image/jpeg', 'image/jpg'],
  jpeg: ['image/jpeg'],
  gif:  ['image/gif'],
  webp: ['image/webp'],
  pdf:  ['application/pdf'],
  zip:  ['application/zip', 'application/x-zip-compressed'],
  mp4:  ['video/mp4'],
  mp3:  ['audio/mpeg', 'audio/mp3'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
};

const TIER_SIZE_LIMITS: Record<string, number> = {
  free:       100 * 1024 * 1024,
  pro:        1024 * 1024 * 1024,
  business:   10 * 1024 * 1024 * 1024,
  enterprise: -1,
};

export interface CreateUploadInput {
  userId: string;
  userTier: string;
  filename: string;
  contentType: string;
  fileSize: number;
}

export interface UploadRequest {
  uploadId: string;
  presignedUrl: string;
  expiresIn: number;
  storageKey: string;
}

export interface FileMetadata {
  id: string;
  userId: string;
  filename: string;
  originalFilename: string;
  size: number;
  contentType: string;
  storageKey: string;
  virusScanStatus: string;
  uploadStatus: string;
  uploadedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
}

export class UploadService {
  constructor(
    private prisma: PrismaClient,
    private redis: IORedis,
    private storage: StorageService,
  ) {}

  private getStorageKey(userId: string, uploadId: string, filename: string): string {
    return `uploads/${userId}/${uploadId}/${filename}`;
  }

  private getExpiresAt(tier: string): Date {
    const days: Record<string, number> = { free: 7, pro: 14, business: 30, enterprise: 90 };
    const d = days[tier] ?? 7;
    return new Date(Date.now() + d * 24 * 60 * 60 * 1000);
  }

  detectFileType(header: Buffer): string | null {
    for (const sig of MAGIC_NUMBERS) {
      const offset = sig.offset ?? 0;
      if (header.length < offset + sig.bytes.length) continue;
      const match = sig.bytes.every((b, i) => header[offset + i] === b);
      if (match) return sig.format;
    }
    return null;
  }

  validateContentType(filename: string, contentType: string): { valid: boolean; reason?: string } {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const allowed = EXTENSION_CONTENT_TYPES[ext];
    if (!allowed) return { valid: true }; // unknown extension — allow through
    if (!allowed.includes(contentType.split(';')[0].trim().toLowerCase())) {
      return { valid: false, reason: `Content type ${contentType} does not match extension .${ext}` };
    }
    return { valid: true };
  }

  async createUpload(input: CreateUploadInput): Promise<UploadRequest> {
    const { userId, userTier, filename, contentType, fileSize } = input;

    // Validate content type vs extension
    const validation = this.validateContentType(filename, contentType);
    if (!validation.valid) {
      const err = new Error(validation.reason!) as Error & { statusCode: number; code: string };
      err.statusCode = 400;
      err.code = 'INVALID_CONTENT_TYPE';
      throw err;
    }

    // Check file size against tier
    const sizeLimit = TIER_SIZE_LIMITS[userTier] ?? TIER_SIZE_LIMITS['free'];
    if (sizeLimit !== -1 && fileSize > sizeLimit) {
      const err = new Error(`File size ${fileSize} exceeds limit for tier ${userTier}`) as Error & { statusCode: number; code: string };
      err.statusCode = 413;
      err.code = 'FILE_TOO_LARGE';
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
        tier: userTier === 'guest' ? 'guest' : 'free',
      },
    });

    // Enforce Guest Mode daily limit (20 free uploads/day)
    const guestLimit = parseInt(process.env.GUEST_DAILY_LIMIT || '20', 10);
    if (userTier === 'guest' || userId.startsWith('guest_')) {
      const today = new Date().toISOString().slice(0, 10);
      const redisKey = `guest_daily_uploads:${userId}:${today}`;
      const count = await this.redis.incr(redisKey);
      if (count === 1) {
        await this.redis.expire(redisKey, 86400);
      }
      if (count > guestLimit) {
        const err = new Error(`Guest daily conversion limit reached (${guestLimit} per day). Create a free account for higher limits!`) as Error & { statusCode: number; code: string };
        err.statusCode = 429;
        err.code = 'GUEST_LIMIT_EXCEEDED';
        throw err;
      }
    }

    const uploadId = uuidv4();
    const storageKey = this.getStorageKey(userId, uploadId, filename);
    const expiresAt = this.getExpiresAt(userTier);

    // Cache file extension in Redis for orchestrator lookup
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    await this.redis.set(`file:format:${uploadId}`, ext, 'EX', 86400);

    // Generate presigned URL (15 min)
    const presignedUrl = await this.storage.generatePresignedUploadUrl(storageKey, contentType, 15 * 60);

    // Create DB record
    await (this.prisma as any).fileUpload.create({
      data: {
        id: uploadId,
        userId,
        filename,
        originalFilename: filename,
        size: fileSize,
        contentType,
        storageKey,
        uploadStatus: 'pending',
        virusScanStatus: 'pending',
        expiresAt,
        createdAt: new Date(),
      },
    });

    uploadRequestsTotal.inc({ status: 'created' });
    uploadSizeBytes.observe(fileSize);

    return { uploadId, presignedUrl, expiresIn: 15 * 60, storageKey };
  }

  async completeUpload(uploadId: string, userId: string): Promise<FileMetadata> {
    const file = await (this.prisma as any).fileUpload.findFirst({
      where: { id: uploadId, userId },
    });

    if (!file) {
      const err = new Error('Upload not found') as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    }

    const now = new Date();
    const updated = await (this.prisma as any).fileUpload.update({
      where: { id: uploadId },
      data: { uploadStatus: 'uploaded', virusScanStatus: 'scanning', uploadedAt: now },
    });

    uploadRequestsTotal.inc({ status: 'completed' });

    // Async virus scan (fire and forget in real implementation)
    setImmediate(() => this.scanFile(uploadId, file.storageKey, userId).catch(() => {}));

    return updated;
  }

  async scanFile(uploadId: string, storageKey: string, _userId: string): Promise<void> {
    // In real implementation: stream file to ClamAV
    // For now: mark as clean (mock behavior)
    virusScansTotal.inc({ result: 'clean' });
    await (this.prisma as any).fileUpload.update({
      where: { id: uploadId },
      data: { virusScanStatus: 'clean' },
    });
  }

  async getFile(fileId: string, userId: string): Promise<FileMetadata> {
    const file = await (this.prisma as any).fileUpload.findFirst({
      where: { id: fileId, userId },
    });
    if (!file) {
      const err = new Error('File not found') as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    }
    return file;
  }

  async deleteFile(fileId: string, userId: string): Promise<void> {
    const file = await (this.prisma as any).fileUpload.findFirst({
      where: { id: fileId, userId },
    });
    if (!file) {
      const err = new Error('File not found') as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    }
    await this.storage.deleteFile(file.storageKey);
    await (this.prisma as any).fileUpload.delete({ where: { id: fileId } });
  }

  async getDownloadUrl(fileId: string, userId: string): Promise<string> {
    const file = await this.getFile(fileId, userId);
    if (file.virusScanStatus === 'infected') {
      const err = new Error('File is infected and cannot be downloaded') as Error & { statusCode: number };
      err.statusCode = 403;
      throw err;
    }
    return this.storage.generatePresignedDownloadUrl(file.storageKey, 60 * 60);
  }

  // Multipart upload methods
  async initiateMultipartUpload(userId: string, userTier: string, filename: string, contentType: string): Promise<{ uploadId: string; storageKey: string }> {
    const uploadId = uuidv4();
    const storageKey = this.getStorageKey(userId, uploadId, filename);
    const expiresAt = this.getExpiresAt(userTier);

    await (this.prisma as any).fileUpload.create({
      data: {
        id: uploadId,
        userId,
        filename,
        originalFilename: filename,
        size: 0,
        contentType,
        storageKey,
        uploadStatus: 'multipart_pending',
        virusScanStatus: 'pending',
        expiresAt,
        createdAt: new Date(),
      },
    });

    return { uploadId, storageKey };
  }

  async completeMultipartUpload(uploadId: string, userId: string, totalSize: number): Promise<FileMetadata> {
    const file = await (this.prisma as any).fileUpload.findFirst({ where: { id: uploadId, userId } });
    if (!file) {
      const err = new Error('Upload not found') as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    }

    const now = new Date();
    return (this.prisma as any).fileUpload.update({
      where: { id: uploadId },
      data: { uploadStatus: 'uploaded', size: totalSize, uploadedAt: now },
    });
  }
}
