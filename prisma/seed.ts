/**
 * Prisma seed script — creates development user accounts and sample data.
 * Requirements: 17.4
 *
 * Run with: npx ts-node prisma/seed.ts
 * Or via:   npx prisma db seed
 */
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  // Simple SHA-256 hash for seed data (bcrypt not needed in seed)
  return crypto.createHash('sha256').update(password).digest('hex');
}

async function main() {
  console.log('🌱 Seeding database...');

  // ── Users (one per tier) ────────────────────────────────────────────────
  const users = await Promise.all([
    prisma.user.upsert({
      where: { email: 'free@dev.local' },
      update: {},
      create: {
        email: 'free@dev.local',
        passwordHash: hashPassword('dev-password-free'),
        emailVerified: true,
        tier: 'free',
        profile: { create: { name: 'Free Dev User', company: 'Dev Co' } },
        subscription: {
          create: {
            tier: 'free',
            status: 'active',
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        },
      },
    }),
    prisma.user.upsert({
      where: { email: 'pro@dev.local' },
      update: {},
      create: {
        email: 'pro@dev.local',
        passwordHash: hashPassword('dev-password-pro'),
        emailVerified: true,
        tier: 'pro',
        profile: { create: { name: 'Pro Dev User', company: 'Dev Co' } },
        subscription: {
          create: {
            tier: 'pro',
            status: 'active',
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            stripeSubscriptionId: 'sub_dev_pro_001',
            stripeCustomerId: 'cus_dev_pro_001',
          },
        },
      },
    }),
    prisma.user.upsert({
      where: { email: 'business@dev.local' },
      update: {},
      create: {
        email: 'business@dev.local',
        passwordHash: hashPassword('dev-password-biz'),
        emailVerified: true,
        tier: 'business',
        profile: { create: { name: 'Business Dev User', company: 'Acme Corp' } },
        subscription: {
          create: {
            tier: 'business',
            status: 'active',
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            stripeSubscriptionId: 'sub_dev_biz_001',
            stripeCustomerId: 'cus_dev_biz_001',
          },
        },
      },
    }),
  ]);

  console.log(`✅ Created ${users.length} users`);

  // ── Sample file uploads ──────────────────────────────────────────────────
  const freeUser = users[0]!;
  const sevenDaysAhead = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const uploads = await Promise.all([
    prisma.fileUpload.upsert({
      where: { storageKey: 'uploads/seed/sample-image.jpg' },
      update: {},
      create: {
        userId: freeUser.id,
        filename: 'sample-image.jpg',
        originalFilename: 'sample-image.jpg',
        size: 204800,
        contentType: 'image/jpeg',
        storageKey: 'uploads/seed/sample-image.jpg',
        virusScanStatus: 'clean',
        uploadStatus: 'uploaded',
        uploadedAt: new Date(),
        expiresAt: sevenDaysAhead,
      },
    }),
    prisma.fileUpload.upsert({
      where: { storageKey: 'uploads/seed/sample-document.pdf' },
      update: {},
      create: {
        userId: freeUser.id,
        filename: 'sample-document.pdf',
        originalFilename: 'sample-document.pdf',
        size: 102400,
        contentType: 'application/pdf',
        storageKey: 'uploads/seed/sample-document.pdf',
        virusScanStatus: 'clean',
        uploadStatus: 'uploaded',
        uploadedAt: new Date(),
        expiresAt: sevenDaysAhead,
      },
    }),
  ]);

  console.log(`✅ Created ${uploads.length} sample file uploads`);

  // ── Sample conversion jobs ───────────────────────────────────────────────
  const jobs = await Promise.all([
    prisma.conversionJob.create({
      data: {
        userId: freeUser.id,
        sourceFileId: uploads[0]!.id,
        sourceFormat: 'jpg',
        targetFormat: 'webp',
        status: 'completed',
        formatFamily: 'image',
        conversionPath: ['jpg', 'webp'],
        resultFileId: 'results/seed/sample-image.webp',
        createdAt: new Date(Date.now() - 60000),
        completedAt: new Date(),
        updatedAt: new Date(),
      },
    }),
    prisma.conversionJob.create({
      data: {
        userId: freeUser.id,
        sourceFileId: uploads[1]!.id,
        sourceFormat: 'pdf',
        targetFormat: 'docx',
        status: 'queued',
        formatFamily: 'document',
        conversionPath: ['pdf', 'docx'],
        updatedAt: new Date(),
      },
    }),
  ]);

  console.log(`✅ Created ${jobs.length} sample conversion jobs`);
  console.log('🌱 Seed complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
