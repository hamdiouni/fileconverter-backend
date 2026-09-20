import cron from 'node-cron';
import http from 'http';
import { register, Counter, Histogram } from 'prom-client';
import { CleanupService } from './cleanup.service';
import { getEnv } from './config/env';

// ─── Metrics ──────────────────────────────────────────────────────────────────

const filesDeletedTotal = new Counter({
  name: 'cleanup_files_deleted_total',
  help: 'Total number of files deleted by cleanup job',
});

const jobsDeletedTotal = new Counter({
  name: 'cleanup_jobs_deleted_total',
  help: 'Total number of old failed jobs deleted',
});

const errorsTotal = new Counter({
  name: 'cleanup_errors_total',
  help: 'Total number of errors during cleanup',
});

const durationHistogram = new Histogram({
  name: 'cleanup_duration_seconds',
  help: 'Duration of cleanup operations in seconds',
  labelNames: ['operation'],
  buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 120],
});

// ─── Metrics HTTP server ──────────────────────────────────────────────────────

function startMetricsServer(port: number) {
  const server = http.createServer(async (_req, res) => {
    if (_req.url === '/metrics') {
      res.writeHead(200, { 'Content-Type': register.contentType });
      res.end(await register.metrics());
    } else if (_req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'cleanup-service' }));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  server.listen(port, () => {
    console.log(JSON.stringify({ service: 'cleanup-service', level: 'info', message: `Metrics server listening on :${port}` }));
  });
  return server;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const env = getEnv();

  // Lazy-load real DB and storage clients to avoid startup crashes in dev
  // These would be replaced with real Prisma + S3 clients in production
  const { PrismaClient } = await import('@prisma/client');
  const { S3Client, DeleteObjectCommand } = await import('@aws-sdk/client-s3');

  const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  const s3 = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });

  const storageClient = {
    async deleteObject(bucket: string, key: string) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };

  const dbClient = {
    async getExpiredFiles(now: Date) {
      return (prisma as any).fileUpload.findMany({
        where: { uploadStatus: 'uploaded', expiresAt: { lt: now } },
        select: { id: true, storageKey: true, userId: true },
      });
    },
    async markFileExpired(fileId: string) {
      await (prisma as any).fileUpload.update({
        where: { id: fileId },
        data: { uploadStatus: 'expired' },
      });
    },
    async deleteOldFailedJobs(olderThan: Date) {
      const result = await (prisma as any).conversionJob.deleteMany({
        where: { status: 'failed', createdAt: { lt: olderThan } },
      });
      return result.count as number;
    },
    async deleteInactiveGuestUsers(inactiveSince: Date) {
      const result = await (prisma as any).user.deleteMany({
        where: {
          oauthProvider: null,
          passwordHash: null,
          updatedAt: { lt: inactiveSince },
        },
      });
      return result.count as number;
    },
    async getUserTier(_userId: string): Promise<'free' | 'pro' | 'business' | 'enterprise'> {
      return 'free';
    },
  };

  const service = new CleanupService(storageClient, dbClient);

  // ── Schedule: file cleanup at 2 AM daily ──────────────────────────────────
  cron.schedule(env.CLEANUP_SCHEDULE_FILES, async () => {
    const end = durationHistogram.startTimer({ operation: 'file_cleanup' });
    try {
      const result = await service.cleanupExpiredFiles();
      filesDeletedTotal.inc(result.deleted);
      errorsTotal.inc(result.errors);
      console.log(JSON.stringify({ service: 'cleanup-service', level: 'info', message: 'File cleanup complete', ...result }));
    } catch (err) {
      errorsTotal.inc(1);
      console.error(JSON.stringify({ service: 'cleanup-service', level: 'error', message: 'File cleanup failed', error: String(err) }));
    } finally {
      end();
    }
  });

  // ── Schedule: DB cleanup at 3 AM daily ────────────────────────────────────
  cron.schedule(env.CLEANUP_SCHEDULE_DB, async () => {
    const end = durationHistogram.startTimer({ operation: 'db_cleanup' });
    try {
      const [jobs, users] = await Promise.all([
        service.cleanupOldJobs(),
        service.cleanupInactiveGuests(),
      ]);
      jobsDeletedTotal.inc(jobs);
      console.log(JSON.stringify({ service: 'cleanup-service', level: 'info', message: 'DB cleanup complete', jobsDeleted: jobs, usersDeleted: users }));
    } catch (err) {
      errorsTotal.inc(1);
      console.error(JSON.stringify({ service: 'cleanup-service', level: 'error', message: 'DB cleanup failed', error: String(err) }));
    } finally {
      end();
    }
  });

  startMetricsServer(env.METRICS_PORT);
  console.log(JSON.stringify({ service: 'cleanup-service', level: 'info', message: 'Cleanup service started', scheduleFiles: env.CLEANUP_SCHEDULE_FILES, scheduleDb: env.CLEANUP_SCHEDULE_DB }));
}

main().catch((err) => {
  console.error(JSON.stringify({ service: 'cleanup-service', level: 'error', message: 'Fatal startup error', error: String(err) }));
  process.exit(1);
});
