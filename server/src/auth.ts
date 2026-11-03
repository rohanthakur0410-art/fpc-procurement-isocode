import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import type { Role, SessionUser } from '@app/shared';

// SESSION_SECRET must be set in any real deployment; the fallback only exists
// so the app runs locally out of the box (documented in deployment.md).
const SECRET = process.env.SESSION_SECRET || 'dev-only-secret-change-me';
const COOKIE = 'fpc_session';

export interface AuthedRequest extends Request {
  user?: SessionUser;
}

export function signSession(user: SessionUser): string {
  return jwt.sign(user, SECRET, { expiresIn: '7d' });
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 3600 * 1000 });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE);
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const token = req.cookies?.[COOKIE];
  if (!token) {
    res.status(401).json({ error: 'not_signed_in' });
    return;
  }
  try {
    req.user = jwt.verify(token, SECRET) as SessionUser;
    next();
  } catch {
    res.status(401).json({ error: 'session_expired' });
  }
}

export function requireRole(role: Role) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (req.user?.role !== role) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    next();
  };
}
