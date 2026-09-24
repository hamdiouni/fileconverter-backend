import { v4 as uuidv4 } from 'uuid';

/**
 * In-memory Prisma mock that simulates admin-related tables:
 * - user
 * - conversionJob
 */
export class InMemoryPrismaClient {
  private users: Map<string, any> = new Map();
  private jobs: Map<string, any> = new Map();

  user = {
    findUnique: async ({ where }: { where: any }) => {
      return this.users.get(where.id) ?? null;
    },
    findMany: async ({ where, skip = 0, take = 20, orderBy }: any = {}) => {
      let results: any[] = Array.from(this.users.values());
      if (where) {
        if (where.tier !== undefined) results = results.filter((u) => u.tier === where.tier);
        if (where.suspended !== undefined)
          results = results.filter((u) => u.suspended === where.suspended);
      }
      // Sort by createdAt desc
      results.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      return results.slice(skip, skip + take);
    },
    count: async ({ where }: { where?: any } = {}) => {
      let results: any[] = Array.from(this.users.values());
      if (where) {
        if (where.tier !== undefined) results = results.filter((u) => u.tier === where.tier);
        if (where.suspended !== undefined)
          results = results.filter((u) => u.suspended === where.suspended);
      }
      return results.length;
    },
    update: async ({ where, data }: { where: any; data: any }) => {
      const user = this.users.get(where.id);
      if (!user) throw new Error('User not found');
      const updated = { ...user, ...data, updatedAt: new Date() };
      this.users.set(where.id, updated);
      return updated;
    },
  };

  conversionJob = {
    findUnique: async ({ where }: { where: any }) => {
      return this.jobs.get(where.id) ?? null;
    },
    findMany: async ({ where, skip = 0, take = 20, orderBy }: any = {}) => {
      let results: any[] = Array.from(this.jobs.values());
      if (where) {
        if (where.userId !== undefined)
          results = results.filter((j) => j.userId === where.userId);
        if (where.status !== undefined) results = results.filter((j) => j.status === where.status);
      }
      results.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      return results.slice(skip, skip + take);
    },
    count: async ({ where }: { where?: any } = {}) => {
      let results: any[] = Array.from(this.jobs.values());
      if (where) {
        if (where.userId !== undefined)
          results = results.filter((j) => j.userId === where.userId);
        if (where.status !== undefined) results = results.filter((j) => j.status === where.status);
      }
      return results.length;
    },
    update: async ({ where, data }: { where: any; data: any }) => {
      const job = this.jobs.get(where.id);
      if (!job) throw new Error('Job not found');
      const updated = { ...job, ...data, updatedAt: new Date() };
      this.jobs.set(where.id, updated);
      return updated;
    },
  };

  $disconnect = async () => {};
  $connect = async () => {};

  /** Reset all in-memory data (call between tests) */
  reset() {
    this.users.clear();
    this.jobs.clear();
  }

  /** Seed a user for testing */
  seedUser(
    id: string,
    email: string,
    tier: string,
    suspended = false,
  ) {
    const user = {
      id,
      email,
      tier,
      suspended,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.users.set(id, user);
    return user;
  }

  /** Seed a conversion job for testing */
  seedJob(
    id: string,
    userId: string,
    status: string,
    sourceFormat = 'pdf',
    targetFormat = 'docx',
  ) {
    const job = {
      id,
      userId,
      status,
      sourceFormat,
      targetFormat,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.jobs.set(id, job);
    return job;
  }

  $queryRaw = async (..._args: any[]) => [{ 1: 1 }];
}
