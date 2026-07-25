import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { verifyAccessToken } from '../auth/jwt.js';

export interface AuthRequest extends Request {
  user?: { userId: number; username: string };
}

export function requireJwt(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    req.user = verifyAccessToken(header.slice(7));
    next();
  } catch {
    res.status(401).json({ error: 'invalid_token' });
  }
}

export function requireServiceToken(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const token = req.headers['x-service-token'];
  if (token !== config.serviceToken) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  next();
}
