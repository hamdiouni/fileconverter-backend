import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3003),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  /** Internal URL of the notification-service — used to trigger webhook delivery */
  NOTIFICATION_SERVICE_URL: z.string().url().default('http://notification-service:3005'),
  /** MinIO bucket where uploaded source files are stored */
  S3_BUCKET_UPLOADS: z.string().default('fileconverter-uploads'),
  /** MinIO bucket where converted result files should be stored */
  S3_BUCKET_RESULTS: z.string().default('fileconverter-results'),
  /** Orchestrator's own internal base URL — sent to workers as the callback address */
  ORCHESTRATOR_INTERNAL_URL: z.string().url().default('http://orchestrator-service:3003'),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (_env) return _env;

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.errors.map((e) => `  ${e.path.join('.')}: ${e.message}`).join('\n');
    throw new Error(`Missing or invalid environment variables:\n${errors}`);
  }

  _env = result.data;
  return _env;
}

export function resetEnvCache(): void {
  _env = null;
}
