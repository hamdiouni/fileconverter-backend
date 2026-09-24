import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { PrismaClient } from '@prisma/client';
import type IORedis from 'ioredis';
import { getEnv } from '../config/env';

export interface RegisterInput {
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface AuthUser {
  id: string;
  email: string;
  tier?: string;
}

export interface RegisterResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
  user: AuthUser;
}

export interface ApiKeyResult {
  id: string;
  key: string;
  name: string | null;
  permissions: string[];
  expiresAt: Date | null;
  createdAt: Date;
}

export interface ApiKeyListItem {
  id: string;
  name: string | null;
  permissions: string[];
  expiresAt: Date | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export class AuthService {
  constructor(
    private prisma: PrismaClient,
    private redis: IORedis,
  ) {}

  private generateTokens(
    userId: string,
    email: string,
    tier: string = 'free',
    permissions: string[] = [],
  ): AuthTokens {
    const env = getEnv();

    const jti = crypto.randomBytes(16).toString('hex');

    const accessToken = jwt.sign(
      {
        userId,
        email,
        tier,
        permissions,
        jti,
      },
      env.JWT_ACCESS_SECRET,
      { expiresIn: env.JWT_ACCESS_EXPIRY } as jwt.SignOptions,
    );

    const refreshToken = jwt.sign(
      { userId, email, jti },
      env.JWT_REFRESH_SECRET,
      { expiresIn: env.JWT_REFRESH_EXPIRY } as jwt.SignOptions,
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: 15 * 60, // 15 minutes in seconds
      tokenType: 'Bearer',
    };
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private getRefreshTokenExpiry(): Date {
    const env = getEnv();
    const expiry = env.JWT_REFRESH_EXPIRY;
    const days = expiry.endsWith('d') ? parseInt(expiry.slice(0, -1), 10) : 7;
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  /**
   * Bootstraps the initial admin account if configured in environment.
   */
  async bootstrapAdmin(adminEmail?: string, adminPassword?: string): Promise<void> {
    if (!adminEmail || !adminPassword) return;
    const email = adminEmail.toLowerCase().trim();
    if (!email) return;

    const existing = await (this.prisma as any).user.findUnique({ where: { email } });
    if (!existing) {
      const passwordHash = await bcrypt.hash(adminPassword, 12);
      await (this.prisma as any).user.create({
        data: {
          email,
          passwordHash,
          tier: 'admin',
          emailVerified: true,
          profile: {
            create: { name: 'System Administrator' },
          },
        },
      });
    } else if (existing.tier !== 'admin') {
      await (this.prisma as any).user.update({
        where: { id: existing.id },
        data: { tier: 'admin' },
      });
    }
  }

  async register(input: RegisterInput): Promise<RegisterResult> {
    const { email, password } = input;

    // Check for existing user
    const existing = await (this.prisma as any).user.findUnique({
      where: { email },
    });

    if (existing) {
      const err = new Error('Email already in use') as Error & { statusCode: number };
      err.statusCode = 409;
      throw err;
    }

    // Hash password with bcrypt cost 12
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user
    const user = await (this.prisma as any).user.create({
      data: {
        email,
        passwordHash,
      },
    });

    // Generate tokens
    const userTier = user.tier ?? 'free';
    const tokens = this.generateTokens(user.id, user.email, userTier);

    // Store refresh token hash
    await (this.prisma as any).refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(tokens.refreshToken),
        expiresAt: this.getRefreshTokenExpiry(),
      },
    });

    // Cache session in Redis
    await this.redis.setex(
      `session:${user.id}`,
      15 * 60,
      JSON.stringify({ email: user.email, tier: userTier, permissions: [] }),
    );

    return {
      ...tokens,
      user: { id: user.id, email: user.email, tier: userTier },
    };
  }

