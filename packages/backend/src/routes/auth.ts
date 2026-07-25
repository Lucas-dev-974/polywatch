import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { DataSource } from 'typeorm';
import { User } from '@polywatch/core';
import {
  REFRESH_TOKEN_TTL_SECONDS,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../auth/jwt.js';
import { getRedis } from '../redis.js';

const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

function refreshJtiKey(userId: number): string {
  return `auth:refresh-jti:${userId}`;
}

/**
 * Issue an access/refresh pair and register the refresh token's jti as the
 * single currently-valid one for this user (single-use rotation).
 */
async function issueTokenPair(user: Pick<User, 'id' | 'username'>): Promise<{
  accessToken: string;
  refreshToken: string;
}> {
  const jti = randomUUID();
  await getRedis().set(
    refreshJtiKey(user.id),
    jti,
    'EX',
    REFRESH_TOKEN_TTL_SECONDS,
  );
  const payload = { userId: user.id, username: user.username };
  return {
    accessToken: signAccessToken(payload),
    refreshToken: signRefreshToken({ ...payload, jti }),
  };
}

export function createAuthRouter(ds: DataSource): Router {
  const router = Router();

  router.post('/login', async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }

    const user = await ds.getRepository(User).findOne({
      where: { username: parsed.data.username },
    });
    if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }

    res.json(await issueTokenPair(user));
  });

  router.post('/refresh', async (req, res) => {
    const token = req.body?.refreshToken as string | undefined;
    if (!token) {
      res.status(400).json({ error: 'missing_token' });
      return;
    }

    let payload;
    try {
      payload = verifyRefreshToken(token);
    } catch {
      res.status(401).json({ error: 'invalid_token' });
      return;
    }

    // Single-use rotation: the presented jti must be the current one. A
    // mismatch means the token was already rotated (replay / theft) — revoke
    // the whole session and force a fresh login.
    const key = refreshJtiKey(payload.userId);
    const currentJti = await getRedis().get(key);
    if (!payload.jti || !currentJti || currentJti !== payload.jti) {
      await getRedis().del(key);
      res.status(401).json({ error: 'invalid_token' });
      return;
    }

    // The user must still exist — refresh is not a blind re-sign.
    const user = await ds.getRepository(User).findOne({
      where: { id: payload.userId },
    });
    if (!user) {
      await getRedis().del(key);
      res.status(401).json({ error: 'invalid_token' });
      return;
    }

    res.json(await issueTokenPair(user));
  });

  return router;
}
