import { v4 as uuidv4 } from 'uuid';

export class InMemoryPrismaClient {
  users: Map<string, any> = new Map();
  userProfiles: Map<string, any> = new Map();
  subscriptions: Map<string, any> = new Map();
  usageLogs: Map<string, any> = new Map();

  user = {
    findUnique: async ({ where }: { where: { id?: string; email?: string } }) => {
      if (where.id) return this.users.get(where.id) ?? null;
      if (where.email) {
        for (const u of this.users.values()) {
          if (u.email === where.email) return u;
        }
      }
      return null;
    },
    update: async ({ where, data }: { where: { id: string }; data: any }) => {
      const user = this.users.get(where.id);
      if (!user) throw new Error('User not found');
      const updated = { ...user, ...data, updatedAt: new Date() };
      this.users.set(where.id, updated);
      return updated;
    },
    create: async ({ data }: { data: any }) => {
      const user = {
        id: data.id ?? uuidv4(),
        email: data.email,
        tier: data.tier ?? 'free',
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.users.set(user.id, user);
      return user;
    },
  };

  userProfile = {
    findUnique: async ({ where }: { where: { userId: string } }) => {
      return this.userProfiles.get(where.userId) ?? null;
    },
    upsert: async ({ where, update, create }: { where: { userId: string }; update: any; create: any }) => {
      const existing = this.userProfiles.get(where.userId);
      if (existing) {
        const updated = { ...existing, ...update, updatedAt: new Date() };
        this.userProfiles.set(where.userId, updated);
        return updated;
      }
      const created = { userId: where.userId, ...create, createdAt: new Date(), updatedAt: new Date() };
      this.userProfiles.set(where.userId, created);
      return created;
    },
  };

  subscription = {
    findUnique: async ({ where }: { where: { userId: string } }) => {
      return this.subscriptions.get(where.userId) ?? null;
    },
    upsert: async ({ where, update, create }: { where: { userId: string }; update: any; create: any }) => {
      const existing = this.subscriptions.get(where.userId);
      if (existing) {
        const updated = { ...existing, ...update, updatedAt: new Date() };
        this.subscriptions.set(where.userId, updated);
        return updated;
      }
      const created = { userId: where.userId, ...create };
      this.subscriptions.set(where.userId, created);
      return created;
    },
  };

  usageLog = {
    create: async ({ data }: { data: any }) => {
      const log = { id: uuidv4(), ...data, createdAt: data.createdAt ?? new Date() };
      this.usageLogs.set(log.id, log);
      return log;
    },
    aggregate: async ({ where, _sum }: { where: any; _sum: any }) => {
      let total = 0;
      for (const log of this.usageLogs.values()) {
        let match = true;
        if (where.userId && log.userId !== where.userId) match = false;
        if (where.quotaType && log.quotaType !== where.quotaType) match = false;
        if (where.createdAt?.gte && log.createdAt < where.createdAt.gte) match = false;
        if (where.createdAt?.lt && log.createdAt >= where.createdAt.lt) match = false;
        if (match) total += log.amount;
      }
      return { _sum: { amount: total } };
    },
    deleteMany: async ({ where }: { where: any }) => {
      let count = 0;
      for (const [id, log] of this.usageLogs.entries()) {
        let match = true;
        if (where.userId && log.userId !== where.userId) match = false;
        if (where.createdAt?.lt && log.createdAt >= where.createdAt.lt) match = false;
        if (match) { this.usageLogs.delete(id); count++; }
      }
      return { count };
    },
  };

  webhookEndpoints: Map<string, any> = new Map();
  webhookDeliveries: Map<string, any> = new Map();

  webhookEndpoint = {
    findMany: async ({ where, orderBy }: { where?: { userId?: string }; orderBy?: any }) => {
      let results: any[] = [];
      for (const ep of this.webhookEndpoints.values()) {
        if (!where?.userId || ep.userId === where.userId) {
          results.push(ep);
        }
      }
      if (orderBy?.createdAt === 'desc') {
        results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      }
      return results;
    },
    findFirst: async ({ where }: { where: { id?: string; userId?: string } }) => {
      for (const ep of this.webhookEndpoints.values()) {
        let match = true;
        if (where.id && ep.id !== where.id) match = false;
        if (where.userId && ep.userId !== where.userId) match = false;
        if (match) return ep;
      }
      return null;
    },
    create: async ({ data }: { data: any }) => {
      const ep = {
        id: uuidv4(),
        userId: data.userId,
        url: data.url,
        secret: data.secret,
        events: data.events,
        active: data.active ?? true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.webhookEndpoints.set(ep.id, ep);
      return ep;
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const ep = this.webhookEndpoints.get(where.id);
      this.webhookEndpoints.delete(where.id);
      return ep;
    },
  };

  webhookDelivery = {
    findFirst: async ({ where, orderBy }: { where?: { webhookUrl?: string }; orderBy?: any }) => {
      let matches: any[] = [];
      for (const d of this.webhookDeliveries.values()) {
        if (!where?.webhookUrl || d.webhookUrl === where.webhookUrl) {
          matches.push(d);
        }
      }
      if (orderBy?.createdAt === 'desc') {
        matches.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      }
      return matches[0] ?? null;
    },
  };

  $disconnect = async () => {};
  $connect = async () => {};

  reset() {
    this.users.clear();
    this.userProfiles.clear();
    this.subscriptions.clear();
    this.usageLogs.clear();
    this.webhookEndpoints.clear();
    this.webhookDeliveries.clear();
    this.apiKeys.clear();
  }

  apiKeys: Map<string, any> = new Map();

  apiKey = {
    findFirst: async ({ where, include }: { where?: { keyHash?: string; revokedAt?: any }; include?: any }) => {
      for (const k of this.apiKeys.values()) {
        if (where?.keyHash && k.keyHash !== where.keyHash) continue;
        if (where?.revokedAt === null && k.revokedAt !== null) continue;
        const res = { ...k };
        if (include?.user) {
          res.user = this.users.get(k.userId) ?? null;
        }
        return res;
      }
      return null;
    },
    update: async ({ where, data }: { where: { id: string }; data: any }) => {
      const k = this.apiKeys.get(where.id);
      if (k) Object.assign(k, data);
      return k;
    },
  };

  /** Seed a default test user */
  seedUser(id = 'user-1', email = 'test@example.com', tier = 'free') {
    const now = new Date();
    this.users.set(id, { id, email, tier, deletedAt: null, createdAt: now, updatedAt: now });
    this.userProfiles.set(id, { userId: id, name: null, company: null, avatarUrl: null, preferences: {}, createdAt: now, updatedAt: now });
    this.subscriptions.set(id, {
      userId: id,
      tier,
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 1),
      stripeSubscriptionId: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Seed an API key */
  seedApiKey(id = 'key-1', userId = 'user-1', keyHash = 'samplehash', permissions = ['*']) {
    this.apiKeys.set(id, {
      id,
      userId,
      keyHash,
      name: 'Test Key',
      permissions,
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
      createdAt: new Date(),
    });
  }

  $queryRaw = async (..._args: any[]) => [{ 1: 1 }];
}
