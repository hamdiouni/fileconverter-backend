/**
 * CleanupService — handles all scheduled cleanup operations.
 * Requirements: 23.1–23.7
 */
import { getEnv } from './config/env';

export interface StorageClient {
  deleteObject(bucket: string, key: string): Promise<void>;
}

export interface DbClient {
  getExpiredFiles(now: Date): Promise<Array<{ id: string; storageKey: string; userId: string }>>;
  markFileExpired(fileId: string): Promise<void>;
  deleteOldFailedJobs(olderThan: Date): Promise<number>;
  deleteInactiveGuestUsers(inactiveSince: Date): Promise<number>;
  getUserTier(userId: string): Promise<'free' | 'pro' | 'business' | 'enterprise'>;
}

export interface CleanupStats {
  filesDeleted: number;
  jobsDeleted: number;
  usersDeleted: number;
  errors: number;
}

export class CleanupService {
  constructor(
    private storage: StorageClient,
    private db: DbClient,
  ) {}

  /**
   * Calculate the expiry date for a file based on the user's subscription tier.
   * Requirements: 23.2
   */
  getExpiryDate(uploadedAt: Date, tier: 'free' | 'pro' | 'business' | 'enterprise'): Date {
    const env = getEnv();
    const retentionDays: Record<string, number> = {
      free:       env.CLEANUP_RETENTION_FREE,
      pro:        env.CLEANUP_RETENTION_PRO,
      business:   env.CLEANUP_RETENTION_BUSINESS,
      enterprise: env.CLEANUP_RETENTION_BUSINESS, // same as business
    };
    const days = retentionDays[tier] ?? env.CLEANUP_RETENTION_FREE;
    const expiry = new Date(uploadedAt);
    expiry.setDate(expiry.getDate() + days);
    return expiry;
  }

  /**
   * Delete expired files from S3 and mark their DB records as expired.
   * Requirements: 23.1, 23.3
   */
  async cleanupExpiredFiles(now: Date = new Date()): Promise<{ deleted: number; errors: number }> {
    const env = getEnv();
    const expiredFiles = await this.db.getExpiredFiles(now);
    let deleted = 0;
    let errors = 0;

    for (const file of expiredFiles) {
      try {
        await this.storage.deleteObject(env.S3_BUCKET_UPLOADS, file.storageKey);
        await this.db.markFileExpired(file.id);
        deleted++;
      } catch (err) {
        errors++;
        console.error(`Failed to delete file ${file.id}:`, err);
      }
    }

    return { deleted, errors };
  }

  /**
   * Delete failed conversion jobs older than 30 days.
   * Requirements: 23.4
   */
  async cleanupOldJobs(now: Date = new Date()): Promise<number> {
    const olderThan = new Date(now);
    olderThan.setDate(olderThan.getDate() - 30);
    return this.db.deleteOldFailedJobs(olderThan);
  }

  /**
   * Delete guest user accounts with no activity for 90 days.
   * Requirements: 23.5
   */
  async cleanupInactiveGuests(now: Date = new Date()): Promise<number> {
    const inactiveSince = new Date(now);
    inactiveSince.setDate(inactiveSince.getDate() - 90);
    return this.db.deleteInactiveGuestUsers(inactiveSince);
  }

  /**
   * Run all cleanup operations and return aggregate stats.
   * Requirements: 23.1–23.6
   */
  async runAll(now: Date = new Date()): Promise<CleanupStats> {
    const [fileResult, jobsDeleted, usersDeleted] = await Promise.all([
      this.cleanupExpiredFiles(now),
      this.cleanupOldJobs(now),
      this.cleanupInactiveGuests(now),
    ]);

    return {
      filesDeleted: fileResult.deleted,
      jobsDeleted,
      usersDeleted,
      errors: fileResult.errors,
    };
  }
}
