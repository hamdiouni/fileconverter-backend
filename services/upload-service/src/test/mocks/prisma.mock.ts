import { v4 as uuidv4 } from 'uuid';

export class InMemoryPrismaClient {
  files: Map<string, any> = new Map();

  fileUpload = {
    create: async ({ data }: { data: any }) => {
      const record = { ...data, id: data.id ?? uuidv4() };
      this.files.set(record.id, record);
      return record;
    },
    findFirst: async ({ where }: { where: any }) => {
      for (const f of this.files.values()) {
        let match = true;
        if (where.id && f.id !== where.id) match = false;
        if (where.userId && f.userId !== where.userId) match = false;
        if (match) return f;
      }
      return null;
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      return this.files.get(where.id) ?? null;
    },
    update: async ({ where, data }: { where: { id: string }; data: any }) => {
      const f = this.files.get(where.id);
      if (!f) throw new Error('File not found');
      const updated = { ...f, ...data };
      this.files.set(where.id, updated);
      return updated;
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const f = this.files.get(where.id);
      this.files.delete(where.id);
      return f;
    },
  };

  users: Map<string, any> = new Map();

  user = {
    upsert: async ({ where, create, update }: any) => {
      let u = this.users.get(where.id);
      if (!u) {
        u = { ...create, id: where.id ?? create.id };
        this.users.set(where.id, u);
      } else {
        u = { ...u, ...update };
        this.users.set(where.id, u);
      }
      return u;
    },
    findUnique: async ({ where }: any) => {
      return this.users.get(where.id) ?? null;
    },
  };

  $disconnect = async () => {};
  reset() {
    this.files.clear();
    this.users.clear();
  }
}