  async login(input: LoginInput): Promise<RegisterResult> {
    const { email, password } = input;

    const user = await (this.prisma as any).user.findUnique({
      where: { email },
    });

    if (!user || !user.passwordHash) {
      const err = new Error('Invalid credentials') as Error & { statusCode: number };
      err.statusCode = 401;
      throw err;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      const err = new Error('Invalid credentials') as Error & { statusCode: number };
      err.statusCode = 401;
      throw err;
    }

    // Generate tokens
    const userTier = user.tier ?? 'free';
    const tokens = this.generateTokens(user.id, user.email, userTier);

    // Store new refresh token
    await (this.prisma as any).refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(tokens.refreshToken),
        expiresAt: this.getRefreshTokenExpiry(),
      },
    });

    // Update session cache
    await this.redis.setex(
      `session:${user.id}`,
      15 * 60,
      JSON.stringify({ email: user.email, tier: userTier, permissions: [] }),
    );

    return {
      ...tokens,
      user: { id: user.id, email: user.email, tier: userTier },
    };
  }

  async refreshTokens(refreshToken: string): Promise<AuthTokens> {
    const env = getEnv();

    // Verify signature and expiration
    let payload: any;
    try {
      payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET);
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        const e = new Error('Refresh token expired') as Error & { statusCode: number };
        e.statusCode = 401;
        throw e;
      }
      const e = new Error('Invalid refresh token') as Error & { statusCode: number };
      e.statusCode = 401;
      throw e;
    }

    const tokenHash = this.hashToken(refreshToken);

    // Check token exists in DB
    const stored = await (this.prisma as any).refreshToken.findFirst({
      where: { tokenHash, userId: payload.userId },
    });

    if (!stored) {
      const err = new Error('Refresh token not found or already used') as Error & {
        statusCode: number;
      };
      err.statusCode = 401;
      throw err;
    }

    // Check expiry from DB record
    if (stored.expiresAt < new Date()) {
      const err = new Error('Refresh token expired') as Error & { statusCode: number };
      err.statusCode = 401;
      throw err;
    }

    // Rotate: delete old token, generate new pair
    await (this.prisma as any).refreshToken.delete({ where: { id: stored.id } });

    const user = await (this.prisma as any).user.findUnique({
      where: { id: payload.userId },
    });
    const userTier = user?.tier ?? 'free';

    const newTokens = this.generateTokens(payload.userId, payload.email, userTier);

    await (this.prisma as any).refreshToken.create({
      data: {
        userId: payload.userId,
        tokenHash: this.hashToken(newTokens.refreshToken),
        expiresAt: this.getRefreshTokenExpiry(),
      },
    });

    await this.redis.setex(
      `session:${payload.userId}`,
      15 * 60,
      JSON.stringify({ email: payload.email, tier: userTier, permissions: [] }),
    );

    return newTokens;
  }

  async initiateOAuth(provider: 'google' | 'github'): Promise<string> {
    const stateToken = crypto.randomBytes(32).toString('hex');
    const frontendUrl = getEnv().FRONTEND_URL;

    await this.redis.setex(
      `oauth:state:${stateToken}`,
      10 * 60,
      JSON.stringify({ provider, redirectUrl: frontendUrl }),
    );

    const providerUrls: Record<string, string> = {
      google: `https://accounts.google.com/o/oauth2/v2/auth?state=${stateToken}&response_type=code&scope=openid%20email%20profile`,
      github: `https://github.com/login/oauth/authorize?state=${stateToken}&scope=user:email`,
    };

    return providerUrls[provider] ?? providerUrls['google']!;
  }

  /**
   * Find-or-create a user from a verified Google profile and issue FileConverter JWTs.
   * Called by the Next.js callback route after it has already exchanged the Google
   * authorization code and fetched the Google user-info profile.
   */
  async handleGoogleLogin(
    googleId: string,
    email: string,
    name: string | null,
    avatarUrl: string | null,
  ): Promise<RegisterResult> {
    // 1. Look up existing user by google oauth ID
    let user = await (this.prisma as any).user.findFirst({
      where: { oauthProvider: 'google', oauthId: googleId },
    });

    if (!user) {
      // 2. Check if there is already an account with this email (link it)
      const existing = await (this.prisma as any).user.findUnique({ where: { email } });
      if (existing) {
        user = await (this.prisma as any).user.update({
          where: { id: existing.id },
          data: { oauthProvider: 'google', oauthId: googleId },
        });
      } else {
        // 3. Create a brand-new user
        user = await (this.prisma as any).user.create({
          data: { email, oauthProvider: 'google', oauthId: googleId },
        });
      }

      // Upsert profile (name + avatar)
      await (this.prisma as any).userProfile.upsert({
        where: { userId: user.id },
        update: { name: name ?? undefined, avatarUrl: avatarUrl ?? undefined },
        create: { userId: user.id, name: name ?? null, avatarUrl: avatarUrl ?? null },
      });
    }

    // 4. Issue FileConverter JWT pair (same as email/password login path)
    const userTier = user.tier ?? 'free';
    const tokens = this.generateTokens(user.id, user.email, userTier);

    await (this.prisma as any).refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(tokens.refreshToken),
        expiresAt: this.getRefreshTokenExpiry(),
      },
    });

    await this.redis.setex(
      `session:${user.id}`,
      15 * 60,
      JSON.stringify({ email: user.email, tier: userTier, permissions: [] }),
    );

    return { ...tokens, user: { id: user.id, email: user.email, tier: userTier } };
  }

  async handleOAuthCallback(
    provider: string,
    code: string,
    state: string,
  ): Promise<RegisterResult> {
    // Validate state from Redis
    const stateData = await this.redis.get(`oauth:state:${state}`);
    if (!stateData) {
      const err = new Error('Invalid or expired OAuth state') as Error & { statusCode: number };
      err.statusCode = 400;
      throw err;
    }
    await this.redis.del(`oauth:state:${state}`);

    // In a real implementation, exchange code for profile info with provider
    // For now, create a mock user based on the code (testing purposes)
    const email = `oauth-${code}@${provider}.example.com`;
    const oauthId = `${provider}:${code}`;

    let user = await (this.prisma as any).user.findFirst({
      where: { oauthProvider: provider, oauthId: code },
    });

    if (!user) {
      const existingEmail = await (this.prisma as any).user.findUnique({ where: { email } });
      if (existingEmail) {
        // Link OAuth to existing account
        user = await (this.prisma as any).user.update({
          where: { id: existingEmail.id },
          data: { oauthProvider: provider, oauthId: code },
        });
      } else {
        user = await (this.prisma as any).user.create({
          data: { email, oauthProvider: provider, oauthId: code },
        });
      }
    }

    void oauthId; // suppress unused variable

    const userTier = user.tier ?? 'free';
    const tokens = this.generateTokens(user.id, user.email, userTier);

    await (this.prisma as any).refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(tokens.refreshToken),
        expiresAt: this.getRefreshTokenExpiry(),
      },
    });

    await this.redis.setex(
      `session:${user.id}`,
      15 * 60,
      JSON.stringify({ email: user.email, tier: userTier, permissions: [] }),
    );

    return { ...tokens, user: { id: user.id, email: user.email, tier: userTier } };
  }

  async generateApiKey(
    userId: string,
    name: string | null,
    permissions: string[],
    expiresAt?: Date,
  ): Promise<ApiKeyResult> {
    const rawKey = crypto.randomBytes(32).toString('hex');
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    const record = await (this.prisma as any).apiKey.create({
      data: {
        userId,
        keyHash,
        name,
        permissions,
        expiresAt: expiresAt ?? null,
      },
    });

    // Cache in Redis
    await this.redis.setex(
      `apikey:${keyHash}`,
      60,
      JSON.stringify({ userId, permissions, expiresAt: expiresAt?.toISOString() ?? null }),
    );

    return {
      id: record.id,
      key: rawKey,
      name: record.name,
      permissions: record.permissions,
      expiresAt: record.expiresAt,
      createdAt: record.createdAt,
    };
  }

  async listApiKeys(userId: string): Promise<ApiKeyListItem[]> {
    const keys = await (this.prisma as any).apiKey.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return keys.map((k: any) => ({
      id: k.id,
      name: k.name,
      permissions: k.permissions,
      expiresAt: k.expiresAt,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
      revokedAt: k.revokedAt,
    }));
  }

  async revokeApiKey(keyId: string, userId: string): Promise<void> {
    const key = await (this.prisma as any).apiKey.findFirst({
      where: { id: keyId, userId },
    });

    if (!key) {
      const err = new Error('API key not found') as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    }

    await (this.prisma as any).apiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });

    // Invalidate Redis cache
    await this.redis.del(`apikey:${key.keyHash}`);
  }

  async validateJWT(token: string): Promise<any> {
    const env = getEnv();
    try {
      const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as any;

      // Check Redis cache first
      const cached = await this.redis.get(`session:${payload.userId}`);
      if (cached) {
        return { ...payload, ...(JSON.parse(cached) as object) };
      }

      return payload;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        const e = new Error('Token expired') as Error & { statusCode: number };
        e.statusCode = 401;
        throw e;
      }
      const e = new Error('Invalid token') as Error & { statusCode: number };
      e.statusCode = 401;
      throw e;
    }
  }
}
