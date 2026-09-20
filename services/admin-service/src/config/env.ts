let cached: any = null;

export function resetEnvCache() {
  cached = null;
}

export function getEnv() {
  if (cached) return cached;
  cached = {
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://localhost/test',
    REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
    JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? 'test-secret',
    PORT: parseInt(process.env.PORT ?? '3006', 10),
    ADMIN_ROLE: process.env.ADMIN_ROLE ?? 'admin',
  };
  return cached;
}
