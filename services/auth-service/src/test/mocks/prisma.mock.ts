import { v4 as uuidv4 } from 'uuid';

/**
 * In-memory Prisma mock that simulates the auth-related tables:
 * - user
 * - refreshToken
 * - apiKey
 */
export class InMemoryPrismaClient {
  users: Map<string, any> = new Map();
  refreshTokens: Map<string, any> = new Map();
  apiKeys: Map<string, any> = new Map();

  user = {
    findUnique: async ({ where }: { where: { email?: string; id?: string } }) => {
      if (where.email) {
        for (const u of this.users.values()) {
          if (u.email === where.email) return u;
        }
        return null;
      }
      if (where.id) {
        return this.users.get(where.id) ?? null;
      }
      return null;
    },
    findFirst: async ({
      where,
    }: {
      where: { oauthProvider?: string; oauthId?: string; email?: string };
    }) => {
      for (const u of this.users.values()) {
        let match = true;
        if (where.oauthProvider !== undefined && u.oauthProvider !== where.oauthProvider)
          match = false;
        if (where.oauthId !== undefined && u.oauthId !== where.oauthId) match = false;
        if (where.email !== undefined && u.email !== where.email) match = false;
        if (match) return u;
      }
      return null;
    },
    create: async ({ data }: { data: any }) => {
      const user = {
        id: uuidv4(),
        email: data.email,
        passwordHash: data.passwordHash ?? null,
        oauthProvider: data.oauthProvider ?? null,
        oauthId: data.oauthId ?? null,
        emailVerified: false,
        tier: data.tier ?? 'free',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      this.users.set(user.id, user);
      return user;
    },
    update: async ({ where, data }: { where: { id: string }; data: any }) => {
      const user = this.users.get(where.id);
      if (!user) throw new Error('User not found');
      const updated = { ...user, ...data, updatedAt: new Date() };
      this.users.set(where.id, updated);
      return updated;
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const user = this.users.get(where.id);
      this.users.delete(where.id);
      return user;
    },
  };

  refreshToken = {
    findFirst: async ({
      where,
    }: {
      where: { tokenHash?: string; userId?: string; id?: string };
    }) => {
      for (const t of this.refreshTokens.values()) {
        let match = true;
        if (where.tokenHash !== undefined && t.tokenHash !== where.tokenHash) match = false;
        if (where.userId !== undefined && t.userId !== where.userId) match = false;
        if (where.id !== undefined && t.id !== where.id) match = false;
        if (match) return t;
      }
      return null;
    },
    create: async ({ data }: { data: any }) => {
      const token = {
        id: uuidv4(),
        userId: data.userId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
        createdAt: new Date(),
      };
      this.refreshTokens.set(token.id, token);
      return token;
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const token = this.refreshTokens.get(where.id);
      this.refreshTokens.delete(where.id);
      return token;
    },
    deleteMany: async ({ where }: { where: { userId?: string } }) => {
      let count = 0;
      for (const [id, t] of this.refreshTokens.entries()) {
        if (where.userId && t.userId === where.userId) {
          this.refreshTokens.delete(id);
          count++;
        }
      }
      return { count };
    },
  };

  apiKey = {
    findFirst: async ({ where }: { where: { id?: string; userId?: string; keyHash?: string } }) => {
      for (const k of this.apiKeys.values()) {
        let match = true;
        if (where.id !== undefined && k.id !== where.id) match = false;
        if (where.userId !== undefined && k.userId !== where.userId) match = false;
        if (where.keyHash !== undefined && k.keyHash !== where.keyHash) match = false;
        if (match) return k;
      }
      return null;
    },
    findMany: async ({ where, orderBy }: { where?: { userId?: string }; orderBy?: any }) => {
      let results: any[] = [];
      for (const k of this.apiKeys.values()) {
        if (!where?.userId || k.userId === where.userId) {
          results.push(k);
        }
      }
      if (orderBy?.createdAt === 'desc') {
        results = results.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
      }
      return results;
    },
    create: async ({ data }: { data: any }) => {
      const key = {
        id: uuidv4(),
        userId: data.userId,
        keyHash: data.keyHash,
        name: data.name ?? null,
        permissions: data.permissions ?? [],
        expiresAt: data.expiresAt ?? null,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: new Date(),
      };
      this.apiKeys.set(key.id, key);
      return key;
    },
    update: async ({ where, data }: { where: { id: string }; data: any }) => {
      const key = this.apiKeys.get(where.id);
      if (!key) throw new Error('API key not found');
      const updated = { ...key, ...data };
      this.apiKeys.set(where.id, updated);
      return updated;
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const key = this.apiKeys.get(where.id);
      this.apiKeys.delete(where.id);
      return key;
    },
  };

  userProfiles: Map<string, any> = new Map();

  userProfile = {
    upsert: async ({ where, update, create }: { where: { userId: string }; update: any; create: any }) => {
      const existing = this.userProfiles.get(where.userId);
      if (existing) {
        const updated = { ...existing, ...update, updatedAt: new Date() };
        this.userProfiles.set(where.userId, updated);
        return updated;
      }
      const created = { ...create, createdAt: new Date(), updatedAt: new Date() };
      this.userProfiles.set(where.userId, created);
      return created;
    },
  };

  $queryRaw = async (..._args: any[]) => [{ 1: 1 }];
  $disconnect = async () => {};
  $connect = async () => {};

  /** Reset all in-memory data (call between tests) */
  reset() {
    this.users.clear();
    this.refreshTokens.clear();
    this.apiKeys.clear();
    this.userProfiles.clear();
  }
}
