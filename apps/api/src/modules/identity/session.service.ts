import { Inject, Injectable } from '@nestjs/common';
import type { Session, User } from '@prisma/client';
import { ENV, type Env } from '../../config/env';
import { RequestContext } from '../../common/context/request-context';
import { generateToken, hmacHex, sha256Hex } from '../../infrastructure/crypto/tokens';
import { PrismaService, type Db } from '../../infrastructure/prisma/prisma.service';

export const SESSION_COOKIE = 'kk_session';
export const CSRF_COOKIE = 'kk_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export type SessionWithUser = Session & { user: User };

/**
 * Opaque server-side sessions. The browser holds a random 256-bit token in an
 * HttpOnly, SameSite=Lax cookie; the database holds only its SHA-256 hash.
 * Sessions have an absolute lifetime and an idle timeout, and can be revoked
 * individually or per user (logout, password change, deactivation).
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async create(db: Db, input: { userId: string; companyId: string; mfaPending: boolean }): Promise<{ token: string; session: Session }> {
    const token = generateToken();
    const ctx = RequestContext.get();
    const session = await db.session.create({
      data: {
        userId: input.userId,
        tokenHash: sha256Hex(token),
        activeCompanyId: input.companyId,
        mfaPending: input.mfaPending,
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        expiresAt: new Date(Date.now() + this.env.SESSION_TTL_HOURS * 3600_000),
      },
    });
    return { token, session };
  }

  /** Returns the live session for a cookie token, or a reason it is not usable. */
  async resolve(token: string): Promise<{ session: SessionWithUser } | { error: 'missing' | 'expired' | 'revoked' }> {
    if (!token || token.length > 128) return { error: 'missing' };
    const session = await this.prisma.session.findUnique({ where: { tokenHash: sha256Hex(token) }, include: { user: true } });
    if (!session) return { error: 'missing' };
    if (session.revokedAt) return { error: 'revoked' };
    const now = Date.now();
    const idleLimit = session.lastSeenAt.getTime() + this.env.SESSION_IDLE_MINUTES * 60_000;
    if (session.expiresAt.getTime() <= now || idleLimit <= now) {
      await this.revoke(session.id, 'expired');
      return { error: 'expired' };
    }
    // Touch at most once a minute to avoid a write per request.
    if (now - session.lastSeenAt.getTime() > 60_000) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now) } });
    }
    return { session };
  }

  async revoke(sessionId: string, reason: string, db: Db = this.prisma): Promise<void> {
    await db.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
  }

  async revokeAllForUser(userId: string, reason: string, db: Db = this.prisma, exceptSessionId?: string): Promise<number> {
    const res = await db.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return res.count;
  }

  csrfTokenFor(sessionId: string): string {
    return hmacHex(this.env.SESSION_SECRET, `csrf:${sessionId}`);
  }

  cookieOptions(kind: 'session' | 'csrf') {
    return {
      httpOnly: kind === 'session',
      secure: this.env.COOKIE_SECURE,
      sameSite: 'lax' as const,
      path: '/',
      maxAge: this.env.SESSION_TTL_HOURS * 3600_000,
    };
  }
}
