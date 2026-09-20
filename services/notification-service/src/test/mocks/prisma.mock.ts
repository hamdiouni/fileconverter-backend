import { v4 as uuidv4 } from 'uuid';

/**
 * In-memory Prisma mock that simulates notification-related tables:
 * - webhookDelivery
 * - emailDelivery
 */
export class InMemoryPrismaClient {
  webhookDeliveries: Map<string, any> = new Map();
  emailDeliveries: Map<string, any> = new Map();

  webhookDelivery = {
    findMany: async ({ where, orderBy }: { where?: any; orderBy?: any } = {}) => {
      const results: any[] = [];
      for (const d of this.webhookDeliveries.values()) {
        if (!where) { results.push(d); continue; }
        let match = true;
        if (where.jobId && d.jobId !== where.jobId) match = false;
        if (match) results.push(d);
      }
      if (orderBy?.createdAt === 'desc') {
        results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      }
      return results;
    },
    create: async ({ data }: { data: any }) => {
      const record = {
        id: uuidv4(),
        ...data,
        createdAt: data.createdAt ?? new Date(),
      };
      this.webhookDeliveries.set(record.id, record);
      return record;
    },
  };

  emailDelivery = {
    findMany: async ({ where }: { where?: any } = {}) => {
      const results: any[] = [];
      for (const d of this.emailDeliveries.values()) {
        if (!where) { results.push(d); continue; }
        let match = true;
        if (where.to && d.to !== where.to) match = false;
        if (where.type && d.type !== where.type) match = false;
        if (where.status && d.status !== where.status) match = false;
        if (match) results.push(d);
      }
      return results;
    },
    create: async ({ data }: { data: any }) => {
      const record = {
        id: uuidv4(),
        ...data,
        createdAt: new Date(),
      };
      this.emailDeliveries.set(record.id, record);
      return record;
    },
  };

  $disconnect = async () => {};
  $connect = async () => {};

  /** Reset all in-memory data (call between tests) */
  reset() {
    this.webhookDeliveries.clear();
    this.emailDeliveries.clear();
  }

  /** Seed a webhook delivery record for testing */
  seedDelivery(jobId: string, status: string, attempts: number) {
    const record = {
      id: uuidv4(),
      jobId,
      url: 'https://example.com/webhook',
      attempt: attempts,
      statusCode: status === 'delivered' ? 200 : 503,
      status,
      createdAt: new Date(),
    };
    this.webhookDeliveries.set(record.id, record);
    return record;
  }
}
