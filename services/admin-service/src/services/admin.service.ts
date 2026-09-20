import type { PrismaClient } from '@prisma/client';
import type IORedis from 'ioredis';

export class AdminService {
  constructor(private prisma: PrismaClient, private redis: IORedis) {}

  async listUsers(filters: { tier?: string; suspended?: boolean; page?: number; pageSize?: number }) {
    const { page = 1, pageSize = 20 } = filters;
    const where: any = {};
    if (filters.tier) where.tier = filters.tier;
    if (filters.suspended !== undefined) where.suspended = filters.suspended;
    const [items, total] = await Promise.all([
      (this.prisma as any).user.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      (this.prisma as any).user.count({ where }),
    ]);
    return { data: items, total, page, pageSize };
  }

  async getUser(userId: string) {
    const user = await (this.prisma as any).user.findUnique({ where: { id: userId } });
    if (!user) {
      const e = new Error('User not found') as any;
      e.statusCode = 404;
      throw e;
    }
    return user;
  }

  async suspendUser(userId: string) {
    await this.getUser(userId);
    return (this.prisma as any).user.update({ where: { id: userId }, data: { suspended: true } });
  }

  async unsuspendUser(userId: string) {
    await this.getUser(userId);
    return (this.prisma as any).user.update({ where: { id: userId }, data: { suspended: false } });
  }

  async listJobs(filters: { userId?: string; status?: string; page?: number; pageSize?: number }) {
    const { page = 1, pageSize = 20 } = filters;
    const where: any = {};
    if (filters.userId) where.userId = filters.userId;
    if (filters.status) where.status = filters.status;
    const [items, total] = await Promise.all([
      (this.prisma as any).conversionJob.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      (this.prisma as any).conversionJob.count({ where }),
    ]);
    return { data: items, total, page, pageSize };
  }

  async getJob(jobId: string) {
    const job = await (this.prisma as any).conversionJob.findUnique({ where: { id: jobId } });
    if (!job) {
      const e = new Error('Job not found') as any;
      e.statusCode = 404;
      throw e;
    }
    return job;
  }

  async retryJob(jobId: string) {
    const job = await this.getJob(jobId);
    if (job.status !== 'failed') {
      const e = new Error('Only failed jobs can be retried') as any;
      e.statusCode = 409;
      e.code = 'INVALID_STATE';
      throw e;
    }
    return (this.prisma as any).conversionJob.update({ where: { id: jobId }, data: { status: 'queued' } });
  }

  async cancelJob(jobId: string) {
    const job = await this.getJob(jobId);
    if (!['queued', 'processing'].includes(job.status)) {
      const e = new Error('Job cannot be cancelled in its current state') as any;
      e.statusCode = 409;
      e.code = 'INVALID_STATE';
      throw e;
    }
    return (this.prisma as any).conversionJob.update({ where: { id: jobId }, data: { status: 'cancelled' } });
  }

  async getSystemMetrics() {
    const [totalUsers, totalJobs, queuedJobs, failedJobs] = await Promise.all([
      (this.prisma as any).user.count({}),
      (this.prisma as any).conversionJob.count({}),
      (this.prisma as any).conversionJob.count({ where: { status: 'queued' } }),
      (this.prisma as any).conversionJob.count({ where: { status: 'failed' } }),
    ]);
    return { totalUsers, totalJobs, queuedJobs, failedJobs };
  }
}
