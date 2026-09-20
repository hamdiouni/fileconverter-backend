let cached: any = null;

export function resetEnvCache() {
  cached = null;
}

export function getEnv() {
  if (cached) return cached;
  cached = {
    DATABASE_URL: process.env.DATABASE_URL ?? '',
    REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
    JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? 'secret',
    SENDGRID_API_KEY: process.env.SENDGRID_API_KEY ?? '',
    WEBHOOK_HMAC_SECRET: process.env.WEBHOOK_HMAC_SECRET ?? 'secret',
    PORT: parseInt(process.env.PORT ?? '3005', 10),
  };
  return cached;
}
