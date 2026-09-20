/**
 * Subscription tier levels for FileConverter Pro
 */
export type SubscriptionTier = 'free' | 'pro' | 'business' | 'enterprise';

/**
 * Core user record (matches database users table)
 */
export interface User {
  id: string;
  email: string;
  passwordHash: string | null;
  oauthProvider: string | null;
  oauthId: string | null;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/**
 * User profile information (matches database user_profiles table)
 */
export interface UserProfile {
  userId: string;
  email: string;
  name: string | null;
  company: string | null;
  avatar: string | null;
  tier: SubscriptionTier;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * User subscription details (matches database subscriptions table)
 */
export interface Subscription {
  userId: string;
  tier: SubscriptionTier;
  status: 'active' | 'cancelled' | 'past_due' | 'paused';
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Quota limits per subscription tier
 */
export interface SubscriptionQuotas {
  conversionsPerMonth: number;
  maxFileSize: number;
  apiCallsPerMonth: number;
  storageRetentionDays: number;
  priorityProcessing: boolean;
  whiteLabel: boolean;
}

/**
 * Current usage statistics for a user
 */
export interface UsageStats {
  conversionsThisMonth: number;
  apiCallsThisMonth: number;
  storageUsed: number;
  quotas: SubscriptionQuotas;
  resetDate: Date;
}

/**
 * Result of a quota check
 */
export interface QuotaCheck {
  allowed: boolean;
  remaining: number;
  resetDate: Date;
  reason?: string;
}

/**
 * Types of quotas tracked per user
 */
export type QuotaType = 'conversions' | 'api_calls' | 'storage';
