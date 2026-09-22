#!/usr/bin/env node

/**
 * FileConverter Pro - Stripe Product & Price Setup Script
 *
 * Automatically creates the 4 products (Free, Pro, Business, Enterprise)
 * and recurring prices (Pro Monthly/Yearly, Business Monthly/Yearly) in Stripe.
 *
 * Usage:
 *   node scripts/setup-stripe-products.js [STRIPE_SECRET_KEY] [--update-env]
 *
 * Example:
 *   node scripts/setup-stripe-products.js sk_test_51... --update-env
 */

const fs = require('fs');
const path = require('path');

// Read arguments
const args = process.argv.slice(2);
const shouldUpdateEnv = args.includes('--update-env') || args.includes('-u');
const secretKeyArg = args.find(a => !a.startsWith('-'));

// Find backend .env file
const envPath = path.resolve(__dirname, '..', '.env');

function getSecretKeyFromEnv() {
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    const match = content.match(/^STRIPE_SECRET_KEY=(.+)$/m);
    if (match && match[1] && !match[1].includes('replace_with_real_key') && !match[1].includes('sk_test_mock')) {
      return match[1].trim();
    }
  }
  return null;
}

const STRIPE_SECRET_KEY = secretKeyArg || process.env.STRIPE_SECRET_KEY || getSecretKeyFromEnv();

if (!STRIPE_SECRET_KEY || STRIPE_SECRET_KEY.startsWith('sk_test_replace') || STRIPE_SECRET_KEY === 'sk_test_mock') {
  console.log(`
=============================================================================
  FileConverter Pro - Stripe Product & Price Provisioning
=============================================================================

[!] Missing Stripe Secret Key.

Please run this script with your real Stripe Secret Key:
  node scripts/setup-stripe-products.js <STRIPE_SECRET_KEY> [--update-env]

Example:
  node scripts/setup-stripe-products.js sk_test_51Abc... --update-env
  node scripts/setup-stripe-products.js sk_live_51Abc... --update-env

Flags:
  --update-env    Automatically writes generated price IDs into backend/.env
=============================================================================
`);
  process.exit(1);
}

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

