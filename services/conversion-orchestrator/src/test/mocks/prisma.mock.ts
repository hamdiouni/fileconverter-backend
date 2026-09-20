import { v4 as uuidv4 } from 'uuid';

/**
 * In-memory Prisma mock for conversion-orchestrator tests.
 * Simulates the conversionJob and usageLog tables.
 */
export class InMemoryPrismaClient {
  jobs: Map<string, any> = new Map();
  usageLogs: Map<string, any> = new Map();

  conversionJob = {
    findUnique: async ({ where }: { where: { id: string } }) => {
      return this.jobs.get(where.id) ?? null;
    },

    findFirst: async ({ where }: { where: Record<string, any> }) => {
      for (const job of this.jobs.values()) {
        let match = true;
        for (const [key, value] of Object.entries(where)) {
          if (key === 'createdAt') continue; // skip date filter in mock
          if (job[key] !== value) {
            match = false;
            break;
          }
        }
        if (match) return job;
      }
      return null;
    },

    findMany: async ({
      where,
      skip = 0,
      take = 20,
      orderBy,
    }: {
      where?: Record<string, any>;
      skip?: number;
      take?: number;
      orderBy?: any;
    }) => {
      let results: any[] = [];
      for (const job of this.jobs.values()) {
        if (!where) {
          results.push(job);
          continue;
        }
        let match = true;
        for (const [key, value] of Object.entries(where)) {
          if (key === 'createdAt') continue;
          if (job[key] !== value) {
            match = false;
            break;
          }
        }
        if (match) results.push(job);
      }

      // Apply ordering
      if (orderBy?.createdAt === 'desc') {
        results = results.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
      } else if (orderBy?.createdAt === 'asc') {
        results = results.sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
      }

      return results.slice(skip, skip + take);
    },

    create: async ({ data }: { data: any }) => {
      const id = data.id ?? uuidv4();
      const job = {
        ...data,
        id,
        createdAt: data.createdAt ?? new Date(),
        updatedAt: data.updatedAt ?? new Date(),
        startedAt: data.startedAt ?? null,
        completedAt: data.completedAt ?? null,
        resultFileId: data.resultFileId ?? null,
        errorMessage: data.errorMessage ?? null,
        idempotencyKey: data.idempotencyKey ?? null,
      };
      this.jobs.set(id, job);
      return job;
    },

    update: async ({ where, data }: { where: { id: string }; data: any }) => {
      const job = this.jobs.get(where.id);
      if (!job) throw new Error('Job not found');
      const updated = { ...job, ...data, updatedAt: new Date() };
      this.jobs.set(where.id, updated);
      return updated;
    },

    count: async ({ where }: { where?: Record<string, any> }) => {
      let count = 0;
      for (const job of this.jobs.values()) {
        if (!where) {
          count++;
          continue;
        }
        let match = true;
        for (const [key, value] of Object.entries(where)) {
          if (key === 'createdAt') continue;
          if (job[key] !== value) {
            match = false;
            break;
          }
        }
        if (match) count++;
      }
      return count;
    },
  };

  usageLog = {
    aggregate: async ({
      where,
      _count,
    }: {
      where?: Record<string, any>;
      _count?: boolean;
    }) => {
      let count = 0;
      for (const log of this.usageLogs.values()) {
        if (!where) {
          count++;
          continue;
        }
        let match = true;
        for (const [key, value] of Object.entries(where)) {
          if (key === 'createdAt') continue; // skip date filter
          if (log[key] !== value) {
            match = false;
            break;
          }
        }
        if (match) count++;
      }
      return { _count: count };
    },

    create: async ({ data }: { data: any }) => {
      const id = uuidv4();
      const log = { id, ...data, createdAt: new Date() };
      this.usageLogs.set(id, log);
      return log;
    },
  };

  $disconnect = async () => {};
  $connect = async () => {};

  /** Reset all in-memory data (call between tests) */
  reset() {
    this.jobs.clear();
    this.usageLogs.clear();
  }

  /**
   * Seed a job directly into the store.
   */
  seedJob(
    id: string,
    userId: string,
    status: string,
    sourceFormat: string,
    targetFormat: string,
    extra?: Record<string, any>,
  ) {
    const job = {
      id,
      userId,
      status,
      sourceFormat,
      targetFormat,
      sourceFileId: extra?.sourceFileId ?? `file-${sourceFormat}-${id.slice(0, 8)}`,
      options: extra?.options ?? {},
      formatFamily: extra?.formatFamily ?? 'image',
      resultFileId: extra?.resultFileId ?? null,
      errorMessage: extra?.errorMessage ?? null,
      idempotencyKey: extra?.idempotencyKey ?? null,
      createdAt: extra?.createdAt ?? new Date(),
      startedAt: extra?.startedAt ?? null,
      completedAt: extra?.completedAt ?? null,
    };
    this.jobs.set(id, job);
    return job;
  }

  /**
   * Seed usage log entries (to simulate quota consumption).
   */
  seedUsage(userId: string, count: number) {
    for (let i = 0; i < count; i++) {
      const id = uuidv4();
      this.usageLogs.set(id, {
        id,
        userId,
        quotaType: 'conversions',
        amount: 1,
        createdAt: new Date(),
      });
    }
  }
}
