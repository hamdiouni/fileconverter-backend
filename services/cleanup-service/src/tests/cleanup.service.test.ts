/**
 * Unit tests for CleanupService (Task 26.5)
 * Requirements: 23.1, 23.2, 23.3, 23.4, 23.5
 */
import { CleanupService } from '../cleanup.service';
import type { StorageClient, DbClient } from '../cleanup.service';
import { resetEnvCache } from '../config/env';

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function makeStorage(deleted: string[] = []): StorageClient {
  return {
    async deleteObject(_bucket: string, key: string) {
      deleted.push(key);
    },
  };
}

function makeDb(files: Array<{ id: string; storageKey: string; userId: string }> = []): DbClient & {
  expiredIds: string[];
  failedJobsResult: number;
  guestUsersResult: number;
} {
  const expiredIds: string[] = [];
  return {
    expiredIds,
    failedJobsResult: 2,
    guestUsersResult: 3,
    async getExpiredFiles(_now: Date) { return files; },
    async markFileExpired(id: string) { expiredIds.push(id); },
    async deleteOldFailedJobs(_olderThan: Date) { return this.failedJobsResult; },
    async deleteInactiveGuestUsers(_since: Date) { return this.guestUsersResult; },
    async getUserTier(_userId: string) { return 'free' as const; },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetEnvCache();
});

describe('CleanupService.getExpiryDate (Req 23.2)', () => {
  let service: CleanupService;

  beforeEach(() => {
    service = new CleanupService(makeStorage(), makeDb());
  });

  it('returns 7-day expiry for free tier', () => {
    const uploadedAt = new Date('2024-01-01T00:00:00Z');
    const expiry = service.getExpiryDate(uploadedAt, 'free');
    expect(expiry.toISOString().slice(0, 10)).toBe('2024-01-08');
  });

  it('returns 14-day expiry for pro tier', () => {
    const uploadedAt = new Date('2024-01-01T00:00:00Z');
    const expiry = service.getExpiryDate(uploadedAt, 'pro');
    expect(expiry.toISOString().slice(0, 10)).toBe('2024-01-15');
  });

  it('returns 30-day expiry for business tier', () => {
    const uploadedAt = new Date('2024-01-01T00:00:00Z');
    const expiry = service.getExpiryDate(uploadedAt, 'business');
    expect(expiry.toISOString().slice(0, 10)).toBe('2024-01-31');
  });

  it('returns 30-day expiry for enterprise tier', () => {
    const uploadedAt = new Date('2024-01-01T00:00:00Z');
    const expiry = service.getExpiryDate(uploadedAt, 'enterprise');
    expect(expiry.toISOString().slice(0, 10)).toBe('2024-01-31');
  });

  it('expiry is always after uploadedAt', () => {
    const now = new Date();
    const tiers = ['free', 'pro', 'business', 'enterprise'] as const;
    for (const tier of tiers) {
      expect(service.getExpiryDate(now, tier).getTime()).toBeGreaterThan(now.getTime());
    }
  });
});

