import { v4 as uuidv4 } from 'uuid';

/**
 * In-memory Prisma mock that simulates billing-related tables:
 * - subscription
 * - invoice
 * - usageLog
 */
export class InMemoryPrismaClient {
  subscriptions: Map<string, any> = new Map();
  invoices: Map<string, any> = new Map();
  usageLogs: Map<string, any> = new Map();

  subscription = {
    findFirst: async ({ where }: { where: any }) => {
      for (const s of this.subscriptions.values()) {
        if (where.userId && s.userId !== where.userId) continue;
        if (where.stripeSubscriptionId && s.stripeSubscriptionId !== where.stripeSubscriptionId) continue;
        return s;
      }
      return null;
    },
    findMany: async ({ where }: { where?: any } = {}) => {
      const results: any[] = [];
      for (const s of this.subscriptions.values()) {
        if (!where) { results.push(s); continue; }
        let match = true;
        if (where.userId && s.userId !== where.userId) match = false;
        if (where.stripeSubscriptionId && s.stripeSubscriptionId !== where.stripeSubscriptionId) match = false;
        if (match) results.push(s);
      }
      return results;
    },
    upsert: async ({ where, create, update }: { where: any; create: any; update: any }) => {
      // Find existing by stripeSubscriptionId or userId
      let existing: any = null;
      let existingKey: string | null = null;
      for (const [key, s] of this.subscriptions.entries()) {
        if (where.userId && s.userId === where.userId) {
          existing = s;
          existingKey = key;
          break;
        }
        if (where.stripeSubscriptionId && s.stripeSubscriptionId === where.stripeSubscriptionId) {
          existing = s;
          existingKey = key;
          break;
        }
      }
      if (existing && existingKey) {
        const updated = { ...existing, ...update, updatedAt: new Date() };
        this.subscriptions.set(existingKey, updated);
        return updated;
      } else {
        const sub = {
          id: uuidv4(),
          ...create,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        this.subscriptions.set(sub.id, sub);
        return sub;
      }
    },
    updateMany: async ({ where, data }: { where: any; data: any }) => {
      let count = 0;
      for (const [key, s] of this.subscriptions.entries()) {
        let match = true;
        if (where.stripeSubscriptionId && s.stripeSubscriptionId !== where.stripeSubscriptionId) match = false;
        if (where.userId && s.userId !== where.userId) match = false;
        if (match) {
          this.subscriptions.set(key, { ...s, ...data, updatedAt: new Date() });
          count++;
        }
      }
      return { count };
    },
    create: async ({ data }: { data: any }) => {
      const sub = {
        id: uuidv4(),
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.subscriptions.set(sub.id, sub);
      return sub;
    },
  };

  invoice = {
    findFirst: async ({ where }: { where: any }) => {
      for (const inv of this.invoices.values()) {
        let match = true;
        if (where.userId && inv.userId !== where.userId) match = false;
        if (where.stripeInvoiceId && inv.stripeInvoiceId !== where.stripeInvoiceId) match = false;
        if (where.status && inv.status !== where.status) match = false;
        if (match) return inv;
      }
      return null;
    },
    findMany: async ({ where }: { where?: any } = {}) => {
      const results: any[] = [];
      for (const inv of this.invoices.values()) {
        if (!where) { results.push(inv); continue; }
        let match = true;
        if (where.userId && inv.userId !== where.userId) match = false;
        if (where.status && inv.status !== where.status) match = false;
        if (match) results.push(inv);
      }
      return results;
    },
    create: async ({ data }: { data: any }) => {
      const inv = {
        id: uuidv4(),
        ...data,
        createdAt: new Date(),
      };
      this.invoices.set(inv.id, inv);
      return inv;
    },
  };

  usageLog = {
    findMany: async ({ where }: { where?: any } = {}) => {
      const results: any[] = [];
      for (const log of this.usageLogs.values()) {
        if (!where) { results.push(log); continue; }
        let match = true;
        if (where.userId && log.userId !== where.userId) match = false;
        if (where.createdAt?.gte && new Date(log.createdAt) < new Date(where.createdAt.gte)) match = false;
        if (match) results.push(log);
      }
      return results;
    },
    create: async ({ data }: { data: any }) => {
      const log = {
        id: uuidv4(),
        ...data,
        createdAt: data.createdAt ?? new Date(),
      };
      this.usageLogs.set(log.id, log);
      return log;
    },
  };

  users: Map<string, any> = new Map();

  user = {
    update: async ({ where, data }: { where: any; data: any }) => {
      const u = this.users.get(where.id) ?? { id: where.id, tier: 'free' };
      const updated = { ...u, ...data, updatedAt: new Date() };
      this.users.set(where.id, updated);
      return updated;
    },
    findUnique: async ({ where }: { where: any }) => {
      return this.users.get(where.id) ?? null;
    },
  };

  $disconnect = async () => {};
  $connect = async () => {};
  $queryRaw = async (..._args: any[]) => [{ 1: 1 }];

  /** Reset all in-memory data (call between tests) */
  reset() {
    this.subscriptions.clear();
    this.invoices.clear();
    this.usageLogs.clear();
    this.users.clear();
  }

  /** Seed a subscription for testing */
  seedSubscription(userId: string, tier: string, status: string) {
    const sub = {
      id: uuidv4(),
      userId,
      stripeSubscriptionId: `sub_mock_${userId}`,
      stripeCustomerId: `cus_mock_${userId}`,
      tier,
      status,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.subscriptions.set(sub.id, sub);
    return sub;
  }

  /** Seed a usage log for testing */
  seedUsageLog(userId: string, quotaType: string, amount: number, createdAt?: Date) {
    const log = {
      id: uuidv4(),
      userId,
      quotaType,
      amount,
      createdAt: createdAt ?? new Date(),
    };
    this.usageLogs.set(log.id, log);
    return log;
  }
}
