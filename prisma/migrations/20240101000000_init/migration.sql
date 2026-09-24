-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "oauthProvider" TEXT,
    "oauthId" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "tier" TEXT NOT NULL DEFAULT 'free',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "userId" TEXT NOT NULL,
    "name" TEXT,
    "company" TEXT,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "name" TEXT,
    "permissions" TEXT[],
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "userId" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'free',
    "status" TEXT NOT NULL DEFAULT 'active',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stripeSubscriptionId" TEXT,
    "stripeCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "usage_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "quotaType" TEXT NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_uploads" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "contentType" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "virusScanStatus" TEXT NOT NULL DEFAULT 'pending',
    "uploadStatus" TEXT NOT NULL DEFAULT 'pending',
    "uploadedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversion_jobs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceFileId" TEXT NOT NULL,
    "sourceFormat" TEXT NOT NULL,
    "targetFormat" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "options" JSONB NOT NULL DEFAULT '{}',
    "formatFamily" TEXT NOT NULL,
    "conversionPath" TEXT[],
    "resultFileId" TEXT,
    "errorMessage" TEXT,
    "webhookUrl" TEXT,
    "idempotencyKey" TEXT,
    "workerId" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversion_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversion_cache" (
    "id" TEXT NOT NULL,
    "sourceFileHash" TEXT NOT NULL,
    "targetFormat" TEXT NOT NULL,
    "optionsHash" TEXT NOT NULL,
    "resultFileId" TEXT NOT NULL,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversion_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "webhookUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "statusCode" INTEGER,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_createdAt_idx" ON "users"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "refresh_tokens_tokenHash_idx" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "api_keys_userId_idx" ON "api_keys"("userId");

-- CreateIndex
CREATE INDEX "api_keys_keyHash_idx" ON "api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "subscriptions_stripeSubscriptionId_idx" ON "subscriptions"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "subscriptions_stripeCustomerId_idx" ON "subscriptions"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "usage_logs_userId_idx" ON "usage_logs"("userId");

-- CreateIndex
CREATE INDEX "usage_logs_userId_quotaType_idx" ON "usage_logs"("userId", "quotaType");

-- CreateIndex
CREATE INDEX "usage_logs_createdAt_idx" ON "usage_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "file_uploads_storageKey_key" ON "file_uploads"("storageKey");

-- CreateIndex
CREATE INDEX "file_uploads_userId_idx" ON "file_uploads"("userId");

-- CreateIndex
CREATE INDEX "file_uploads_uploadStatus_idx" ON "file_uploads"("uploadStatus");

-- CreateIndex
CREATE INDEX "file_uploads_expiresAt_idx" ON "file_uploads"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "conversion_jobs_idempotencyKey_key" ON "conversion_jobs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "conversion_jobs_userId_idx" ON "conversion_jobs"("userId");

-- CreateIndex
CREATE INDEX "conversion_jobs_status_idx" ON "conversion_jobs"("status");

-- CreateIndex
CREATE INDEX "conversion_jobs_createdAt_idx" ON "conversion_jobs"("createdAt");

-- CreateIndex
CREATE INDEX "conversion_jobs_idempotencyKey_idx" ON "conversion_jobs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "conversion_cache_sourceFileHash_targetFormat_idx" ON "conversion_cache"("sourceFileHash", "targetFormat");

-- CreateIndex
CREATE INDEX "conversion_cache_expiresAt_idx" ON "conversion_cache"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "conversion_cache_sourceFileHash_targetFormat_optionsHash_key" ON "conversion_cache"("sourceFileHash", "targetFormat", "optionsHash");

-- CreateIndex
CREATE INDEX "webhook_deliveries_jobId_idx" ON "webhook_deliveries"("jobId");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_idx" ON "webhook_deliveries"("status");

-- CreateIndex
CREATE INDEX "webhook_endpoints_userId_idx" ON "webhook_endpoints"("userId");

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_uploads" ADD CONSTRAINT "file_uploads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_jobs" ADD CONSTRAINT "conversion_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_jobs" ADD CONSTRAINT "conversion_jobs_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "file_uploads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