describe('CleanupService.cleanupExpiredFiles (Req 23.1, 23.3)', () => {
  it('deletes each expired file from S3 and marks it expired in DB', async () => {
    const deletedKeys: string[] = [];
    const storage = makeStorage(deletedKeys);
    const files = [
      { id: 'file-1', storageKey: 'uploads/file-1.png', userId: 'u1' },
      { id: 'file-2', storageKey: 'uploads/file-2.pdf', userId: 'u2' },
    ];
    const db = makeDb(files);
    const service = new CleanupService(storage, db);

    const result = await service.cleanupExpiredFiles();

    expect(result.deleted).toBe(2);
    expect(result.errors).toBe(0);
    expect(deletedKeys).toEqual(['uploads/file-1.png', 'uploads/file-2.pdf']);
    expect(db.expiredIds).toEqual(['file-1', 'file-2']);
  });

  it('deletes associated result files from S3_BUCKET_RESULTS', async () => {
    const deletedCalls: Array<{ bucket: string; key: string }> = [];
    const storage: StorageClient = {
      async deleteObject(bucket: string, key: string) {
        deletedCalls.push({ bucket, key });
      },
    };
    const files = [
      {
        id: 'file-1',
        storageKey: 'uploads/file-1.png',
        userId: 'u1',
        resultKeys: ['results/job-1/out.jpg', 'results/job-1/thumb.jpg'],
      },
    ];
    const db = makeDb(files);
    const service = new CleanupService(storage, db);

    const result = await service.cleanupExpiredFiles();

    expect(result.deleted).toBe(1);
    expect(result.errors).toBe(0);
    expect(deletedCalls).toEqual([
      { bucket: 'fileconverter-uploads', key: 'uploads/file-1.png' },
      { bucket: 'fileconverter-results', key: 'results/job-1/out.jpg' },
      { bucket: 'fileconverter-results', key: 'results/job-1/thumb.jpg' },
    ]);
  });

  it('counts errors when S3 deletion fails', async () => {
    const storage: StorageClient = {
      async deleteObject() { throw new Error('S3 unavailable'); },
    };
    const files = [{ id: 'f1', storageKey: 'uploads/f1.png', userId: 'u1' }];
    const db = makeDb(files);
    const service = new CleanupService(storage, db);

    const result = await service.cleanupExpiredFiles();

    expect(result.errors).toBe(1);
    expect(result.deleted).toBe(0);
  });

  it('returns zero deleted when no expired files exist', async () => {
    const service = new CleanupService(makeStorage(), makeDb([]));
    const result = await service.cleanupExpiredFiles();
    expect(result.deleted).toBe(0);
    expect(result.errors).toBe(0);
  });

  it('continues processing remaining files after a single failure', async () => {
    let callCount = 0;
    const storage: StorageClient = {
      async deleteObject() {
        callCount++;
        if (callCount === 1) throw new Error('S3 error on first file');
      },
    };
    const files = [
      { id: 'f1', storageKey: 'key1', userId: 'u1' },
      { id: 'f2', storageKey: 'key2', userId: 'u1' },
    ];
    const db = makeDb(files);
    const service = new CleanupService(storage, db);

    const result = await service.cleanupExpiredFiles();

    expect(result.deleted).toBe(1);
    expect(result.errors).toBe(1);
    expect(db.expiredIds).toEqual(['f2']); // second file still processed
  });
});

describe('CleanupService.cleanupOldJobs (Req 23.4)', () => {
  it('returns number of deleted jobs from DB', async () => {
    const db = makeDb();
    db.failedJobsResult = 5;
    const service = new CleanupService(makeStorage(), db);

    const count = await service.cleanupOldJobs();
    expect(count).toBe(5);
  });

  it('passes a date 30 days before now', async () => {
    let capturedDate: Date | null = null;
    const db: DbClient = {
      async getExpiredFiles() { return []; },
      async markFileExpired() {},
      async deleteOldFailedJobs(olderThan: Date) { capturedDate = olderThan; return 0; },
      async deleteInactiveGuestUsers() { return 0; },
      async getUserTier() { return 'free'; },
    };
    const service = new CleanupService(makeStorage(), db);
    const now = new Date('2024-06-01T00:00:00Z');

    await service.cleanupOldJobs(now);

    expect(capturedDate).not.toBeNull();
    const expectedDate = new Date('2024-05-02T00:00:00Z');
    expect(capturedDate!.toISOString().slice(0, 10)).toBe(expectedDate.toISOString().slice(0, 10));
  });
});

describe('CleanupService.cleanupInactiveGuests (Req 23.5)', () => {
  it('returns number of deleted users from DB', async () => {
    const db = makeDb();
    db.guestUsersResult = 7;
    const service = new CleanupService(makeStorage(), db);

    const count = await service.cleanupInactiveGuests();
    expect(count).toBe(7);
  });

  it('passes a date 90 days before now', async () => {
    let capturedDate: Date | null = null;
    const db: DbClient = {
      async getExpiredFiles() { return []; },
      async markFileExpired() {},
      async deleteOldFailedJobs() { return 0; },
      async deleteInactiveGuestUsers(since: Date) { capturedDate = since; return 0; },
      async getUserTier() { return 'free'; },
    };
    const service = new CleanupService(makeStorage(), db);
    const now = new Date('2024-06-01T00:00:00Z');

    await service.cleanupInactiveGuests(now);

    const expectedDate = new Date(now);
    expectedDate.setDate(now.getDate() - 90);
    expect(capturedDate!.toISOString().slice(0, 10)).toBe(expectedDate.toISOString().slice(0, 10));
  });
});

describe('CleanupService.runAll', () => {
  it('returns aggregate stats from all cleanup operations', async () => {
    const db = makeDb([{ id: 'f1', storageKey: 'key1', userId: 'u1' }]);
    db.failedJobsResult = 4;
    db.guestUsersResult = 2;
    const service = new CleanupService(makeStorage(), db);

    const stats = await service.runAll();

    expect(stats.filesDeleted).toBe(1);
    expect(stats.jobsDeleted).toBe(4);
    expect(stats.usersDeleted).toBe(2);
    expect(stats.errors).toBe(0);
  });
});
