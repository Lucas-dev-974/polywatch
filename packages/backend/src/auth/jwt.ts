import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { resolveBackendConfig } from '../system-config-resolver.js';

export interface TokenPayload {
  userId: number;
  username: string;
}

/** Refresh tokens are single-use: `jti` must match the server-side record. */
export interface RefreshTokenPayload extends TokenPayload {
  jti: string;
}

export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 3600;

export async function resolveRefreshTokenTtlSeconds(): Promise<number> {
  return resolveBackendConfig('backend.auth.refresh_token.ttl_seconds', REFRESH_TOKEN_TTL_SECONDS);
}

export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '15m' });
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  return jwt.sign(payload, config.jwtRefreshSecret, {
    expiresIn: REFRESH_TOKEN_TTL_SECONDS,
  });
}

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, config.jwtSecret) as TokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, config.jwtRefreshSecret) as RefreshTokenPayload;
}
