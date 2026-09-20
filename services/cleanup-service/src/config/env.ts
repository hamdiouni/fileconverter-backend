let cached: ReturnType<typeof load> | null = null;

function load() {
  return {
    DATABASE_URL: process.env['DATABASE_URL'] ?? 'postgresql://localhost/fileconverter',
    S3_ENDPOINT:  process.env['S3_ENDPOINT']  ?? 'http://localhost:9000',
    S3_BUCKET_UPLOADS: process.env['S3_BUCKET_UPLOADS'] ?? 'fileconverter-uploads',
    S3_BUCKET_RESULTS: process.env['S3_BUCKET_RESULTS'] ?? 'fileconverter-results',
    AWS_ACCESS_KEY_ID:     process.env['AWS_ACCESS_KEY_ID']     ?? 'minioadmin',
    AWS_SECRET_ACCESS_KEY: process.env['AWS_SECRET_ACCESS_KEY'] ?? 'minioadmin_dev',
    AWS_REGION:            process.env['AWS_REGION']            ?? 'us-east-1',
    CLEANUP_SCHEDULE_FILES:    process.env['CLEANUP_SCHEDULE_FILES']    ?? '0 2 * * *',
    CLEANUP_SCHEDULE_DB:       process.env['CLEANUP_SCHEDULE_DB']       ?? '0 3 * * *',
    CLEANUP_RETENTION_FREE:    parseInt(process.env['CLEANUP_RETENTION_FREE']    ?? '7',  10),
    CLEANUP_RETENTION_PRO:     parseInt(process.env['CLEANUP_RETENTION_PRO']     ?? '14', 10),
    CLEANUP_RETENTION_BUSINESS:parseInt(process.env['CLEANUP_RETENTION_BUSINESS']?? '30', 10),
    METRICS_PORT: parseInt(process.env['METRICS_PORT'] ?? '9090', 10),
    NODE_ENV: process.env['NODE_ENV'] ?? 'development',
  };
}

export function getEnv() {
  if (cached) return cached;
  cached = load();
  return cached;
}

export function resetEnvCache() {
  cached = null;
}
