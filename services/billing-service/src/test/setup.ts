process.env.JWT_ACCESS_SECRET = 'test-secret-key-for-testing-billing';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_mock_secret';
process.env.STRIPE_PRICE_PRO = 'price_pro_mock';
process.env.STRIPE_PRICE_BUSINESS = 'price_business_mock';
process.env.NODE_ENV = 'test';
