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
    PORT: parseInt(process.env.PORT ?? '3004', 10),
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ?? 'sk_test_mock',
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_mock_secret',
    STRIPE_PRICE_FREE: process.env.STRIPE_PRICE_FREE ?? 'price_free',
    STRIPE_PRICE_PRO: process.env.STRIPE_PRICE_PRO ?? process.env.STRIPE_PRICE_PRO_MONTHLY ?? 'price_pro_mock',
    STRIPE_PRICE_PRO_MONTHLY: process.env.STRIPE_PRICE_PRO_MONTHLY ?? process.env.STRIPE_PRICE_PRO ?? 'price_pro_mock',
    STRIPE_PRICE_PRO_YEARLY: process.env.STRIPE_PRICE_PRO_YEARLY ?? 'price_pro_yearly_mock',
    STRIPE_PRICE_BUSINESS: process.env.STRIPE_PRICE_BUSINESS ?? process.env.STRIPE_PRICE_BUSINESS_MONTHLY ?? 'price_business_mock',
    STRIPE_PRICE_BUSINESS_MONTHLY: process.env.STRIPE_PRICE_BUSINESS_MONTHLY ?? process.env.STRIPE_PRICE_BUSINESS ?? 'price_business_mock',
    STRIPE_PRICE_BUSINESS_YEARLY: process.env.STRIPE_PRICE_BUSINESS_YEARLY ?? 'price_business_yearly_mock',
  };
  return cached;
}
