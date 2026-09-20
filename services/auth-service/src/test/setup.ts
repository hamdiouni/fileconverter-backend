// Set test environment variables before any module loads
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test_access_secret_min_32_chars_long_xxxx';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_min_32_chars_long_xxx';
process.env.JWT_ACCESS_EXPIRY = '15m';
process.env.JWT_REFRESH_EXPIRY = '7d';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.PORT = '3000';
