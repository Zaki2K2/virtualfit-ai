import type { RequestHandler } from 'express';
import { isSafeId, newId } from '../utils/ids';

export const GUEST_COOKIE = 'vf_guest';

declare module 'express-serve-static-core' {
  interface Request {
    /** Server-issued anonymous identity. Never taken from request bodies or headers. */
    guestId: string;
  }
}

/**
 * Guest demo mode: each browser gets a random, server-issued, httpOnly identity cookie.
 * All ownership checks use req.guestId. This is the seam where real authentication plugs in later.
 */
export const guestSession =
  (secure: boolean): RequestHandler =>
  (req, res, next) => {
    const existing = req.cookies?.[GUEST_COOKIE];
    if (isSafeId(existing) && existing.length >= 32) {
      req.guestId = existing;
    } else {
      req.guestId = newId();
      res.cookie(GUEST_COOKIE, req.guestId, {
        httpOnly: true,
        sameSite: 'lax',
        secure,
        maxAge: 1000 * 60 * 60 * 24 * 30,
      });
    }
    next();
  };
