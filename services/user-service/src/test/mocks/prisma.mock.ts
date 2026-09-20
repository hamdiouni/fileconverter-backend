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

  $disconnect = async () => {};
  $connect = async () => {};

  reset() {
    this.users.clear();
    this.userProfiles.clear();
    this.subscriptions.clear();
    this.usageLogs.clear();
  }

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
}