async function stripeRequest(endpoint, method = 'GET', data = null) {
  const headers = {
    'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  let body = null;
  if (data) {
    const params = new URLSearchParams();
    function appendParams(prefix, value) {
      if (typeof value === 'object' && value !== null) {
        for (const [k, v] of Object.entries(value)) {
          appendParams(prefix ? `${prefix}[${k}]` : k, v);
        }
      } else {
        params.append(prefix, value);
      }
    }
    appendParams('', data);
    body = params.toString();
  }

  const res = await fetch(`${STRIPE_API_BASE}${endpoint}`, {
    method,
    headers,
    body: method !== 'GET' ? body : undefined,
  });

  const json = await res.json();
  if (!res.ok) {
    const errorMsg = json.error?.message || `HTTP ${res.status}`;
    throw new Error(`Stripe API error (${endpoint}): ${errorMsg}`);
  }
  return json;
}

async function findOrCreateProduct(name, description, metadata = {}) {
  // Check if product already exists
  const existing = await stripeRequest('/products?limit=100');
  const found = existing.data.find(p => p.name === name && p.active);
  if (found) {
    console.log(`  [OK] Product exists: "${name}" (${found.id})`);
    return found;
  }

  console.log(`  [+] Creating Product: "${name}"...`);
  const created = await stripeRequest('/products', 'POST', {
    name,
    description,
    metadata,
  });
  console.log(`  [OK] Created Product: "${name}" (${created.id})`);
  return created;
}

async function findOrCreateRecurringPrice(productId, unitAmountCents, currency, interval, metadata = {}) {
  const existing = await stripeRequest(`/prices?product=${productId}&active=true&limit=100`);
  const found = existing.data.find(p =>
    p.unit_amount === unitAmountCents &&
    p.currency.toLowerCase() === currency.toLowerCase() &&
    p.recurring?.interval === interval
  );
  if (found) {
    console.log(`    [OK] Price exists: ${unitAmountCents / 100} ${currency.toUpperCase()}/${interval} (${found.id})`);
    return found;
  }

  console.log(`    [+] Creating Price: ${unitAmountCents / 100} ${currency.toUpperCase()}/${interval}...`);
  const created = await stripeRequest('/prices', 'POST', {
    product: productId,
    unit_amount: unitAmountCents,
    currency,
    'recurring[interval]': interval,
    metadata,
  });
  console.log(`    [OK] Created Price: ${unitAmountCents / 100} ${currency.toUpperCase()}/${interval} (${created.id})`);
  return created;
}

async function main() {
  console.log(`
=============================================================================
  FileConverter Pro - Stripe Product & Price Setup
=============================================================================
`);

  console.log('1. Setting up 4 Products & Recurring Prices in Stripe...');

  // 1. Free Tier Product
  const freeProduct = await findOrCreateProduct(
    'FileConverter Free',
    'Free plan with 100 conversions/mo and 10MB file limit.',
    { tier: 'free' }
  );

  // 2. Pro Tier Product & Prices
  const proProduct = await findOrCreateProduct(
    'FileConverter Pro',
    'Professional plan with 1,000 conversions/mo, 100MB file limit, and API access.',
    { tier: 'pro' }
  );
  const proMonthly = await findOrCreateRecurringPrice(
    proProduct.id,
    2900, // $29.00
    'usd',
    'month',
    { tier: 'pro', interval: 'monthly' }
  );
  const proYearly = await findOrCreateRecurringPrice(
    proProduct.id,
    29000, // $290.00 (~$24/mo, 2 months free)
    'usd',
    'year',
    { tier: 'pro', interval: 'yearly' }
  );

  // 3. Business Tier Product & Prices
  const businessProduct = await findOrCreateProduct(
    'FileConverter Business',
    'Business plan with 10,000 conversions/mo, 500MB file limit, team features, and priority support.',
    { tier: 'business' }
  );
  const businessMonthly = await findOrCreateRecurringPrice(
    businessProduct.id,
    9900, // $99.00
    'usd',
    'month',
    { tier: 'business', interval: 'monthly' }
  );
  const businessYearly = await findOrCreateRecurringPrice(
    businessProduct.id,
    99000, // $990.00 (~$79/mo, 2 months free)
    'usd',
    'year',
    { tier: 'business', interval: 'yearly' }
  );

  // 4. Enterprise Tier Product
  const enterpriseProduct = await findOrCreateProduct(
    'FileConverter Enterprise',
    'Enterprise plan with custom SLA, dedicated support, unlimited conversions, and on-premise options.',
    { tier: 'enterprise' }
  );

  console.log('\n=============================================================================');
  console.log('  Credentials Summary for backend/.env');
  console.log('=============================================================================\n');

  const envLines = [
    `STRIPE_PRICE_PRO_MONTHLY=${proMonthly.id}`,
    `STRIPE_PRICE_PRO_YEARLY=${proYearly.id}`,
    `STRIPE_PRICE_BUSINESS_MONTHLY=${businessMonthly.id}`,
    `STRIPE_PRICE_BUSINESS_YEARLY=${businessYearly.id}`,
  ];

  console.log(envLines.join('\n'));

  // Update backend/.env if requested or automatically if file exists
  if (fs.existsSync(envPath)) {
    if (shouldUpdateEnv) {
      let content = fs.readFileSync(envPath, 'utf8');

      content = content.replace(/^STRIPE_SECRET_KEY=.*$/m, `STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}`);
      content = content.replace(/^STRIPE_PRICE_PRO_MONTHLY=.*$/m, `STRIPE_PRICE_PRO_MONTHLY=${proMonthly.id}`);
      content = content.replace(/^STRIPE_PRICE_PRO_YEARLY=.*$/m, `STRIPE_PRICE_PRO_YEARLY=${proYearly.id}`);
      content = content.replace(/^STRIPE_PRICE_BUSINESS_MONTHLY=.*$/m, `STRIPE_PRICE_BUSINESS_MONTHLY=${businessMonthly.id}`);
      content = content.replace(/^STRIPE_PRICE_BUSINESS_YEARLY=.*$/m, `STRIPE_PRICE_BUSINESS_YEARLY=${businessYearly.id}`);

      fs.writeFileSync(envPath, content, 'utf8');
      console.log('\n[SUCCESS] Updated backend/.env successfully with the new Price IDs.');
    } else {
      console.log('\n[INFO] To automatically update backend/.env, rerun with --update-env:');
      console.log('  node scripts/setup-stripe-products.js --update-env');
    }
  }

  console.log(`
=============================================================================
  Stripe Webhook Configuration Instructions
=============================================================================

1. Open Stripe Dashboard: https://dashboard.stripe.com/webhooks
2. Click "+ Add destination" / "Add endpoint"
3. Set Endpoint URL:
   https://api.yourdomain.com/api/v1/billing/webhook
   (or http://localhost:80/api/v1/billing/webhook via Stripe CLI forwarding)

4. Select these 3 events:
   - checkout.session.completed
   - customer.subscription.updated
   - customer.subscription.deleted

5. Reveal the "Signing secret" (whsec_...) and copy it into backend/.env:
   STRIPE_WEBHOOK_SECRET=whsec_...

=============================================================================
`);
}

main().catch(err => {
  console.error('\n[ERROR]', err.message);
  process.exit(1);
});
